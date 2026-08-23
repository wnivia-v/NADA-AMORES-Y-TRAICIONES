import { visionService, type VisionFrameOutcome } from './visionService';
import { getFusionEngine, clearLane, type FusionResult } from '@/shared/risk';
import { FrameBudget } from '@/shared/vision/frameBudget';
import { playAlertTone } from '@/utils/audioAlert';
import { notificationService } from './notificationService';
import type { ScamAnalysis } from '@/store/useNadaStore';
import { audioConstraints } from './voice/micMode';

// =============================================================================
// Video Shield — orquestador singleton
//
// Es dueño del MediaStream y del ritmo de analisis, para que una sesion de
// deteccion sobreviva a salir de la vista de camara, igual que el escudo de voz
// vive en protectionEngine y no dentro de VoiceAnalyzer.
//
// Lo que cambia en la Fase 4 es QUE ritmo. Antes: requestAnimationFrame llamando
// a MediaPipe con cada frame, en el hilo de UI. Ahora rAF sigue siendo el latido
// —es la forma de saber que hay un frame nuevo— pero ya no decide nada:
//
//   1. El presupuesto dice si toca analizar (targetFps del tier, no los 60 de
//      la pantalla).
//   2. La contrapresion dice si se puede: un solo frame en vuelo. Analizar lo
//      que pasa AHORA importa mas que analizarlo todo.
//   3. El worker responde con cuanto tardo, y eso realimenta el presupuesto.
//      Es la unica señal termica legible desde un navegador.
// =============================================================================

export type CameraSource = 'own' | 'call';

interface VideoShieldCallbacks {
  onAlert: (alert: { verdict: ScamAnalysis['verdict']; riskScore: number; description: string; detectedTactic: string | null; app: string }) => void;
  onAnalysisResult: (result: ScamAnalysis) => void;
  onShieldStatusChange: (status: Record<string, unknown>) => void;
  onFrame: (deepfakeScore: number, lipSyncMeasured: boolean) => void;
  onLog: (message: string, type: 'info' | 'success' | 'warning' | 'error' | 'system') => void;
  labelForSource: (source: CameraSource) => string;
  getDeepfakeDetectedLabel: () => string;
}

// El registro visual se refresca a este ritmo: sirve como evidencia de cuanto
// duro la deteccion sin llenar el log varias veces por segundo.
const ALERT_COOLDOWN_MS = 20_000;

/**
 * Cuánto silencio hace falta antes de volver a SONAR por la misma amenaza.
 *
 * Un deepfake que sigue en pantalla es un solo evento, no uno nuevo cada 20
 * segundos. Repetir el tono durante toda una videollamada solo tapa la
 * conversación que el usuario está tratando de evaluar — y una alerta que suena
 * todo el tiempo deja de informar.
 *
 * Suena la primera vez, suena si la amenaza escala, y después se calla.
 */
const SOUND_REPEAT_MS = 150_000;

/**
 * Cada cuanto se le entrega al motor de fusion la opinion de un detector.
 *
 * A 30 fps, treinta frames seguidos del mismo deepfake no son treinta pruebas:
 * son la misma prueba mirada treinta veces. El motor acumula evidencia dentro de
 * cada tipo con noisy-OR, asi que alimentarlo por frame convertiria cualquier
 * deteccion sostenida en certeza absoluta en menos de un segundo.
 *
 * Muestreando cada 3 s, un hallazgo aislado pesa lo que pesa y uno que persiste
 * durante toda la ventana va acumulando — que es lo correcto, porque persistir
 * SI es evidencia. Lo que no puede es acumular al ritmo de la pantalla.
 */
const SIGNAL_INTERVAL_MS = 3_000;

class VideoShieldService {
  private callbacks: VideoShieldCallbacks | null = null;
  private stream: MediaStream | null = null;
  // Fuera del DOM a proposito: el bucle de captura tiene que seguir corriendo
  // aunque CameraAnalyzer (y su propio <video> de vista previa) no este montado.
  private videoEl: HTMLVideoElement | null = null;
  private rafId = 0;
  private source: CameraSource = 'call';
  private budget: FrameBudget | null = null;
  private lastAlertAt = 0;
  private lastSoundAt = 0;
  /** Ultima vez que se entrego cada tipo de señal al motor de fusion. */
  private lastSignalAt: Record<'deepfake' | 'video-loop', number> = { deepfake: 0, 'video-loop': 0 };
  /** Veredicto de la última alerta sonora, para detectar escalada. */
  private lastSoundVerdict: ScamAnalysis['verdict'] | null = null;

