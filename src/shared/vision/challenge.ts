// =============================================================================
// Reto activo
//
// Todo lo demas del escudo es pasivo: mira y puntua. Contra un deepfake bueno o
// una grabacion limpia, mirar no basta — el clip parpadea, tiene pulso y mueve
// la cabeza, porque todo eso lo hacia la persona cuando se grabo.
//
// El reto es lo unico que rompe esa simetria: pide algo que solo puede hacer
// quien esta delante AHORA. Una grabacion no gira la cabeza porque se lo pidas,
// y un deepfake en tiempo real tiene que renderizar un gesto concreto en una
// ventana corta, que es donde se le ven las costuras.
//
// Tres decisiones que sostienen esto:
//
//   1. El gesto se elige al azar en el momento. Uno fijo se pregraba.
//   2. La ventana es corta. Con margen de sobra, al atacante le da tiempo a
//      buscar el clip que toca.
//   3. Fallar NO acusa a nadie. La gente se distrae, mira el movil, no entiende
//      la instruccion o simplemente no le apetece obedecer a una app. Un reto
//      fallado es una señal debil que necesita corroboracion, igual que las
//      demas — no una acusacion de suplantacion.
// =============================================================================

export type GestureId = 'turn-left' | 'turn-right' | 'look-up' | 'blink-twice' | 'lean-in';

export interface Gesture {
  id: GestureId;
  /** Lo que se le pide al usuario, en su idioma. */
  prompt: string;
  /** Como se verifica sobre los landmarks. Solo para diagnostico. */
  criterion: string;
}

export const GESTURES: readonly Gesture[] = [
  { id: 'turn-left', prompt: 'Gira la cabeza despacio hacia tu izquierda', criterion: 'yaw < -18 grados' },
  { id: 'turn-right', prompt: 'Gira la cabeza despacio hacia tu derecha', criterion: 'yaw > 18 grados' },
  { id: 'look-up', prompt: 'Mira hacia arriba un momento', criterion: 'pitch < -12 grados' },
  { id: 'blink-twice', prompt: 'Parpadea dos veces seguidas', criterion: '2 parpadeos en la ventana' },
  { id: 'lean-in', prompt: 'Acercate un poco a la camara', criterion: 'la cara ocupa un 15% mas' },
];

/** Cuanto tiempo tiene el usuario para completar el gesto. */
export const CHALLENGE_WINDOW_MS = 6_000;

export type ChallengeOutcome = 'pending' | 'passed' | 'failed' | 'aborted';

export interface ChallengeState {
  gesture: Gesture;
  startedAt: number;
  outcome: ChallengeOutcome;
  /** Momento en que se resolvio. */
  resolvedAt?: number;
}

/** Señales de pose por frame, ya derivadas de los landmarks. */
export interface PoseSample {
  /** Grados. Negativo = mira a su izquierda. */
  yaw: number;
  /** Grados. Negativo = mira arriba. */
  pitch: number;
  /** Parpadeos acumulados en la sesion. */
  blinkCount: number;
  /** Proporcion del encuadre que ocupa la cara, 0-1. */
  faceScale: number;
}

/**
 * Elige un gesto al azar, evitando repetir el anterior.
 *
 * `random` entra como parametro para poder fijarlo en los tests: un reto que
 * solo se puede probar con Math.random no se puede probar.
 */
export function pickGesture(previous?: GestureId, random: () => number = Math.random): Gesture {
  const pool = previous ? GESTURES.filter((g) => g.id !== previous) : GESTURES;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index] ?? GESTURES[0]!;
}

export function startChallenge(now: number, previous?: GestureId, random?: () => number): ChallengeState {
  return { gesture: pickGesture(previous, random), startedAt: now, outcome: 'pending' };
}

/**
 * Evalua el reto con la muestra de este frame.
 *
 * `baseline` es la pose al empezar el reto: lo que se mide es el CAMBIO, no la
 * postura absoluta. Alguien sentado de lado ya tiene yaw alto sin haber girado
 * nada, y exigirle una postura absoluta seria pedirle que se recoloque para
 * demostrar que existe.
 */
export function evaluateChallenge(
  state: ChallengeState,
  baseline: PoseSample,
  sample: PoseSample,
  now: number,
): ChallengeState {
  if (state.outcome !== 'pending') return state;

  if (now - state.startedAt > CHALLENGE_WINDOW_MS) {
    return { ...state, outcome: 'failed', resolvedAt: now };
  }

  const deltaYaw = sample.yaw - baseline.yaw;
  const deltaPitch = sample.pitch - baseline.pitch;
  const blinks = sample.blinkCount - baseline.blinkCount;
  const scaleRatio = baseline.faceScale > 0 ? sample.faceScale / baseline.faceScale : 1;

  const passed = (() => {
    switch (state.gesture.id) {
      case 'turn-left': return deltaYaw < -18;
      case 'turn-right': return deltaYaw > 18;
      case 'look-up': return deltaPitch < -12;
      case 'blink-twice': return blinks >= 2;
      case 'lean-in': return scaleRatio > 1.15;
      default: return false;
    }
  })();

  return passed ? { ...state, outcome: 'passed', resolvedAt: now } : state;
}

/**
 * Cuanto riesgo aporta el resultado de un reto, en la escala 0-100 del motor.
 *
 * Un reto superado RESTA sospecha de verdad: es la evidencia mas fuerte de que
 * hay una persona delante. Uno fallado suma poco, y a proposito — la causa mas
 * probable de un fallo es que la persona estuviera distraida, no que sea un
 * deepfake. Con la regla de corroboracion de la Fase 2, un reto fallado por si
 * solo no alarma a nadie.
 */
export function challengeSignalValue(outcome: ChallengeOutcome): number | null {
  switch (outcome) {
    case 'passed': return 0;
    case 'failed': return 30;
    default: return null;
  }
}
