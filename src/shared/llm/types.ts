// =============================================================================
// Contrato del limite con el LLM
//
// Una sola idea gobierna este modulo: el texto que analiza NADA es, por
// definicion, texto escrito por el atacante. Ese es el producto. De modo que
// nunca puede viajar como instruccion, y lo que el modelo responde nunca puede
// ser un veredicto — solo una señal que el codigo propio fusiona y decide.
// =============================================================================

export type AnalysisTask = 'text' | 'voice';

/** Que encontro el endurecimiento de entrada. No viaja al modelo: alimenta el riesgo. */
export interface HardeningReport {
  /** Longitud del texto tal y como llego, antes de recortar. */
  originalLength: number;
  /** True si hubo que recortar por el tope de longitud. */
  truncated: boolean;
  /** Caracteres invisibles (zero-width, control bidi) eliminados. */
  invisibleCharsRemoved: number;
  /** Homoglifos (cirilico/griego disfrazados de latino) plegados. */
  homoglyphsFolded: number;
  /** Intentos de inyeccion detectados. Son SEÑAL de riesgo, no una defensa. */
  injectionAttempts: InjectionHit[];
}

export interface InjectionHit {
  /** Identificador estable del patron, para telemetria y tests. */
  id: string;
  /** Fragmento que disparo la deteccion, recortado. Solo para diagnostico. */
  excerpt: string;
}

/**
 * Lo que se manda a analizar.
 *
 * Fijate en lo que NO hay aqui: no hay campo `prompt`. El texto del usuario no
 * se puede concatenar dentro de las instrucciones porque no existe la costura
 * donde hacerlo. La plantilla la elige el transporte a partir de `task`.
 */
export interface AnalysisRequest {
  task: AnalysisTask;
  /** Texto endurecido, listo para viajar como DATO. */
  text: string;
  hardening: HardeningReport;
}

/**
 * Lo que devuelve un proveedor. Es deliberadamente una señal:
 * no hay campo `verdict`, porque la decision no la toma un LLM (§4.1, §4.2).
 * La forma { type, value, confidence, timestamp } es la que consumira el motor
 * de fusion de la Fase 2.
 */
export interface ProviderSignal {
  type: 'llm-risk';
  /** 0-100. Una puntuacion, no una etiqueta. */
  value: number;
  /** 0-1. Cuanta confianza declara el modelo en su propia puntuacion. */
  confidence: number;
  timestamp: number;
  tactics: string[];
  explanation: string;
  recommendations: string[];
}

/** Por que se rechazo una respuesta. Se registra; nunca se convierte en SEGURO. */
export type SignalRejection =
  | 'not-json'
  | 'not-object'
  | 'missing-risk-score'
  | 'risk-score-out-of-range'
  | 'oversized';

export interface SignalParseResult {
  signal: ProviderSignal | null;
  rejection?: SignalRejection;
}