  init(callbacks: VideoShieldCallbacks) {
    this.callbacks = callbacks;
  }

  isActive(): boolean {
    return !!this.stream;
  }

  getSource(): CameraSource {
    return this.source;
  }

  /** Espeja el stream en un <video> visible solo para vista previa — la captura sigue igual. */
  attachPreview(el: HTMLVideoElement) {
    if (this.stream) {
      el.srcObject = this.stream;
      void el.play().catch(() => {});
    }
  }

  async start(source: CameraSource): Promise<boolean> {
    if (this.stream) return true;

    this.callbacks?.onLog('CAMARA: Inicializando...', 'system');
    const ok = await visionService.init();
    if (!ok) {
      this.callbacks?.onLog('CAMARA: No se pudo iniciar el detector facial.', 'error');
      return false;
    }

    const tier = visionService.tier();
    this.budget = new FrameBudget({ targetFps: tier.targetFps, minFps: 1 });
    visionService.setOnOutcome(this.handleOutcome);

    try {
      // "call" captura la ventana/pestaña de la videollamada (la otra persona),
      // que es la superficie real del fraude — tu propia webcam no puede
      // enseñarte un deepfake de ti mismo. "own" se mantiene para pruebas.
      const stream = source === 'call'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 },
            // `audio: true` dejaba elegir al navegador, y Chrome elige
            // procesado: el escudo de video pausaba la reproduccion igual que
            // el de voz, por la misma razon y sin que nadie lo hubiera pedido.
            audio: audioConstraints(),
          });

      this.stream = stream;
      this.source = source;
      this.lastAlertAt = 0;
      this.lastSoundAt = 0;
      this.lastSignalAt = { deepfake: 0, 'video-loop': 0 };
      this.lastSoundVerdict = null;
      // Carril limpio: lo que se vio en la llamada anterior no puede sostener
      // una alerta en esta.
      clearLane('video');
      visionService.resetSession();

      if (stream.getAudioTracks().length === 0) {
        this.callbacks?.onLog('CAMARA: Sin audio — no se puede verificar la sincronia labial.', 'warning');
      }
      visionService.attachAudio(stream);

      // Fuente de decodificacion desacoplada: no necesita estar en el DOM para
      // dar frames, asi que el bucle de analisis es independiente de la vista.
      this.videoEl = document.createElement('video');
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      this.videoEl.srcObject = stream;
      await this.videoEl.play();

      // La camara o la pantalla compartida se pueden cortar desde la propia UI
      // del navegador, no solo desde nuestro boton.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop());

      this.callbacks?.onShieldStatusChange({ active: true, scanning: true });
      this.callbacks?.onLog(
        `CAMARA: Deteccion deepfake activa (${this.callbacks?.labelForSource(source)}) ` +
        `— ${tier.id} @ ${tier.targetFps} fps, delegado ${tier.delegate}.`,
        'success',
      );
      this.loop();
      return true;
    } catch {
      this.callbacks?.onLog('CAMARA: Error al acceder a la camara o compartir pantalla.', 'error');
      return false;
    }
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.videoEl?.pause();
    this.videoEl = null;
    this.budget = null;
    visionService.setOnOutcome(null);
    visionService.destroy();
    clearLane('video');
    this.callbacks?.onShieldStatusChange({ active: false, scanning: false });
    this.callbacks?.onFrame(0, false);
    this.callbacks?.onLog('CAMARA: Detenida.', 'info');
  }

  /** Diagnostico: a que ritmo se esta analizando de verdad. */
  budgetState() {
    return this.budget?.state() ?? null;
  }

  private loop = () => {
    if (!this.videoEl || !this.stream) return;

    // El worker manda: si sigue ocupado, este frame se pierde por
    // contrapresion y no gasta hueco de presupuesto. Contarlo como analizado
    // falsearia la medida que gobierna la degradacion termica.
    if (!visionService.isBusy() && this.budget?.shouldAnalyse(performance.now())) {
      visionService.analyseFrame(this.videoEl, performance.now());
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private handleOutcome = (outcome: VisionFrameOutcome) => {
    this.budget?.recordAnalysisTime(outcome.durationMs);

    const engine = getFusionEngine('video');
    const now = Date.now();

    // Carril propio: una videollamada dudosa no debe subir el riesgo de lo que
    // se copie al portapapeles diez segundos despues.
    if (outcome.face?.isLikelyDeepfake && now - this.lastSignalAt.deepfake >= SIGNAL_INTERVAL_MS) {
      this.lastSignalAt.deepfake = now;
      engine.addSignal('deepfake', outcome.face.confidence, 0.7, now);
    }
    if (outcome.loop && now - this.lastSignalAt['video-loop'] >= SIGNAL_INTERVAL_MS) {
      this.lastSignalAt['video-loop'] = now;
      engine.addSignal('video-loop', outcome.loop.confidence, 0.8, now);
    }

    const fusion = engine.fuse(now);

    // El indicador enseña el riesgo acumulado de la ventana, no la lectura
    // suelta de un frame: es la misma cifra que decide, y baja sola cuando las
    // señales salen de la ventana.
    this.callbacks?.onFrame(fusion.score, outcome.face?.signals.lipSyncMeasured ?? false);
    this.callbacks?.onShieldStatusChange({ scanning: true, lastScan: new Date().toLocaleTimeString() });

    if (fusion.band !== 'SEGURO') {
      this.reportRisk(fusion, this.describe(outcome));
    }
  };

  /** Texto que explica QUE se vio, no que veredicto se saca de ello. */
  private describe(outcome: VisionFrameOutcome): string {
    const parts: string[] = [];
    if (outcome.face?.isLikelyDeepfake) parts.push(outcome.face.explanation);
    if (outcome.loop) parts.push(outcome.loop.explanation);
    return parts.join(' ') || 'Indicadores de riesgo en el video.';
  }

  /**
   * Un solo punto de salida para todo lo que el escudo de video cuenta.
   *
   * La banda se registra siempre; el tono, la notificacion y la entrada en el
   * panel de alertas se reservan para `fusion.alert`. Antes esto no era asi en
   * el carril de video: una sola deteccion biometrica hacia sonar la alarma,
   * que es exactamente lo que el §3 prohibe. Ahora, para que suene, hacen falta
   * dos señales independientes — la biometria y el bucle miden cosas distintas
   * por caminos distintos, asi que pueden sostenerse la una a la otra.
   */
  private reportRisk(fusion: FusionResult, explanation: string) {
    const now = Date.now();
    if (now - this.lastAlertAt < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt = now;

    const verdict: ScamAnalysis['verdict'] = fusion.band === 'PELIGROSO' ? 'PELIGROSO' : 'SOSPECHOSO';
    const result: ScamAnalysis = {
      verdict,
      riskScore: fusion.score,
      tactics: ['Deepfake / manipulacion de video'],
      explanation,
      scanSource: 'local',
      recommendations: [
        'Corta la llamada y verifica la identidad por otro canal (llamada telefonica al numero conocido).',
        'No compartas datos personales ni hagas transferencias mientras la sospecha este activa.',
      ],
    };

    this.callbacks?.onAnalysisResult(result);
    if (!fusion.alert) return;

    // El aviso sonoro se guarda para lo que el usuario todavía no sabe: la
    // primera detección, o una que empeoró. Mientras la misma amenaza sigue
    // igual, la evidencia se acumula en pantalla en silencio.
    const escalated = verdict === 'PELIGROSO' && this.lastSoundVerdict !== 'PELIGROSO';
    const silentLongEnough = now - this.lastSoundAt >= SOUND_REPEAT_MS;
    if (this.lastSoundVerdict === null || escalated || silentLongEnough) {
      this.lastSoundAt = now;
      this.lastSoundVerdict = verdict;
      playAlertTone(verdict === 'PELIGROSO' ? 'high' : 'low');
    }

    notificationService.sendThreatAlert(verdict, fusion.score, result.tactics[0]);
    this.callbacks?.onAlert({
      verdict,
      riskScore: fusion.score,
      description: this.callbacks?.getDeepfakeDetectedLabel() ?? 'Posible deepfake detectado',
      detectedTactic: result.tactics[0] ?? null,
      app: this.callbacks?.labelForSource(this.source) ?? 'Video',
    });
  }
}

export const videoShieldService = new VideoShieldService();
