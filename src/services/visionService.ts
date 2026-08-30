// =============================================================================
// Vision Service — cliente del worker de vision
//
// Este archivo era el detector entero: MediaPipe, la matematica de landmarks,
// el AudioContext y el estado de la sesion, todo ejecutandose en el hilo de la
// interfaz. Ahora es solo la mitad que TIENE que quedarse en el hilo principal,
// y no es poca cosa saber cual es:
//
//   - Captura del frame. Un ImageBitmap solo se puede sacar de un <video>, y un
//     <video> solo existe en el hilo principal.
//   - Muestreo de audio. La Web Audio API no existe dentro de un worker. Cada
//     frame viaja con la energia de audio del instante en que se capturo, para
//     que las dos mitades de la sincronia labial sigan emparejadas.
//   - Medida del dispositivo y eleccion de tier.
//
// Todo lo demas —la inferencia, los landmarks, la firma perceptual— vive en
// src/workers/vision.worker.ts.
//
// Los frames se TRANSFIEREN, no se copian: al mandarlos, este hilo pierde la
// referencia. Es la propiedad que hace de §4.1 algo comprobable leyendo el
// codigo, y no una promesa.
// =============================================================================

import { rms } from '@/utils/lipSync';
import { probeDevice, pickTier, withDelegateFallback, TIER_BUDGETS, type TierBudget } from '@/shared/vision/deviceTier';
import type { WorkerRequest, WorkerResponse } from '@/shared/vision/protocol';
import type { FaceFrameResult } from '@/shared/vision/faceSignals';
import type { LoopFinding } from '@/shared/vision/loopDetection';

export interface VisionFrameOutcome {
  face: FaceFrameResult | null;
  loop: LoopFinding | null;
  /** Cuanto tardo el analisis dentro del worker. Gobierna la degradacion. */
  durationMs: number;
}

/**
 * Ruta del worker ya compilado. Absoluta desde la raiz del sitio: `public/` se
 * sirve tal cual, tanto en desarrollo como en la build.
 */
const VISION_WORKER_URL = '/vision-worker.js';

/** Cuanto se espera a que el worker arranque antes de darlo por fallido. */
const INIT_TIMEOUT_MS = 20_000;

class VisionService {
  private worker: Worker | null = null;
  private budget: TierBudget = TIER_BUDGETS.low;
  private ready = false;

  /**
   * Solo un frame en vuelo cada vez.
   *
   * Sin esto, el worker se convierte en una cola: el hilo principal puede
   * mandar frames mas rapido de lo que el worker los procesa, y entonces lo que
   * se analiza es cada vez mas viejo mientras la memoria crece. Un frame en
   * vuelo significa que el analisis siempre va sobre lo que esta pasando AHORA,
   * que es el unico momento que le importa a quien esta en la llamada.
   */
  private inFlight = false;
  private nextFrameId = 1;
  /**
   * Por que fallo el ultimo arranque.
   *
   * Iba a un console.warn y ahi se quedaba: el escudo decia "no se pudo iniciar
   * el detector facial" sin poder decir por que, ni al usuario ni al log de la
   * app. Ahora el motivo se guarda y se puede enseñar.
   */
  private lastError: string | null = null;
  private onOutcome: ((outcome: VisionFrameOutcome) => void) | null = null;

  // El grafo de audio se queda aqui por obligacion: AudioContext no existe
  // dentro de un worker.
  private audioCtx: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioByteBuffer: Uint8Array<ArrayBuffer> | null = null;

  /** El presupuesto elegido para este dispositivo. */
  tier(): TierBudget {
    return this.budget;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Motivo del ultimo fallo de arranque, si lo hubo. */
  error(): string | null {
    return this.lastError;
  }

  /**
   * Hay un frame esperando respuesta del worker.
   *
   * Lo consulta el bucle ANTES de gastar un hueco del presupuesto: si el worker
   * sigue ocupado, ese frame no se descarta por ritmo sino por contrapresion, y
   * contarlo como analizado falsearia la medida de degradacion.
   */
  isBusy(): boolean {
    return this.inFlight;
  }

  async init(): Promise<boolean> {
    if (this.ready) return true;
    this.lastError = null;

    try {
      const probe = await probeDevice();
      this.budget = withDelegateFallback(pickTier(probe), probe.webgpu ?? false);

      // Se carga desde public/, compilado aparte por
      // scripts/build-vision-worker.mjs, y NO por el pipeline de workers de
      // Vite. Tiene que ser un worker clasico —MediaPipe necesita
      // importScripts— y Vite solo sabe darlos al construir: en desarrollo
      // sirve todos los workers como modulos ES. Compilarlo aparte hace que
      // dev y produccion carguen el mismo artefacto.
      this.worker = new Worker(VISION_WORKER_URL);
      this.worker.addEventListener('message', this.handleMessage);
      this.worker.addEventListener('error', this.handleWorkerError);

      const ok = await this.awaitReady();
      this.ready = ok;
      if (!ok) this.teardownWorker();
      return ok;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.warn('[NADA] Vision init failed:', e);
      this.teardownWorker();
      return false;
    }
  }

  /** Se avisa por aqui de cada frame analizado. */
  setOnOutcome(cb: ((outcome: VisionFrameOutcome) => void) | null): void {
    this.onOutcome = cb;
  }

  /**
   * Conecta una pista de audio del mismo stream para poder medir la sincronia
   * labial contra energia real. Es seguro llamarlo con un stream sin audio: en
   * ese caso la sincronia se queda explicitamente "sin medir" en vez de
   * adivinarse.
   */
  attachAudio(stream: MediaStream): void {
    this.detachAudio();

    const [track] = stream.getAudioTracks();
    if (!track) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtx();
      this.audioSource = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.audioSource.connect(this.analyser);
      // Backing ArrayBuffer explicito: TS 5.7+ tipa getByteTimeDomainData
      // esperando Uint8Array<ArrayBuffer>, que `new Uint8Array(n)` por si solo
      // ya no satisface (infiere ArrayBufferLike).
      this.audioByteBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    } catch (e) {
      console.warn('[NADA] Lip-sync audio attach failed:', e);
      this.detachAudio();
    }
  }

