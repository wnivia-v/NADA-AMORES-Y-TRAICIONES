// =============================================================================
// POST /v1/feedback — recibir un reporte
//
// Aqui se cruza la frontera de confianza, y por eso este archivo desconfia de
// todo lo que llega. Tres reglas, en orden de importancia:
//
//   1. EL §4.1 SE IMPONE AQUI, NO EN EL CLIENTE. Si el reporte dice que la
//      superficie es 'video', el contenido se descarta pase lo que pase. El
//      cliente ya lo hace, pero el cliente es codigo que corre en la maquina de
//      otra persona: puede estar modificado, puede ser una peticion fabricada a
//      mano. La unica garantia que vale es la que se comprueba de este lado.
//      Es el mismo criterio que llevo a re-endurecer el texto en /v1/analyze.
//
//   2. SIN CUENTA VERIFICADA NO SE ACEPTA NADA. El riesgo propio de esta
//      funcion no es que alguien lea los reportes, es que alguien los ESCRIBA:
//      quien quiera que NADA deje de detectar su estafa solo tiene que mandar
//      mil reportes diciendo que esos mensajes eran legitimos. La cuenta pone
//      un coste y el limite de ritmo pone otro.
//
//   3. LO QUE NO ENCAJA SE RECHAZA ENTERO. No se guardan reportes a medias con
//      los campos que faltan a cero: un corpus con datos inventados es peor que
//      un corpus mas pequeño, porque nadie sabe cuales se inventaron.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { activeStore } from '../store';
import { REPORTS_PER_HOUR } from '../auth/rateLimit';
import type { DeviceContext } from '../../../src/shared/telemetry/types';
import type { HandlerResponse } from '../handler';
import type { StoredReport } from '../store/types';

/** Superficies validas. La lista es cerrada. */
const SURFACES = ['text', 'voice', 'image', 'clipboard', 'screen', 'video'];
/** Superficies cuyo contenido es texto y por tanto puede guardarse. */
const TEXT_SURFACES = ['text', 'voice', 'image', 'clipboard', 'screen'];
const JUDGMENTS = ['correct', 'incorrect'];
const ERROR_KINDS = ['false-positive', 'false-negative'];
const BANDS = ['SEGURO', 'SOSPECHOSO', 'PELIGROSO'];

const MAX_CONTENT = 4000;
const MAX_NOTE = 500;
const MAX_LIST = 64;
const MAX_STRING = 120;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lista de cadenas cortas, acotada. Cualquier otra cosa da lista vacia. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .slice(0, MAX_LIST)
    .map((v) => v.slice(0, MAX_STRING));
}

/**
 * Un identificador es un identificador, no prosa.
 *
 * `lexiconIds` y `region` acaban delante del agente del backoffice, que lee
 * texto de estafadores y escribe reglas de deteccion. Aceptarlos como 120
 * caracteres libres significaba que quien manda un reporte podia escribir lo que
 * quisiera en esos campos. El aislamiento del prompt ya no depende de esto
 * —ahora todo viaja delimitado y como JSON— pero un id con saltos de linea
 * dentro no tiene ningun uso legitimo, y lo que no tiene uso legitimo no se
 * acepta.
 */
const IDENTIFIER = /^[a-z0-9._:-]{1,60}$/;

function identifierList(value: unknown): string[] {
  return stringList(value).filter((v) => IDENTIFIER.test(v));
}

