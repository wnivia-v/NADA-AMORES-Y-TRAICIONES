// =============================================================================
// Motor de fusion — ventana deslizante con acumulacion de evidencia
//
// Sustituye a utils/riskScorer.ts, que tenia cuatro problemas de fondo:
//
//   1. Era un singleton global. El escudo de voz, el portapapeles y el OCR de
//      pantalla compartian la misma bolsa de señales, asi que una llamada
//      sospechosa contaminaba el veredicto de lo que copiabas al portapapeles.
//      Aqui cada carril tiene su motor.
//
//   2. Promediaba. `getCompositeScore()` dividia entre el peso total, asi que
//      una señal alta rodeada de bajas se hundia hacia la media. Es el mismo
//      error que dio 46% de precision en el clasificador local antes de cambiar
//      media por votacion. Aqui la evidencia se acumula.
//
//   3. La ventana era de 5 minutos. El brief pide 15-30 s.
//
//   4. Ignoraba la confianza. Una señal con confianza 0.3 pesaba igual que una
//      con 0.95.
//
// La acumulacion es un noisy-OR: cada señal es evidencia independiente de que
// algo va mal, y se combinan como 1 - Π(1 - pᵢ). Esa forma tiene justo las
// propiedades que hacen falta: dos señales medias suman mas que cualquiera de
// ellas (corroboracion), muchas señales debiles no llegan a alarma (no se
// disparan falsos positivos por acumulacion de ruido), y nunca se pasa de 100.
// =============================================================================

import {
  DEFAULT_FUSION_CONFIG,
  type FusionConfig,
} from './config';
import type {
  FusionResult,
  RiskBand,
  RiskSignal,
  SignalContribution,
  SignalType,
} from './types';

export class FusionEngine {
  private signals: RiskSignal[] = [];
  private readonly config: FusionConfig;

  constructor(config: Partial<FusionConfig> = {}) {
    this.config = { ...DEFAULT_FUSION_CONFIG, ...config };
  }

  /** Añade una señal y descarta lo que ya salio de la ventana. */
  add(signal: RiskSignal): void {
    this.signals.push({
      ...signal,
      value: clamp(signal.value, 0, 100),
      confidence: clamp(signal.confidence, 0, 1),
    });
    this.prune(signal.timestamp);
  }

  /** Atajo para las fuentes que no declaran confianza propia. */
  addSignal(type: SignalType, value: number, confidence = 1, timestamp = Date.now()): void {
    this.add({ type, value, confidence, timestamp });
  }

  /**
   * Fusiona lo que hay en la ventana.
   *
   * `now` es parametro y no `Date.now()` para que el banco de pruebas pueda
   * reproducir una secuencia temporal completa sin esperar 30 segundos reales.
   */
  fuse(now = Date.now()): FusionResult {
    this.prune(now);

    const { windowMs, sourceWeights, minEvidence, edgeDecay, thresholds } = this.config;

    const contributions: SignalContribution[] = [];
    // Evidencia combinada por tipo: dos aciertos del mismo detector son un
    // detector insistiendo, no dos fuentes coincidiendo. Se quedan agrupados
    // para que repetir la misma señal no simule corroboracion.
    const evidenceByType = new Map<SignalType, number>();

    for (const signal of this.signals) {
      const ageMs = Math.max(0, now - signal.timestamp);
      if (ageMs > windowMs) continue;

      const decay = 1 - (1 - edgeDecay) * (ageMs / windowMs);
      const weight = sourceWeights[signal.type] ?? 0.5;
      const evidence = (signal.value / 100) * signal.confidence * weight * decay;
      if (evidence <= 0) continue;

      contributions.push({ type: signal.type, evidence, ageMs });

      // Noisy-OR tambien dentro del tipo.
      const previous = evidenceByType.get(signal.type) ?? 0;
      evidenceByType.set(signal.type, previous + evidence - previous * evidence);
    }

    if (evidenceByType.size === 0) {
      return {
        score: 0,
        band: 'SEGURO',
        confidence: 0,
        corroborated: false,
        explicitThreat: false,
        alert: false,
        drivers: [],
        signalCount: 0,
      };
    }

    // Combinacion final entre tipos distintos.
    let combined = 0;
    for (const evidence of evidenceByType.values()) {
      combined = combined + evidence - combined * evidence;
    }

    const score = Math.round(combined * 100);
    const band = this.bandFor(score, thresholds);

    const explicitThreat = (evidenceByType.get('explicit-threat') ?? 0) >= minEvidence;
    const supportingTypes = [...evidenceByType.values()].filter((e) => e >= minEvidence).length;
    const corroborated = supportingTypes >= 2;

    contributions.sort((a, b) => b.evidence - a.evidence);

    return {
      score,
      band,
      confidence: this.confidenceFor(evidenceByType, supportingTypes),
      corroborated,
      explicitThreat,
      // La puerta del §3: la banda se muestra siempre, la alarma no.
      alert: band !== 'SEGURO' && (corroborated || explicitThreat),
      drivers: contributions,
      signalCount: contributions.length,
    };
  }

  /** Vacia la ventana. Al terminar una llamada o cambiar de conversacion. */
  clear(): void {
    this.signals = [];
  }

  /** Señales vivas ahora mismo. Para el panel de diagnostico y los tests. */
  active(now = Date.now()): RiskSignal[] {
    return this.signals.filter((s) => now - s.timestamp <= this.config.windowMs);
  }

  private bandFor(score: number, thresholds: FusionConfig['thresholds']): RiskBand {
    if (score >= thresholds.dangerous) return 'PELIGROSO';
    if (score >= thresholds.suspicious) return 'SOSPECHOSO';
    return 'SEGURO';
  }

  /**
   * Confianza del resultado.
   *
   * Sube con el numero de fuentes independientes y con lo fuerte que sea la
   * mejor de ellas. Un unico detector convencido no es lo mismo que tres
   * coincidiendo, y el usuario merece saber cual de los dos casos tiene delante.
   */
  private confidenceFor(evidenceByType: Map<SignalType, number>, supportingTypes: number): number {
    const strongest = Math.max(...evidenceByType.values());
    const corroborationBonus = Math.min(0.3, Math.max(0, supportingTypes - 1) * 0.15);
    return Math.round(Math.min(1, strongest * 0.7 + corroborationBonus) * 100) / 100;
  }

  /** Fuera de la ventana no hay nada que recordar. */
  private prune(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.signals = this.signals.filter((s) => s.timestamp > cutoff);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// =============================================================================
// Motores por carril
//
// Un carril es una conversacion en curso: lo que se oye por el microfono, lo que
// pasa por el portapapeles, lo que se ve en pantalla. Son independientes, y
// mezclarlos era la razon de que una alerta de voz subiera el riesgo de un texto
// pegado un minuto despues.
// =============================================================================

export type RiskLane = 'ui' | 'clipboard' | 'screen' | 'voice' | 'video';

const lanes = new Map<RiskLane, FusionEngine>();

export function getFusionEngine(lane: RiskLane): FusionEngine {
  let engine = lanes.get(lane);
  if (!engine) {
    engine = new FusionEngine();
    lanes.set(lane, engine);
  }
  return engine;
}

export function clearLane(lane: RiskLane): void {
  lanes.get(lane)?.clear();
}

export function clearAllLanes(): void {
  for (const engine of lanes.values()) engine.clear();
}
