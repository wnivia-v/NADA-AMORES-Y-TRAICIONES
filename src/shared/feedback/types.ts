// =============================================================================
// Contrato de reporte — lo que el usuario corrige, y lo unico que puede viajar
//
// Este es el archivo que hace posible la Fase 5. Hasta ahora el sistema no
// tenia ninguna via por la que un error suyo pudiera expresarse: acertaba o
// fallaba y nadie se enteraba nunca.
//
// Dos ideas lo sostienen:
//
//   1. Un reporte no es "esto estaba mal". Es "esto estaba mal Y ESTO fue lo
//      que lo decidio". Sin el rastro de la decision —que entradas del lexico
//      dispararon, que combinaciones, que amortiguadores— un agente solo puede
//      adivinar; con el, puede señalar la entrada concreta que hay que
//      arreglar. Es la diferencia entre un buzon de quejas y un banco de
//      pruebas.
//
//   2. Lo que puede viajar esta acotado POR EL TIPO, no por una convencion. Un
//      reporte del escudo de video no lleva contenido. Nunca. El §4.1 dice que
//      ningun frame facial sale del dispositivo, y una tuberia de aprendizaje
//      es exactamente donde esa regla se erosionaria primero — "solo esta vez,
//      para depurar". Aqui no hay campo donde meterlo.
//
// Lo importa el cliente y lo importara el servidor: es el mismo contrato en los
// dos lados, igual que src/shared/llm.
//
// DECISION DEL PRODUCTO (Modo B): el texto analizado viaja SIEMPRE en los
// reportes de texto, voz e imagen, amparado por el consentimiento general. Es
// una decision tomada a sabiendas y conviene que quede escrita donde se ve: ese
// texto contiene mensajes de terceros que no han consentido nada, asi que el
// aviso de privacidad tiene que decirlo con todas las letras y el borrado por
// cuenta (ARCO/DSR) tiene que alcanzarlo de verdad.
// =============================================================================

import type { RiskBand, SignalType } from '../risk/types';

/** De donde salio el analisis que se esta juzgando. */
export type AnalysisSurface = 'text' | 'voice' | 'image' | 'clipboard' | 'screen' | 'video';

/**
 * Superficies cuyo contenido es TEXTO y por tanto puede acompañar al reporte.
 *
 * 'image' entra porque lo que se analizo fue el texto que saco el OCR, no la
 * imagen. 'voice' entra porque lo que se analizo fue la transcripcion. 'video'
 * no entra y no puede entrar: alli lo analizado son frames faciales.
 */
export const TEXT_BEARING_SURFACES = ['text', 'voice', 'image', 'clipboard', 'screen'] as const;

export type TextBearingSurface = (typeof TEXT_BEARING_SURFACES)[number];

export function carriesText(surface: AnalysisSurface): surface is TextBearingSurface {
  return (TEXT_BEARING_SURFACES as readonly string[]).includes(surface);
}

/** El juicio del usuario sobre lo que se le enseño. */
export type FeedbackJudgment = 'correct' | 'incorrect';

/**
 * Que clase de error fue, DEDUCIDO de lo que se enseño y de lo que dijo el
 * usuario. No se le pregunta: quien acaba de recibir un susto no tiene por que
 * saber que es un falso positivo, y obligarle a clasificar produce etiquetas
 * peores que no tener ninguna.
 */
export type FeedbackErrorKind = 'false-positive' | 'false-negative';

/** Lo que el sistema le enseño al usuario. */
export interface ShownVerdict {
  band: RiskBand;
  riskScore: number;
  /** Si ademas sono la alarma, o solo se mostro la banda. */
  alerted: boolean;
  corroborated: boolean;
  scanSource: 'local' | 'gemini' | 'hybrid';
}

/**
 * Por que decidio lo que decidio.
 *
 * Es la mitad util del reporte. `lexiconIds` en particular: son las entradas
 * concretas que dispararon, o sea la lista exacta de sospechosos cuando alguien
 * dice "esto no era una estafa".
 */
