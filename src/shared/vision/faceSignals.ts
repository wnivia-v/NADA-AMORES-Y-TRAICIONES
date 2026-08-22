// =============================================================================
// Señales faciales — matematica pura sobre landmarks
//
// Esto vivia dentro de visionService, mezclado con el <video>, el AudioContext y
// MediaPipe. Al sacar el analisis a un Web Worker habia que separarlo de todas
// formas, y separarlo tiene una consecuencia que va mas alla del worker: el
// cerebro del detector deja de necesitar una camara para probarse. Antes, la
// unica manera de comprobar si un parpadeo se contaba bien era ponerse delante
// del portatil y parpadear.
//
// Dos cambios de fondo respecto a la version anterior:
//
//   1. `now` entra como parametro en vez de llamar a Date.now() por dentro. Un
//      detector con reloj propio no se puede probar sin esperar en tiempo real:
//      el warm-up del parpadeo son 20 segundos.
//   2. Se calcula la pose (yaw/pitch) a partir de la matriz de transformacion
//      facial. MediaPipe ya la venia devolviendo —el codigo pedia
//      outputFacialTransformationMatrixes: true— y nadie la leia nunca. Sin
//      pose no hay reto activo, que es lo unico que distingue a una persona de
//      una grabacion.
// =============================================================================

import { correlate, lipSyncScoreFromCorrelation } from '@/utils/lipSync';

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

// Indices del mesh de 478 puntos de FaceLandmarker.
const EYE_LEFT = [33, 160, 158, 133, 153, 144] as const;
const EYE_RIGHT = [362, 385, 387, 263, 373, 380] as const;
const MOUTH_TOP = 13;
const MOUTH_BOTTOM = 14;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;
const JITTER_POINTS = [1, 4, 6, 10, 152, 234, 454] as const;

/** EAR por debajo del cual se considera el ojo cerrado. */
export const BLINK_EAR_THRESHOLD = 0.2;

/**
 * Ventana de muestras mouth/audio guardadas para la correlacion. A 30 fps son
 * unos 3 s, que es la ventana que usan el resto de heuristicas.
 */
const SYNC_SAMPLE_LIMIT = 90;

/**
 * Una persona parpadea unas 15-20 veces por minuto. `blinkRate` se mide sobre
 * una ventana movil de 60 s desde que arranca el analisis, asi que al principio
 * de CUALQUIER sesion —tambien con una cara real y viva delante— todavia no ha
 * dado tiempo a acumular un numero normal de parpadeos. Puntuar eso como
 * "parpadeo sospechosamente bajo" era un falso positivo sistematico sobre
 * personas reales al empezar cada sesion, que es justo cuando alguien esta
 * mirando la pantalla con atencion.
 */
export const BLINK_WARMUP_MS = 20_000;

export interface BiometricSignals {
  earLeft: number;
  earRight: number;
  /** Parpadeos en los ultimos 60 s. */
  blinkRate: number;
  /** 0-1. 1 = sincronia perfecta. */
  lipSyncScore: number;
  /** False cuando no habia audio con el que comparar. */
  lipSyncMeasured: boolean;
  /** 0-1. 1 = muy inestable. */
  jitterScore: number;
  headPoseStable: boolean;
}

export interface HeadPose {
  /** Grados. Negativo = gira hacia su izquierda. */
  yaw: number;
  /** Grados. Negativo = mira hacia arriba. */
  pitch: number;
  /** Grados. Inclinacion lateral de la cabeza. */
  roll: number;
}

export interface FaceFrameResult {
  signals: BiometricSignals;
  /** Sospecha 0-100 que aporta la biometria. */
  confidence: number;
  isLikelyDeepfake: boolean;
  explanation: string;
  /** Pose + escala + parpadeos acumulados, para el reto activo. */
  pose: { yaw: number; pitch: number; blinkCount: number; faceScale: number };
}

/** Eye Aspect Ratio: apertura vertical del ojo relativa a su anchura. */
export function eyeAspectRatio(landmarks: readonly Landmark[], side: 'left' | 'right'): number {
  const indices = side === 'left' ? EYE_LEFT : EYE_RIGHT;
  const p = indices.map((i) => landmarks[i]);
  if (p.some((pt) => !pt)) return 0.3;

  const horizontal = Math.abs(p[0]!.x - p[3]!.x);
  // Un ojo de anchura cero no es un ojo cerrado: es una medida que no salio.
  // Sin este corte, la division por el epsilon devuelve un EAR ~0 y el
  // resultado se cuenta como parpadeo — o sea que una deteccion fallida
  // fabricaria parpadeos que nadie ha dado. Se devuelve el valor neutro, el
  // mismo que cuando faltan landmarks.
  if (horizontal < 1e-4) return 0.3;

  const vertical1 = Math.abs(p[1]!.y - p[5]!.y);
  const vertical2 = Math.abs(p[2]!.y - p[4]!.y);
  return (vertical1 + vertical2) / (2 * horizontal + 0.001);
}

