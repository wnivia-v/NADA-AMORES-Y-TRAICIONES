// =============================================================================
// Worker de vision
//
// Aqui dentro corre TODO lo caro: la inferencia de MediaPipe, la matematica de
// landmarks y la firma perceptual de cada frame. Antes corria en el hilo de UI,
// llamado desde requestAnimationFrame, que es la peor combinacion posible de
// las dos decisiones: el hilo que dibuja la interfaz era tambien el que
// ejecutaba una red neuronal, y el ritmo lo marcaba el refresco de la pantalla.
//
// El sintoma en un movil de gama media no es "va un poco lento": es que la
// interfaz deja de responder mientras la inferencia ocupa el hilo, el navegador
// se salta frames, el telefono se calienta y el sistema termina estrangulando
// el proceso. Justo durante la videollamada que se queria vigilar.
//
// El limite del worker tambien sirve de frontera fisica para §4.1: los frames
// entran TRANSFERIDOS —el hilo principal pierde la referencia al ImageBitmap en
// el momento de mandarlo— y lo que sale son numeros. No hay aqui dentro ninguna
// llamada de red mas que la descarga del modelo, ni nada que persista un pixel.
//
// OJO: este worker es CLASICO, no de tipo module, y MediaPipe importado de
// forma estatica. No es preferencia. Su cargador de WASM hace esto:
//
//     if (typeof importScripts !== 'function') { document.createElement('script') ... }
//     else importScripts(rutaDelCargador)
//
// y luego comprueba `self.ModuleFactory`. En un worker de tipo module no existe
// ninguna de las dos vias —ni importScripts ni document— asi que falla con
// "ModuleFactory not set.". Un worker clasico si tiene importScripts.
//
// De ahi tambien que MediaPipe se importe arriba y no con import(): un import
// dinamico obliga a dividir el codigo, y la division no cabe en el formato iife
// que exige un worker clasico. Estatico entra todo en un solo trozo, que ademas
// solo se descarga cuando alguien enciende la camara.
// =============================================================================

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import {
  FaceAnalyzer,
  eulerFromMatrix,
  type Landmark,
  type FaceFrameResult,
} from '@/shared/vision/faceSignals';
import {
  LoopDetector,
  frameSignature,
  HASH_GRID,
  type LoopFinding,
} from '@/shared/vision/loopDetection';
import {
  MEDIAPIPE_WASM_BASE,
  FACE_LANDMARKER_MODEL_URL,
  type WorkerRequest,
  type WorkerResponse,
} from '@/shared/vision/protocol';

// `self` dentro de un worker de un proyecto con la lib DOM cargada se tipa como
// Window, que no es lo que es. Se declara aqui la superficie que de verdad se
// usa, en vez de repartir `as any` por el archivo.
const ctx = globalThis as unknown as {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: 'message', handler: (event: MessageEvent<WorkerRequest>) => void): void;
};

/** Paso intermedio antes del mosaico 8x8, para no aliasar al reducir de golpe. */
const INTERMEDIATE_SIZE = 64;

let landmarker: {
  detectForVideo(image: ImageBitmap, timestampMs: number): {
    faceLandmarks?: Landmark[][];
    facialTransformationMatrixes?: { data: number[] }[];
  };
  close(): void;
} | null = null;

const analyzer = new FaceAnalyzer();
const loopDetector = new LoopDetector();

let intermediate: OffscreenCanvas | null = null;
let mosaic: OffscreenCanvas | null = null;

async function init(delegate: 'GPU' | 'CPU'): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);

  landmarker = (await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    // Ya venia activado en el codigo anterior y nadie leia el resultado. Es de
    // donde sale la pose de la cabeza, sin la cual no hay reto activo.
    outputFacialTransformationMatrixes: true,
  })) as unknown as typeof landmarker;
}