export interface DecisionTrace {
  /** Que sostuvo el resultado, de mayor a menor (FusionResult.drivers). */
  drivers: { type: SignalType; evidence: number }[];
  /** IDs de las entradas del lexico que coincidieron. */
  lexiconIds: string[];
  /** Reglas de combinacion que se activaron. */
  combos: string[];
  /** Amortiguadores que retiraron peso. Un falso positivo pese a ellos importa. */
  dampened: string[];
  /** Puntuacion del analisis local por si sola. */
  localScore: number;
  /** Puntuacion del LLM, o null si no llego a haber. */
  llmScore: number | null;
  /** Patrones de inyeccion detectados en el texto. */
  injectionHits: string[];
}

/** Lo que hace comparable un reporte con otro. Sin esto no se puede agrupar. */
export interface ReportContext {
  /** Region configurada, para la calibracion regional. */
  region: string;
  language: string;
  appVersion: string;
  /**
   * Huella del lexico vigente cuando se produjo el analisis.
   *
   * Sin ella los reportes no se pueden fechar contra el codigo: llegaria una
   * queja sobre una entrada que ya se arreglo hace tres versiones y no habria
   * forma de saberlo.
   */
  lexiconVersion: string;
}

export interface FeedbackReport {
  id: string;
  /** ISO 8601. */
  createdAt: string;
  surface: AnalysisSurface;
  shown: ShownVerdict;
  trace: DecisionTrace;
  judgment: FeedbackJudgment;
  /** null cuando el usuario dice que acerto. */
  errorKind: FeedbackErrorKind | null;
  /** Comentario libre del usuario. Opcional y casi siempre ausente. */
  note?: string;
  /**
   * El texto analizado, o null.
   *
   * SIEMPRE null cuando surface es 'video'. La funcion que construye reportes
   * lo garantiza, y hay un test que lo vigila.
   */
  content: string | null;
  context: ReportContext;
}

/** Lo que el usuario aporta al pulsar el boton. El resto ya se sabe. */
export interface FeedbackSubmission {
  judgment: FeedbackJudgment;
  note?: string;
}

/**
 * Todo lo que se sabe de un analisis en el momento de hacerlo.
 *
 * Se guarda en el instante del analisis porque despues ya no se puede
 * reconstruir: el rastro de la decision vive dentro del motor y no llega a la
 * interfaz. La interfaz solo aporta el juicio.
 */
export interface AnalysisDraft {
  id: string;
  createdAt: string;
  surface: AnalysisSurface;
  shown: ShownVerdict;
  trace: DecisionTrace;
  content: string | null;
  context: ReportContext;
}

/** Cuanto texto se guarda como maximo en un reporte. */
export const MAX_REPORT_CHARS = 4000;

/**
 * Deduce la clase de error a partir de lo que se enseño.
 *
 * Enseñar SEGURO y que fuera una estafa es un falso negativo; enseñar riesgo y
 * que fuera legitimo es un falso positivo. Es la unica deduccion posible, y por
 * eso no hay que preguntarsela a nadie.
 */
export function errorKindFor(shown: ShownVerdict, judgment: FeedbackJudgment): FeedbackErrorKind | null {
  if (judgment === 'correct') return null;
  return shown.band === 'SEGURO' ? 'false-negative' : 'false-positive';
}

/**
 * Construye el reporte a partir del borrador y del juicio.
 *
 * Es el UNICO camino por el que se crea un FeedbackReport, y es donde vive la
 * regla dura: si el analisis fue de video, el contenido se descarta aqui.
 * Ponerlo en una funcion —y no en la disciplina de quien llame— es lo que hace
 * que la regla siga cumpliendose dentro de seis meses.
 */
export function buildReport(draft: AnalysisDraft, submission: FeedbackSubmission): FeedbackReport {
  const content = carriesText(draft.surface) && draft.content !== null
    ? draft.content.slice(0, MAX_REPORT_CHARS)
    : null;

  const note = submission.note?.trim();

  return {
    id: draft.id,
    createdAt: draft.createdAt,
    surface: draft.surface,
    shown: draft.shown,
    trace: draft.trace,
    judgment: submission.judgment,
    errorKind: errorKindFor(draft.shown, submission.judgment),
    ...(note ? { note: note.slice(0, 500) } : {}),
    content,
    context: draft.context,
  };
}