/** Mouth Aspect Ratio: apertura vertical de la boca relativa a su anchura. */
export function mouthAspectRatio(landmarks: readonly Landmark[]): number {
  const top = landmarks[MOUTH_TOP];
  const bottom = landmarks[MOUTH_BOTTOM];
  const left = landmarks[MOUTH_LEFT];
  const right = landmarks[MOUTH_RIGHT];
  if (!top || !bottom || !left || !right) return 0;

  const vertical = Math.abs(top.y - bottom.y);
  const horizontal = Math.abs(left.x - right.x) + 0.001;
  return vertical / horizontal;
}

/** Cuanto se han movido unos puntos de referencia entre dos frames. 0-1. */
export function landmarkJitter(
  current: readonly Landmark[],
  previous: readonly Landmark[] | null,
): number {
  if (!previous) return 0;

  let totalDiff = 0;
  for (const idx of JITTER_POINTS) {
    const a = current[idx];
    const b = previous[idx];
    if (a && b) totalDiff += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return Math.min(1, (totalDiff / JITTER_POINTS.length) * 50);
}

/** Fraccion del encuadre que ocupa la cara, 0-1. Sirve para el gesto "acercate". */
export function faceScale(landmarks: readonly Landmark[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return 0;

  return Math.max(0, Math.min(1, (maxX - minX) * (maxY - minY)));
}

/**
 * Angulos de Euler en grados a partir de la matriz 4x4 de transformacion facial
 * que devuelve MediaPipe (16 numeros, orden por columnas).
 *
 * Convencion: R = Rz(roll)·Ry(yaw)·Rx(pitch), con la matriz de rotacion en la
 * submatriz 3x3 superior izquierda. De ahi salen las tres igualdades que se
 * usan abajo. Se documenta porque una extraccion de Euler sin convencion
 * declarada es imposible de revisar: hay una docena de convenciones y todas
 * dan numeros distintos con la misma matriz.
 *
 * Los tests construyen matrices de rotacion conocidas y comprueban que se
 * recuperan los angulos, o sea que verifican la matematica. Lo que NO se puede
 * verificar sin una camara real es si el signo coincide con la orientacion que
 * entrega MediaPipe con un feed espejado o sin espejar: eso hay que calibrarlo
 * delante de una webcam antes de dar el reto activo por bueno.
 */
export function eulerFromMatrix(m: readonly number[]): HeadPose | null {
  if (m.length < 16) return null;

  // R[fila][columna] = m[columna * 4 + fila]
  const r00 = m[0]!;
  const r10 = m[1]!;
  const r20 = m[2]!;
  const r21 = m[6]!;
  const r22 = m[10]!;

  const toDeg = 180 / Math.PI;
  const clamped = Math.max(-1, Math.min(1, -r20));
  const yaw = Math.asin(clamped);

  // Cerca de +-90 grados de yaw, pitch y roll dejan de ser separables (bloqueo
  // de cardan): cos(yaw) tiende a 0 y los dos atan2 se vuelven ruido. Con la
  // cara tan de perfil MediaPipe ya casi no ve landmarks, asi que se declara
  // roll 0 en vez de devolver un numero inventado.
  const cosYaw = Math.cos(yaw);
  if (Math.abs(cosYaw) < 1e-4) {
    return { yaw: yaw * toDeg, pitch: 0, roll: 0 };
  }

  return {
    yaw: yaw * toDeg,
    pitch: Math.atan2(r21, r22) * toDeg,
    roll: Math.atan2(r10, r00) * toDeg,
  };
}

/**
 * Estado acumulado del analisis facial de una sesion.
 *
 * Es el cerebro del detector: recibe landmarks frame a frame y mantiene todo lo
 * que necesita historia —parpadeos, jitter, correlacion labial— sin tocar
 * ninguna API del navegador. Vive dentro del worker, y en los tests vive solo.
 */
export class FaceAnalyzer {
  private blinkTimestamps: number[] = [];
  private blinkTotal = 0;
  private previousLandmarks: readonly Landmark[] | null = null;
  private sessionStartedAt: number | null = null;
  private marHistory: number[] = [];
  private energyHistory: number[] = [];

  /**
   * Procesa un frame.
   *
   * `audioEnergy` viene de fuera a proposito: el AnalyserNode de la Web Audio
   * API no existe dentro de un worker, asi que la energia se muestrea en el
   * hilo principal en el mismo instante en que se captura el frame y viaja con
   * el. `null` significa que no habia pista de audio — y entonces la sincronia
   * labial se queda explicitamente sin medir, que es distinto de medirla bien.
   */
  push(landmarks: readonly Landmark[], now: number, audioEnergy: number | null, pose: HeadPose | null): FaceFrameResult {
    if (this.sessionStartedAt === null) this.sessionStartedAt = now;

    const earLeft = eyeAspectRatio(landmarks, 'left');
    const earRight = eyeAspectRatio(landmarks, 'right');
    const avgEar = (earLeft + earRight) / 2;

    if (avgEar < BLINK_EAR_THRESHOLD) {
      this.blinkTimestamps.push(now);
      this.blinkTotal += 1;
    }
    const oneMinuteAgo = now - 60_000;
    this.blinkTimestamps = this.blinkTimestamps.filter((t) => t > oneMinuteAgo);
    const blinkRate = this.blinkTimestamps.length;

    const jitterScore = landmarkJitter(landmarks, this.previousLandmarks);
    const { score: lipSyncScore, measured: lipSyncMeasured } = this.updateLipSync(
      mouthAspectRatio(landmarks),
      audioEnergy,
    );

    this.previousLandmarks = landmarks;

    const signals: BiometricSignals = {
      earLeft,
      earRight,
      blinkRate,
      lipSyncScore,
      lipSyncMeasured,
      jitterScore,
      headPoseStable: jitterScore < 0.3,
    };

    const ready = this.blinkRateReady(now);
    const isLikelyDeepfake = evaluateDeepfake(signals, ready);
    const confidence = deepfakeConfidence(signals, ready);

    const lipSyncNote = lipSyncMeasured
      ? `, sincronia labial ${lipSyncScore < 0.55 ? 'desincronizada' : 'normal'}`
      : ', sincronia labial sin verificar (sin audio)';
    // El parpadeo solo se menciona cuando de verdad conto para el veredicto.
    // Durante el warm-up se mide pero se ignora, y nombrarlo en la explicacion
    // atribuiria a una señal con peso cero una deteccion que en realidad vino
    // del jitter o de la sincronia labial.
    const blinkNote = ready ? `parpadeo ${blinkRate < 5 ? 'muy bajo' : 'irregular'}, ` : '';

    return {
      signals,
      confidence,
      isLikelyDeepfake,
      explanation: isLikelyDeepfake
        ? `Anomalias biometricas: ${blinkNote}jitter ${jitterScore > 0.5 ? 'alto' : 'medio'}${lipSyncNote}`
        : `Patrones biometricos normales${lipSyncNote}.`,
      pose: {
        yaw: pose?.yaw ?? 0,
        pitch: pose?.pitch ?? 0,
        blinkCount: this.blinkTotal,
        faceScale: faceScale(landmarks),
      },
    };
  }

  reset(): void {
    this.blinkTimestamps = [];
    this.blinkTotal = 0;
    this.previousLandmarks = null;
    this.sessionStartedAt = null;
    this.marHistory = [];
    this.energyHistory = [];
  }

  /** True cuando ha pasado tiempo suficiente para que una TASA de parpadeo signifique algo. */
  blinkRateReady(now: number): boolean {
    return this.sessionStartedAt !== null && now - this.sessionStartedAt >= BLINK_WARMUP_MS;
  }

  private updateLipSync(mar: number, energy: number | null): { score: number; measured: boolean } {
    if (energy === null) return { score: 0.75, measured: false };

    this.marHistory.push(mar);
    this.energyHistory.push(energy);
    if (this.marHistory.length > SYNC_SAMPLE_LIMIT) this.marHistory.shift();
    if (this.energyHistory.length > SYNC_SAMPLE_LIMIT) this.energyHistory.shift();

    return lipSyncScoreFromCorrelation(correlate(this.marHistory, this.energyHistory));
  }
}

/**
 * Heuristica de deepfake: hacen falta al menos dos señales fuertes.
 *
 * Es la misma regla que el motor de fusion aplica arriba —ninguna alerta se
 * dispara por una señal aislada— aplicada aqui dentro, donde las señales son
 * biometricas y no hay LLM de por medio.
 */
export function evaluateDeepfake(signals: BiometricSignals, blinkReady: boolean): boolean {
  let score = 0;
  if (blinkReady && (signals.blinkRate < 5 || signals.blinkRate > 40)) score += 2;
  if (signals.jitterScore > 0.5) score += 2;
  // Solo cuenta como evidencia cuando de verdad hubo audio con el que comparar:
  // una sincronia labial sin medir no puede empujar el veredicto hacia deepfake.
  if (signals.lipSyncMeasured && signals.lipSyncScore < 0.55) score += 2;
  if (!signals.headPoseStable) score += 1;
  return score >= 4;
}

export function deepfakeConfidence(signals: BiometricSignals, blinkReady: boolean): number {
  let confidence = 0;
  if (blinkReady) {
    if (signals.blinkRate < 5) confidence += 25;
    if (signals.blinkRate > 40) confidence += 20;
  }
  if (signals.jitterScore > 0.5) confidence += 30;
  if (signals.lipSyncMeasured && signals.lipSyncScore < 0.55) confidence += 25;
  return Math.min(100, confidence);
}