function identifier(value: unknown, fallback: string): string {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : fallback;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

export type ValidationFailure = { field: string; reason: string };

export type ValidationResult =
  | { ok: true; report: Omit<StoredReport, 'installId' | 'platform' | 'os' | 'deviceModel' | 'ip'> }
  | { ok: false; failure: ValidationFailure };

/**
 * Valida un reporte entrante y lo normaliza.
 *
 * Exportada aparte del manejador porque es donde estan las reglas, y las reglas
 * se prueban mejor sin montar una peticion entera.
 */
export function validateReport(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, failure: { field: '_', reason: 'no es un objeto' } };

  const surface = raw['surface'];
  if (typeof surface !== 'string' || !SURFACES.includes(surface)) {
    return { ok: false, failure: { field: 'surface', reason: 'superficie desconocida' } };
  }

  const judgment = raw['judgment'];
  if (typeof judgment !== 'string' || !JUDGMENTS.includes(judgment)) {
    return { ok: false, failure: { field: 'judgment', reason: 'juicio desconocido' } };
  }

  const errorKindRaw = raw['errorKind'];
  const errorKind = errorKindRaw === null || errorKindRaw === undefined
    ? null
    : typeof errorKindRaw === 'string' && ERROR_KINDS.includes(errorKindRaw)
      ? errorKindRaw
      : undefined;
  if (errorKind === undefined) {
    return { ok: false, failure: { field: 'errorKind', reason: 'clase de error desconocida' } };
  }
  // Coherencia: un acierto no tiene clase de error y un fallo si.
  if (judgment === 'correct' && errorKind !== null) {
    return { ok: false, failure: { field: 'errorKind', reason: 'un acierto no tiene clase de error' } };
  }
  if (judgment === 'incorrect' && errorKind === null) {
    return { ok: false, failure: { field: 'errorKind', reason: 'un fallo necesita clase de error' } };
  }

  const shown = raw['shown'];
  if (!isPlainObject(shown)) {
    return { ok: false, failure: { field: 'shown', reason: 'falta lo que se enseño' } };
  }
  const band = shown['band'];
  if (typeof band !== 'string' || !BANDS.includes(band)) {
    return { ok: false, failure: { field: 'shown.band', reason: 'banda desconocida' } };
  }
  const riskScore = boundedNumber(shown['riskScore'], 0, 100);
  if (riskScore === null) {
    return { ok: false, failure: { field: 'shown.riskScore', reason: 'fuera de rango' } };
  }

  const trace = raw['trace'];
  if (!isPlainObject(trace)) {
    return { ok: false, failure: { field: 'trace', reason: 'falta el rastro de la decision' } };
  }
  const localScore = boundedNumber(trace['localScore'], 0, 100);
  if (localScore === null) {
    return { ok: false, failure: { field: 'trace.localScore', reason: 'fuera de rango' } };
  }
  const llmScoreRaw = trace['llmScore'];
  const llmScore = llmScoreRaw === null || llmScoreRaw === undefined
    ? null
    : boundedNumber(llmScoreRaw, 0, 100);
  if (llmScore === undefined) {
    return { ok: false, failure: { field: 'trace.llmScore', reason: 'fuera de rango' } };
  }

  const context = raw['context'];
  if (!isPlainObject(context)) {
    return { ok: false, failure: { field: 'context', reason: 'falta el contexto' } };
  }
  const lexiconVersion = context['lexiconVersion'];
  if (typeof lexiconVersion !== 'string' || !lexiconVersion) {
    // Sin la huella del lexico el reporte no se puede fechar contra el codigo,
    // y un reporte que no se puede fechar no sirve para decidir nada.
    return { ok: false, failure: { field: 'context.lexiconVersion', reason: 'falta la huella del lexico' } };
  }

  const drivers = Array.isArray(trace['drivers'])
    ? (trace['drivers'] as unknown[])
        .filter(isPlainObject)
        .slice(0, MAX_LIST)
        .map((d) => ({
          type: typeof d['type'] === 'string' ? d['type'].slice(0, MAX_STRING) : 'desconocido',
          evidence: boundedNumber(d['evidence'], 0, 1) ?? 0,
        }))
    : [];

  const noteRaw = raw['note'];
  const contentRaw = raw['content'];

  return {
    ok: true,
    report: {
      id: randomUUID(),
      createdAt: new Date(),
      surface,
      judgment,
      errorKind,
      band,
      riskScore: Math.round(riskScore),
      alerted: shown['alerted'] === true,
      corroborated: shown['corroborated'] === true,
      scanSource: typeof shown['scanSource'] === 'string' ? shown['scanSource'].slice(0, MAX_STRING) : 'local',
      lexiconIds: identifierList(trace['lexiconIds']),
      combos: stringList(trace['combos']),
      dampened: stringList(trace['dampened']),
      localScore: Math.round(localScore),
      llmScore: llmScore === null ? null : Math.round(llmScore),
      injectionHits: identifierList(trace['injectionHits']),
      drivers,
      note: typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim().slice(0, MAX_NOTE) : null,
      // LA REGLA. Si la superficie no es de texto, no hay contenido, diga lo que
      // diga la peticion. El cliente ya lo hace; esto es lo que lo garantiza.
      content: TEXT_SURFACES.includes(surface) && typeof contentRaw === 'string'
        ? contentRaw.slice(0, MAX_CONTENT)
        : null,
      region: identifier(context['region'], 'default'),
      language: identifier(context['language'], 'es'),
      appVersion: typeof context['appVersion'] === 'string' ? context['appVersion'].slice(0, MAX_STRING) : '0.0.0',
      lexiconVersion: identifier(lexiconVersion, 'desconocida'),
      reviewedAt: null,
    },
  };
}