/**
 * Luminancias del mosaico HASH_GRID x HASH_GRID de un frame.
 *
 * Se reduce en dos pasos (frame -> 64 -> 8) en vez de uno. Reducir de 480 a 8
 * de golpe hace que el navegador muestree unos pocos pixeles sueltos en vez de
 * promediar la zona, y entonces un movimiento minimo cambia muchos bits de la
 * firma. Eso no genera falsas alarmas —empuja hacia "esto no es un bucle"— pero
 * si hace perder bucles reales, que es lo unico que este detector aporta.
 */
function lumaMosaic(bitmap: ImageBitmap): number[] | null {
  intermediate ??= new OffscreenCanvas(INTERMEDIATE_SIZE, INTERMEDIATE_SIZE);
  mosaic ??= new OffscreenCanvas(HASH_GRID, HASH_GRID);

  const midCtx = intermediate.getContext('2d', { willReadFrequently: true });
  const smallCtx = mosaic.getContext('2d', { willReadFrequently: true });
  if (!midCtx || !smallCtx) return null;

  midCtx.imageSmoothingEnabled = true;
  midCtx.imageSmoothingQuality = 'high';
  midCtx.drawImage(bitmap, 0, 0, INTERMEDIATE_SIZE, INTERMEDIATE_SIZE);

  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = 'high';
  smallCtx.drawImage(intermediate, 0, 0, HASH_GRID, HASH_GRID);

  const { data } = smallCtx.getImageData(0, 0, HASH_GRID, HASH_GRID);
  const luma: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    luma.push(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
  }
  return luma.length === HASH_GRID * HASH_GRID ? luma : null;
}

function handleFrame(message: Extract<WorkerRequest, { type: 'frame' }>): void {
  const startedAt = performance.now();
  let face: FaceFrameResult | null = null;
  let loop: LoopFinding | null = null;

  try {
    // La deteccion de bucle no depende de que haya cara: un video pausado o una
    // camara tapada tampoco la tienen, y son justo dos de los casos que busca.
    const luma = lumaMosaic(message.bitmap);
    if (luma) loop = loopDetector.push(frameSignature(luma), message.timestampMs);

    const results = landmarker?.detectForVideo(message.bitmap, message.timestampMs);
    const landmarks = results?.faceLandmarks?.[0];
    if (landmarks && landmarks.length > 0) {
      const matrix = results?.facialTransformationMatrixes?.[0]?.data;
      face = analyzer.push(
        landmarks,
        message.timestampMs,
        message.audioEnergy,
        matrix ? eulerFromMatrix(matrix) : null,
      );
    }
  } catch {
    // Un frame que falla es un frame perdido, no una sesion perdida.
    face = null;
  } finally {
    // Sin esto el ImageBitmap transferido se queda ocupando memoria de GPU
    // hasta que pase el recolector, y a 30 fps eso es medio gigabyte por minuto.
    message.bitmap.close();
  }

  // Se responde SIEMPRE, incluso cuando el analisis fallo. El hilo principal
  // solo tiene un frame en vuelo cada vez; si una respuesta no llegara, dejaria
  // de mandar frames para siempre y el escudo se apagaria sin decir nada.
  ctx.postMessage({
    type: 'result',
    frameId: message.frameId,
    durationMs: performance.now() - startedAt,
    face,
    loop,
  });
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      init(message.budget.delegate)
        .then(() => ctx.postMessage({ type: 'ready', delegate: message.budget.delegate }))
        .catch((error: unknown) =>
          ctx.postMessage({
            type: 'init-failed',
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      return;

    case 'frame':
      handleFrame(message);
      return;

    case 'reset':
      // No hay caso 'dispose': terminar el worker desde el hilo principal
      // destruye el contexto entero —heap de WASM, contexto de GPU y modelo
      // incluidos— asi que un mensaje de despedida solo seria una carrera
      // contra terminate() que casi siempre perderia.
      analyzer.reset();
      loopDetector.reset();
      return;
  }
});
