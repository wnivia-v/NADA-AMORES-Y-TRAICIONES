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
  /**
   * En que VISTA del texto aparecio.
   *
   * 'plana' es el texto tal cual, ya normalizado. Las demas son el mismo texto
   * deshecho de un disfraz: leetspeak, letras espaciadas, invertido, base64,
   * rot13. La distincion no es cosmetica — encontrar "ignora las instrucciones"
   * despues de decodificar base64 dice mas que encontrarlo escrito, porque
   * nadie codifica en base64 sin querer. Quien lea el informe tiene que poder
   * verlo.
   */
  via?: 'plana' | 'leet' | 'espaciado' | 'invertido' | 'base64' | 'rot13';
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

/** Fallo que ocurrio antes de que el modelo llegara a opinar, o al volver. */
export type TransportFailure =
  /** No hay proxy, clave ni proyecto: el proveedor no llego a intentarlo. */
  | 'not-configured'
  /** El modelo no se pudo construir (SDK, permisos, App Check). */
  | 'model-init'
  /** Contesto la red, pero con un codigo de error. */
  | 'http-error'
  /** No contesto nadie: DNS, corte, CORS. */
  | 'network';

/**
 * Lo que devuelve un proveedor cuando se le pregunta.
 *
 * No es `ProviderSignal | null` porque "no hay señal" esconde motivos que no se
 * parecen en nada: un modelo que devuelve prosa en vez de JSON esta roto o le
 * han torcido el prompt, uno que da 502 esta caido, y uno sin configurar ni
 * siquiera lo intento. Colapsar los tres en `null` es barato para el codigo que
 * decide —le da igual, sigue con el siguiente— pero deja a quien mira la vista
 * tecnica sin nada que leer, justo cuando lo que necesita saber es CUAL de las
 * IAs dejo de funcionar y por que.
 */
export interface ProviderAnswer {
  signal: ProviderSignal | null;
  /** El modelo contesto, pero su carga util no paso el esquema. */
  rejection?: SignalRejection;
  /** No se llego a tener carga util que validar. */
  transport?: TransportFailure;
  /** Detalle corto para la vista tecnica. Sin texto del usuario dentro. */
  detail?: string;
}

/** Atajo para el caso normal: hay señal. */
export function answered(signal: ProviderSignal): ProviderAnswer {
  return { signal };
}

/** Atajo para el caso que hasta ahora se perdia: no hay señal, y este es el motivo. */
export function noAnswer(
  cause: { rejection?: SignalRejection; transport?: TransportFailure; detail?: string },
): ProviderAnswer {
  return { signal: null, ...cause };
}