  detachAudio(): void {
    this.audioSource?.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
    this.audioSource = null;
    this.analyser = null;
    this.audioByteBuffer = null;
  }

  /**
   * Captura un frame y lo manda a analizar.
   *
   * Devuelve false cuando no toca —worker sin arrancar, o uno en vuelo— para
   * que quien llama no cuente ese frame como analizado. Es sincrona en lo que
   * importa: marca `inFlight` antes de ceder el control, asi que dos llamadas
   * seguidas en el mismo tick no pueden colarse las dos.
   */
  analyseFrame(video: HTMLVideoElement, timestampMs: number): boolean {
    if (!this.ready || !this.worker || this.inFlight) return false;
    if (!video.videoWidth || !video.videoHeight) return false;

    this.inFlight = true;
    const frameId = this.nextFrameId++;
    const audioEnergy = this.sampleAudioEnergy();
    const { width, height } = this.scaledSize(video.videoWidth, video.videoHeight);

    createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
      .then((bitmap) => {
        if (!this.worker) {
          bitmap.close();
          this.inFlight = false;
          return;
        }
        const message: WorkerRequest = { type: 'frame', frameId, bitmap, timestampMs, audioEnergy };
        this.worker.postMessage(message, [bitmap]);
      })
      .catch(() => {
        // Capturar puede fallar si el track se corta justo ahora. Se libera el
        // hueco: si no, un fallo de captura congelaria el analisis entero.
        this.inFlight = false;
      });

    return true;
  }

  /** Limpia el estado acumulado sin tirar el worker (nueva sesion, misma pagina). */
  resetSession(): void {
    this.worker?.postMessage({ type: 'reset' } satisfies WorkerRequest);
    this.inFlight = false;
  }

  destroy(): void {
    // terminate() se lleva por delante el contexto completo del worker: modelo,
    // heap de WASM y contexto de GPU. No hace falta despedirse antes.
    this.teardownWorker();
    this.detachAudio();
  }

  /**
   * Un error sin capturar dentro del worker.
   *
   * Sin esta escucha, el worker puede morirse y desde aqui solo se ve silencio:
   * el arranque agota su plazo, o peor, una sesion en marcha deja de recibir
   * resultados y el escudo se queda diciendo "analizando" para siempre. Se
   * libera el hueco en vuelo para que el bucle no se atasque, y se guarda el
   * motivo para poder contarlo.
   */
  private handleWorkerError = (event: ErrorEvent): void => {
    this.lastError = event.message || 'error desconocido en el worker de vision';
    this.inFlight = false;
    console.warn('[NADA] Vision worker error:', event.message, event.filename, event.lineno);
  };

  private handleMessage = (event: MessageEvent<WorkerResponse>): void => {
    const message = event.data;
    if (message.type !== 'result') return;

    this.inFlight = false;
    this.onOutcome?.({ face: message.face, loop: message.loop, durationMs: message.durationMs });
  };

  private awaitReady(): Promise<boolean> {
    const worker = this.worker;
    if (!worker) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        worker.removeEventListener('message', listener);
        resolve(ok);
      };

      const listener = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') finish(true);
        if (event.data.type === 'init-failed') {
          this.lastError = event.data.reason;
          console.warn('[NADA] Vision worker init failed:', event.data.reason);
          finish(false);
        }
      };

      // Sin plazo, un worker que no responde deja el escudo diciendo
      // "inicializando" para siempre, que es la peor forma de fallar: parece
      // que protege.
      const timer = setTimeout(() => {
        this.lastError = `el worker no respondio en ${INIT_TIMEOUT_MS} ms`;
        finish(false);
      }, INIT_TIMEOUT_MS);
      worker.addEventListener('message', listener);
      worker.postMessage({ type: 'init', budget: this.budget } satisfies WorkerRequest);
    });
  }

  private teardownWorker(): void {
    // Ojo: no se limpia lastError. Quien desmonta el worker suele ser
    // justamente el fallo que se quiere poder contar despues.
    this.worker?.removeEventListener('message', this.handleMessage);
    this.worker?.removeEventListener('error', this.handleWorkerError);
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.inFlight = false;
    this.onOutcome = null;
  }

  private sampleAudioEnergy(): number | null {
    if (!this.analyser || !this.audioByteBuffer) return null;
    this.analyser.getByteTimeDomainData(this.audioByteBuffer);
    return rms(this.audioByteBuffer);
  }

  /** Reduce el lado mayor a maxFrameSize conservando la proporcion. */
  private scaledSize(width: number, height: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (longest <= this.budget.maxFrameSize) return { width, height };

    const factor = this.budget.maxFrameSize / longest;
    return {
      width: Math.max(1, Math.round(width * factor)),
      height: Math.max(1, Math.round(height * factor)),
    };
  }
}

export const visionService = new VisionService();
