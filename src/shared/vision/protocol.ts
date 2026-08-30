// =============================================================================
// Protocolo entre el hilo principal y el worker de vision
//
// El limite entre los dos hilos es el sitio donde §4.1 se hace verificable. Por
// aqui viajan frames faciales, asi que conviene que este escrito en un solo
// archivo y se pueda leer entero de una vez: lo que cruza en un sentido son
// ImageBitmap TRANSFERIDOS (el hilo principal pierde la referencia en el acto),
// y lo que vuelve en el otro son numeros. Ningun pixel vuelve, ninguno se
// guarda, y ninguno de estos mensajes sale del dispositivo — no hay ninguna
// ruta desde aqui hacia la red.
// =============================================================================

import type { FaceFrameResult } from './faceSignals';
import type { LoopFinding } from './loopDetection';
import type { TierBudget } from './deviceTier';

/**
 * Version del runtime WASM de MediaPipe que se sirve desde public/.
 *
 * Los archivos se copian desde node_modules en cada build
 * (scripts/copy-mediapipe-wasm.mjs), asi que esta constante no elige nada: es
 * documentacion, y un test la contrasta con la version instalada para que no se
 * quede mintiendo cuando alguien actualice el paquete.
 */
export const MEDIAPIPE_VERSION = '1.0.1';

/**
 * Ruta del runtime WASM, en el propio origen.
 *
 * Antes esto apuntaba a `cdn.jsdelivr.net/...@latest/wasm`. Servirlo desde casa
 * arregla tres cosas a la vez: el JS y el WASM dejan de poder desincronizarse
 * (son la misma version por construccion), la CSP deja de tener que permitir
 * ejecutar script de un dominio ajeno, y el detector facial arranca sin
 * conexion, que es lo minimo para algo que se instala como PWA.
 */
export const MEDIAPIPE_WASM_BASE = '/mediapipe/wasm';

/**
 * Modelo de landmarks faciales, tambien en el propio origen.
 *
 * Lo baja scripts/prepare-mediapipe.mjs de la URL oficial de Google en el
 * primer build. Servirlo desde aqui es lo que permite que el escudo arranque
 * sin conexion: una PWA que acompaña una videollamada no puede depender de que
 * haya internet para encender el detector.
 */
export const FACE_LANDMARKER_MODEL_URL = '/mediapipe/face_landmarker.task';

/** Mensajes del hilo principal hacia el worker. */
export type WorkerRequest =
  | { type: 'init'; budget: TierBudget }
  | {
      type: 'frame';
      /** Correlaciona la respuesta con la peticion. */
      frameId: number;
      bitmap: ImageBitmap;
      /** Reloj monotono del hilo principal. MediaPipe lo exige creciente. */
      timestampMs: number;
      /**
       * Energia RMS del audio en el instante de capturar el frame, o null si no
       * hay pista de audio.
       *
       * Viaja con el frame porque la Web Audio API no existe dentro de un
       * worker: el AnalyserNode se queda en el hilo principal por obligacion, no
       * por diseño. Muestrear alli y mandarlo aqui mantiene emparejadas las dos
       * mitades de la sincronia labial.
       */
      audioEnergy: number | null;
    }
  | { type: 'reset' };

/** Mensajes del worker hacia el hilo principal. Solo numeros y texto. */
export type WorkerResponse =
  | { type: 'ready'; delegate: TierBudget['delegate'] }
  | { type: 'init-failed'; reason: string }
  | {
      type: 'result';
      frameId: number;
      /** Cuanto tardo el analisis. Es lo que gobierna la degradacion termica. */
      durationMs: number;
      /** null cuando no se detecto ninguna cara en el frame. */
      face: FaceFrameResult | null;
      /** Imagen congelada o video en bucle, si lo hay. */
      loop: LoopFinding | null;
    };
