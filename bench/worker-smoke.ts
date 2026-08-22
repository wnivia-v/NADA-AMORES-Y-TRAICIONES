// =============================================================================
// Banco de humo del worker de vision — se ejecuta en Chromium de verdad
//
// Los tests unitarios cubren la matematica, pero no pueden decir nada de lo
// unico que la Fase 4 cambia de sitio: que MediaPipe arranque DENTRO de un
// worker, con el runtime WASM servido desde nuestro origen, y que los frames
// crucen el limite entre hilos como ImageBitmap transferidos.
//
// Eso solo se comprueba en un navegador, asi que esta pagina monta el camino
// real —visionService, worker, MediaPipe— y le da de comer un <video> sintetico
// hecho con canvas.captureStream(). Sin camara, pero con MediaStream de verdad.
//
// El truco esta en captureStream(0): con 0 fps el canvas no emite nada por su
// cuenta y cada frame se pide a mano con requestFrame(). Sin eso, capturar y
// dibujar irian cada uno a su ritmo y el mismo frame podria analizarse dos
// veces — que la deteccion de bucle leeria, con razon, como imagen congelada.
//
// No entra en la build de produccion: vive en bench/, igual que los demas
// bancos, y el unico input de rollup sigue siendo index.html.
// =============================================================================

import { visionService, type VisionFrameOutcome } from '@/services/visionService';
import { pickTier, probeDevice } from '@/shared/vision/deviceTier';

const WIDTH = 640;
const HEIGHT = 480;
/** Frames distintos del ciclo. A 200 ms por frame, el ciclo dura 4 s. */
const CYCLE = 20;

type Phase = { analysed: number; loopFindings: string[]; faceFrames: number };

function drawScene(ctx: CanvasRenderingContext2D, seed: number): void {
  // Fondo con degradado que se desplaza, para que el frame cambie de verdad y
  // no solo en una esquina.
  const grad = ctx.createLinearGradient(0, (seed * 37) % HEIGHT, WIDTH, HEIGHT);
  grad.addColorStop(0, `hsl(${(seed * 17) % 360} 55% 22%)`);
  grad.addColorStop(1, `hsl(${(seed * 29 + 120) % 360} 60% 45%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Bloques claros repartidos: son los que mueven bits en la firma 8x8.
  ctx.fillStyle = '#f2f2f2';
  for (let i = 0; i < 6; i += 1) {
    const x = ((seed * 53 + i * 97) % (WIDTH - 80));
    const y = ((seed * 71 + i * 61) % (HEIGHT - 80));
    ctx.fillRect(x, y, 70, 70);
  }
}

async function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  await new Promise<void>((resolve) => {
    video.requestVideoFrameCallback(() => resolve());
  });
}

async function run(): Promise<unknown> {
  const probe = await probeDevice();
  const tierBeforeFallback = pickTier(probe);

  const started = performance.now();
  const ready = await visionService.init();
  // El error puede llegar despues de que init() se rinda por plazo.
  await new Promise((r) => setTimeout(r, 500));
  const initMs = Math.round(performance.now() - started);
  if (!ready) {
    return { ok: false, stage: 'init', probe, tier: tierBeforeFallback.id, error: visionService.error() };
  }

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, stage: 'canvas' };

  // 0 fps: ningun frame sale solo, todos se piden con requestFrame().
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  drawScene(ctx, 0);
  track.requestFrame();
  await video.play();

  let pending: ((outcome: VisionFrameOutcome) => void) | null = null;
  visionService.setOnOutcome((outcome) => {
    const resolve = pending;
    pending = null;
    resolve?.(outcome);
  });

  let timestamp = 0;
  const durations: number[] = [];

  async function pushFrame(seed: number): Promise<VisionFrameOutcome | null> {
    drawScene(ctx!, seed);
    track.requestFrame();
    await nextVideoFrame(video);

    timestamp += 200;
    const outcome = await new Promise<VisionFrameOutcome | null>((resolve) => {
      pending = resolve;
      if (!visionService.analyseFrame(video, timestamp)) {
        pending = null;
        resolve(null);
      }
      // Sin plazo, un worker mudo colgaria el banco en vez de suspenderlo.
      setTimeout(() => {
        if (pending === resolve) {
          pending = null;
          resolve(null);
        }
      }, 10_000);
    });

    if (outcome) durations.push(outcome.durationMs);
    return outcome;
  }

  // --- Fase 1: escena que nunca se repite. No debe haber bucle. ---
  const cambiante: Phase = { analysed: 0, loopFindings: [], faceFrames: 0 };
  for (let i = 1; i <= 60; i += 1) {
    const outcome = await pushFrame(i * 7919);
    if (!outcome) continue;
    cambiante.analysed += 1;
    if (outcome.loop) cambiante.loopFindings.push(outcome.loop.kind);
    if (outcome.face) cambiante.faceFrames += 1;
  }

  // --- Fase 2: ciclo de 20 frames repetido. Tiene que detectarse. ---
  visionService.resetSession();
  await new Promise((r) => setTimeout(r, 50));

  const enBucle: Phase = { analysed: 0, loopFindings: [], faceFrames: 0 };
  let periodSeconds: number | null = null;
  for (let i = 0; i < CYCLE * 6; i += 1) {
    const outcome = await pushFrame((i % CYCLE) + 1);
    if (!outcome) continue;
    enBucle.analysed += 1;
    if (outcome.loop) {
      enBucle.loopFindings.push(outcome.loop.kind);
      if (outcome.loop.kind === 'looping' && periodSeconds === null) {
        periodSeconds = outcome.loop.periodSeconds ?? null;
        break;
      }
    }
  }

  // --- Fase 3: imagen congelada. Mismo frame una y otra vez. ---
  visionService.resetSession();
  await new Promise((r) => setTimeout(r, 50));

  const congelada: Phase = { analysed: 0, loopFindings: [], faceFrames: 0 };
  for (let i = 0; i < 20; i += 1) {
    const outcome = await pushFrame(4242);
    if (!outcome) continue;
    congelada.analysed += 1;
    if (outcome.loop) {
      congelada.loopFindings.push(outcome.loop.kind);
      if (outcome.loop.kind === 'frozen') break;
    }
  }

  visionService.destroy();

  durations.sort((a, b) => a - b);
  return {
    ok: true,
    probe,
    tierBeforeFallback: tierBeforeFallback.id,
    tier: visionService.tier(),
    initMs,
    frames: durations.length,
    medianAnalysisMs: durations.length ? Math.round(durations[Math.floor(durations.length / 2)]!) : null,
    p95AnalysisMs: durations.length ? Math.round(durations[Math.floor(durations.length * 0.95)]!) : null,
    escenaCambiante: cambiante,
    enBucle: { ...enBucle, periodSeconds },
    congelada,
  };
}

declare global {
  interface Window {
    smokeResult?: unknown;
    runSmoke: () => Promise<unknown>;
  }
}

window.runSmoke = async () => {
  try {
    const result = await run();
    window.smokeResult = result;
    document.getElementById('out')!.textContent = JSON.stringify(result, null, 2);
    return result;
  } catch (error) {
    const failure = { ok: false, stage: 'throw', error: String(error) };
    window.smokeResult = failure;
    document.getElementById('out')!.textContent = JSON.stringify(failure, null, 2);
    return failure;
  }
};
