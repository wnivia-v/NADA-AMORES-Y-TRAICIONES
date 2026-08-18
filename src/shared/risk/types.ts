// =============================================================================
// Contrato de señal
//
// Todo lo que detecta algo en NADA habla este idioma: una puntuacion con una
// confianza y una hora. Ni veredictos ni etiquetas — de eso se encarga el motor
// de fusion, que es el unico que decide.
// =============================================================================

export type SignalType =
  /** Puntuacion de un LLM. Nunca decide sola; es una opinion entre varias. */
  | 'llm-risk'
  /** Patrones regex del lexico. Deterministas, pero literales. */
  | 'local-patterns'
  /**
   * Amenaza explicita de una categoria tasada.
   *
   * La unica señal que puede disparar una alerta por si sola. Ver
   * EXPLICIT_THREAT_CATEGORIES en config.ts para la lista cerrada y el motivo.
   */
  | 'explicit-threat'
  /** URL marcada por Safe Browsing. */
  | 'unsafe-urls'
  /** Coincidencia exacta en la base local de estafas ya confirmadas. */
  | 'scam-db'
  /** El mensaje intento manipular al analizador. Empuja, no decide. */
  | 'injection-attempt'
  /** Biometria facial del escudo de video (Fase 4). */
  | 'deepfake';

/**
 * La forma que pide el brief: { tipo, valor, confianza, timestamp }.
 *
 * `confidence` no es decoracion. Un fragmento de voz de cuatro palabras y un
 * mensaje completo pueden dar la misma puntuacion queriendo decir cosas muy
 * distintas; sin la confianza, el motor no puede notar la diferencia.
 */
export interface RiskSignal {
  type: SignalType;
  /** 0-100. */
  value: number;
  /** 0-1. */
  confidence: number;
  /** Milisegundos epoch. Define la ventana a la que pertenece. */
  timestamp: number;
}

export type RiskBand = 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';

/** Cuanto aporto una señal al resultado, ya decaida y ponderada. */
export interface SignalContribution {
  type: SignalType;
  /** Evidencia efectiva 0-1 tras peso, confianza y decaimiento. */
  evidence: number;
  ageMs: number;
}

export interface FusionResult {
  /** Puntuacion fusionada 0-100. */
  score: number;
  band: RiskBand;
  /**
   * Confianza del resultado, no de una señal suelta. Sube con la corroboracion
   * y baja cuando todo depende de una sola fuente.
   */
  confidence: number;
  /** Dos o mas tipos de señal independientes sostienen el resultado. */
  corroborated: boolean;
  /** Habia una amenaza explicita de categoria tasada en la ventana. */
  explicitThreat: boolean;
  /**
   * Si procede AVISAR al usuario — tono, notificacion, entrada en alertas.
   *
   * Distinto de `band`. El principio del proyecto dice que ninguna ALERTA salta
   * por una señal aislada, no que haya que ocultar el riesgo: la banda se
   * muestra siempre y con honestidad, la alarma se reserva para lo corroborado
   * o para una amenaza explicita.
   */
  alert: boolean;
  /** Que sostuvo el resultado, de mayor a menor. Para el panel de diagnostico. */
  drivers: SignalContribution[];
  /** Cuantas señales habia en la ventana. */
  signalCount: number;
}