/**
 * Quien envia, visto por el servidor.
 *
 * `ip` no es opcional y `device` si: la conexion siempre tiene origen, el
 * contexto del aparato solo llega si quien usa la app dejo encendida la
 * telemetria. Un reporte sin contexto sigue valiendo — se pierde poder saber
 * si cien quejas iguales vienen de cien sitios o de uno, no la queja.
 */
export interface Sender {
  ip: string;
  device: DeviceContext | null;
}

/**
 * Identidad de un reporte sin cuenta.
 *
 * Sin telemetria no hay instalacion que anotar, y entonces la IP hace de las
 * dos cosas. No es equivalente —una IP la comparten los de una casa y cambia
 * al moverse— pero es lo unico que queda, y dejarlo en blanco significaria que
 * ese reporte no cuenta para ningun limite.
 */
function identidad(sender: Sender): string {
  return sender.device?.installId ?? `ip:${sender.ip}`;
}

/** POST /v1/feedback */
export async function handleFeedback(raw: unknown, sender: Sender): Promise<HandlerResponse> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Las dos claves frenan por separado, y hacen falta las dos. Contar solo por
  // instalacion se salta vaciando el almacenamiento entre envios; contar solo
  // por IP castiga a toda una casa por lo que haga uno.
  const recent = await activeStore().countReportsSince(
    { installId: sender.device?.installId, ip: sender.ip },
    hourAgo,
  );
  if (recent >= REPORTS_PER_HOUR) {
    return { status: 429, body: { error: 'demasiados reportes en poco tiempo' } };
  }

  const validation = validateReport(raw);
  if (!validation.ok) {
    return {
      status: 400,
      body: { error: 'reporte invalido', field: validation.failure.field, reason: validation.failure.reason },
    };
  }

  await activeStore().saveReport({
    ...validation.report,
    installId: identidad(sender),
    platform: sender.device?.platform ?? null,
    os: sender.device?.os ?? null,
    deviceModel: sender.device?.deviceModel ?? null,
    ip: sender.ip,
  });
  return { status: 201, body: { ok: true, id: validation.report.id } };
}

/**
 * DELETE /v1/reports — derecho de supresion sin cuenta.
 *
 * Sin correo no hay a quien pedirle que demuestre que es quien dice. Lo que
 * queda es el identificador de instalacion: quien lo tiene, borra lo suyo. Es
 * mas debil que una cuenta y hay que decirlo — cualquiera que consiga ese
 * identificador puede borrar esos reportes. A cambio, borrar no exige tener
 * una cuenta que nadie queria crear.
 */
export async function handleDeleteReports(sender: Sender): Promise<HandlerResponse> {
  const installId = sender.device?.installId;
  if (!installId) {
    return {
      status: 400,
      body: { error: 'hace falta el identificador de instalacion para saber que borrar' },
    };
  }

  const borrados = await activeStore().deleteReportsByInstall(installId);
  return { status: 200, body: { ok: true, deleted: borrados } };
}
