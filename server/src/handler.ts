// =============================================================================
// Manejador puro: peticion -> respuesta. Sin dependencias de node:http.
//
// Separado del transporte para poder probarlo directamente y para poder
// desplegarlo tal cual como handler de Lambda si el destino acaba siendo
// Amplify en vez de un contenedor.
// =============================================================================

import { buildAnalysisRequest } from '../../src/shared/llm/envelope';
import { parseProviderSignal } from '../../src/shared/llm/signalSchema';
import { MAX_ANALYSIS_CHARS } from '../../src/shared/llm/normalize';
import type { AnalysisTask } from '../../src/shared/llm/types';
import { configuredUpstreams, upstreamConfig, type UpstreamId } from './config';
import { callUpstream, UpstreamError } from './upstreams';

export interface HandlerResponse {
  status: number;
  body: unknown;
}

const VALID_UPSTREAMS: UpstreamId[] = ['groq', 'claude', 'bedrock'];
const VALID_TASKS: AnalysisTask[] = ['text', 'voice'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** GET /health — que proveedores estan configurados. Nunca revela las claves. */
export function handleHealth(): HandlerResponse {
  return { status: 200, body: { ok: true, upstreams: configuredUpstreams() } };
}

/**
 * POST /v1/analyze
 *
 * Entrada:  { provider, task, text }
 * Salida:   { signal: ProviderSignal | null, rejection?: string }
 *
 * `signal: null` es una respuesta legitima y frecuente: significa que el modelo
 * contesto algo que no encaja en el esquema y se descarto. El cliente cae
 * entonces al camino local. En ningun caso se fabrica aqui una señal de
 * tranquilidad para rellenar el hueco.
 */
export async function handleAnalyze(rawBody: unknown): Promise<HandlerResponse> {
  if (!isPlainObject(rawBody)) {
    return { status: 400, body: { error: 'cuerpo invalido' } };
  }

  const provider = rawBody['provider'];
  if (typeof provider !== 'string' || !VALID_UPSTREAMS.includes(provider as UpstreamId)) {
    return { status: 400, body: { error: 'provider desconocido' } };
  }

  const task = rawBody['task'] ?? 'text';
  if (typeof task !== 'string' || !VALID_TASKS.includes(task as AnalysisTask)) {
    return { status: 400, body: { error: 'task desconocida' } };
  }

  const text = rawBody['text'];
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { status: 400, body: { error: 'text vacio o no es una cadena' } };
  }
  // El tope tambien se aplica en el cliente. Se repite aqui porque el cliente
  // no es una frontera de confianza: cualquiera puede llamar a este endpoint.
  if (text.length > MAX_ANALYSIS_CHARS * 4) {
    return { status: 413, body: { error: 'text demasiado largo' } };
  }

  const upstreamId = provider as UpstreamId;
  if (!upstreamConfig(upstreamId)) {
    return { status: 503, body: { error: `proveedor ${upstreamId} no configurado en el servidor` } };
  }

  // El endurecimiento se rehace en el servidor sobre el texto recibido: da igual
  // lo que el cliente haya hecho antes de mandarlo.
  const request = buildAnalysisRequest(text, task as AnalysisTask);

  try {
    const raw = await callUpstream(upstreamId, request);
    if (!raw) return { status: 502, body: { error: 'el upstream no devolvio contenido' } };

    const { signal, rejection } = parseProviderSignal(raw.text);
    return {
      status: 200,
      body: {
        signal,
        ...(rejection ? { rejection } : {}),
        // Lo que el endurecimiento encontro se devuelve para que el motor de
        // riesgo del cliente lo sume como señal propia.
        hardening: request.hardening,
      },
    };
  } catch (error) {
    if (error instanceof UpstreamError) {
      return { status: error.status, body: { error: error.message } };
    }
    return { status: 502, body: { error: 'fallo al consultar el upstream' } };
  }
}
