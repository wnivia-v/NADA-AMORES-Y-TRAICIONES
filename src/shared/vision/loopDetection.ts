// =============================================================================
// Deteccion de bucle
//
// El ataque que mas barato le sale al estafador: en vez de generar un deepfake
// en tiempo real, reproduce un video grabado de la persona que suplanta. No hay
// modelo que entrenar ni GPU que pagar — basta con un clip y un poco de cara.
//
// Contra eso la biometria facial no sirve: el clip ES una cara real, parpadea
// como una cara real y tiene el pulso de una cara real, porque lo era cuando se
// grabo. Lo que delata al clip no esta en la cara, esta en el tiempo: un video
// en bucle repite, y una persona no.
//
// Se mide con una firma perceptual de cada frame reducido. Frames identicos
// significan imagen congelada; frames que repiten una secuencia vista hace unos
// segundos significan bucle.
//
// Funciones puras sobre luminancias: se prueban con matrices inventadas, sin
// camara y sin navegador.
// =============================================================================

/** Lado del mosaico sobre el que se calcula la firma. 8x8 = 64 celdas. */
export const HASH_GRID = 8;

/**
 * Firma perceptual de un frame.
 *
 * Cada bit dice si esa celda es mas clara que la media del frame. Eso la hace
 * indiferente al brillo global y al ruido de compresion —que cambian en todas
 * las celdas a la vez— y sensible a que se mueva algo dentro de la imagen, que
 * es lo unico que interesa.
 *
 * `luma` son HASH_GRID*HASH_GRID luminancias 0-255 en orden de lectura.
 */
export function frameSignature(luma: readonly number[]): bigint {
  const cells = HASH_GRID * HASH_GRID;
  if (luma.length !== cells) {
    throw new Error(`frameSignature espera ${cells} luminancias, recibio ${luma.length}`);
  }

  let sum = 0;
  for (const value of luma) sum += value;
  const mean = sum / cells;

  let signature = 0n;
  for (let i = 0; i < cells; i += 1) {
    if ((luma[i] ?? 0) > mean) signature |= 1n << BigInt(i);
  }
  return signature;
}

/** Cuantos bits difieren entre dos firmas. 0 = identicas, 64 = opuestas. */
export function hammingDistance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

export interface LoopFinding {
  kind: 'frozen' | 'looping';
  /** 0-100. Cuanta confianza hay en el hallazgo. */
  confidence: number;
  /** Segundos que dura el ciclo detectado. Solo en 'looping'. */
  periodSeconds?: number;
  explanation: string;
}

export interface LoopDetectorOptions {
  /** Firmas guardadas. A 5 fps, 150 son 30 s de historia. */
  historySize?: number;
  /** Distancia por debajo de la cual dos frames se consideran el mismo. */
  identicalThreshold?: number;
  /** Cuantos frames iguales seguidos antes de declarar imagen congelada. */
  frozenRun?: number;
  /** Cuantas coincidencias seguidas hacen falta para declarar bucle. */
  loopRun?: number;
}

interface Entry {
  signature: bigint;
  at: number;
}

export class LoopDetector {
  private readonly historySize: number;
  private readonly identicalThreshold: number;
  private readonly frozenRun: number;
  private readonly loopRun: number;

  private history: Entry[] = [];
  private frozenCount = 0;
  /** Desfase (en frames) del ciclo que se esta siguiendo, si hay alguno. */
  private candidateLag: number | null = null;
  private candidateHits = 0;

  constructor(options: LoopDetectorOptions = {}) {
    this.historySize = options.historySize ?? 150;
    // 6 bits de 64. Ni 0 (el ruido de codificacion mueve algun bit hasta en un
    // frame repetido de verdad) ni tan alto que dos planos parecidos cuenten
    // como el mismo.
    this.identicalThreshold = options.identicalThreshold ?? 6;
    this.frozenRun = options.frozenRun ?? 10;
    this.loopRun = options.loopRun ?? 8;
  }

  /** Añade un frame y devuelve el hallazgo, si lo hay. */
  push(signature: bigint, at: number): LoopFinding | null {
    const previous = this.history[this.history.length - 1];
    this.history.push({ signature, at });
    if (this.history.length > this.historySize) this.history.shift();

    const frozen = this.checkFrozen(signature, previous);
    if (frozen) return frozen;

    return this.checkLoop(signature, at);
  }

  reset(): void {
    this.history = [];
    this.frozenCount = 0;
    this.candidateLag = null;
    this.candidateHits = 0;
  }

  /**
   * Imagen congelada: el mismo frame una y otra vez.
   *
   * Casi siempre es una camara tapada o un video pausado, no un ataque. Se
   * informa igual, con confianza moderada, porque durante una videollamada que
   * la imagen se congele justo cuando piden dinero tambien significa algo.
   */
  private checkFrozen(signature: bigint, previous: Entry | undefined): LoopFinding | null {
    if (!previous || hammingDistance(signature, previous.signature) > this.identicalThreshold) {
      this.frozenCount = 0;
      return null;
    }

    this.frozenCount += 1;
    if (this.frozenCount < this.frozenRun) return null;

    return {
      kind: 'frozen',
      confidence: 55,
      explanation: 'La imagen lleva varios segundos sin cambiar: puede estar congelada o ser una foto fija.',
    };
  }

  /**
   * Bucle: el frame de ahora ya se vio hace N frames, y el anterior tambien se
   * vio hace N, y el anterior tambien.
   *
   * Exigir la cadena entera es lo que separa un bucle de una casualidad. Que un
   * frame se parezca a otro de hace cinco segundos pasa constantemente —
   * alguien que mira a camara quieto produce docenas de frames parecidos. Que
   * ocurra ocho veces seguidas con el MISMO desfase, no.
   */
  private checkLoop(signature: bigint, at: number): LoopFinding | null {
    const n = this.history.length;
    // Desfase minimo de 15 frames: por debajo es quietud, no repeticion.
    const minLag = 15;
    if (n < minLag * 2) return null;

    if (this.candidateLag !== null) {
      const previousIndex = n - 1 - this.candidateLag;
      const candidate = this.history[previousIndex];
      if (candidate && hammingDistance(signature, candidate.signature) <= this.identicalThreshold) {
        this.candidateHits += 1;
        if (this.candidateHits >= this.loopRun) {
          const periodSeconds = (at - candidate.at) / 1000;
          return {
            kind: 'looping',
            // Alta, pero no total: un fondo muy estatico puede engañarlo.
            confidence: 78,
            periodSeconds: Math.round(periodSeconds * 10) / 10,
            explanation:
              `El video repite un ciclo de unos ${periodSeconds.toFixed(1)} s. ` +
              'Puede ser una grabacion reproducida en bucle en vez de una persona en directo.',
          };
        }
        return null;
      }
      // Se rompio la cadena: este desfase no era el bueno.
      this.candidateLag = null;
      this.candidateHits = 0;
    }

    // Buscar un desfase candidato: el frame mas antiguo que coincide con este.
    for (let lag = minLag; lag < n; lag += 1) {
      const candidate = this.history[n - 1 - lag];
      if (!candidate) continue;
      if (hammingDistance(signature, candidate.signature) <= this.identicalThreshold) {
        this.candidateLag = lag;
        this.candidateHits = 1;
        break;
      }
    }
    return null;
  }
}
