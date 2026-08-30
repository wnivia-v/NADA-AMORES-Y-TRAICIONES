// =============================================================================
// Llamadas a los proveedores, desde el servidor
//
// Todas comparten la misma forma: turno `system` con las instrucciones, turno
// `user` con el mensaje delimitado. Ningun proveedor recibe una cadena unica en
// la que instrucciones y mensaje se hayan mezclado — esa costura ya no existe
// en el codigo (ver src/shared/llm/envelope.ts).
//
// Devuelven el texto crudo del modelo. Validarlo es tarea de handler.ts, con el
// mismo validador que usa el cliente.
// =============================================================================

import { systemPromptFor, renderUserContent } from '../../src/shared/llm/envelope';
import type { AnalysisRequest } from '../../src/shared/llm/types';
import { upstreamConfig, type UpstreamId, UPSTREAM_TIMEOUT_MS } from './config';

export class UpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      // El cuerpo del error del proveedor no se reenvia al cliente: puede
      // contener fragmentos de la peticion, y el cliente no lo necesita.
      throw new UpstreamError(`upstream respondio ${response.status}`, response.status === 429 ? 429 : 502);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpstreamError('upstream agoto el tiempo de espera', 504);
    }
    throw new UpstreamError('no se pudo contactar con el upstream', 502);
  } finally {
    clearTimeout(timeout);
  }
}

type RawResponse = { text: string } | null;

/**
 * Los dos turnos que se le mandan a un modelo.
 *
 * La capa de transporte no sabe nada del analisis de fraude: recibe un turno de
 * sistema y uno de usuario y los entrega. Existe asi porque el backoffice
 * tambien necesita hablar con un modelo —para que un agente redacte una
 * propuesta— y su tarea no tiene nada que ver con la del camino caliente. Un
 * unico cliente HTTP, dos usos, y ninguna copia del manejo de errores.
 *
 * La separacion system/user NO es un detalle de formato: es el aislamiento del
 * §Fase 1. Quien construya los turnos es responsable de que el contenido ajeno
 * viaje solo en `user` y delimitado.
 */
export interface ChatTurns {
  system: string;
  user: string;
  maxTokens?: number;
}

async function callGroq(turns: ChatTurns): Promise<RawResponse> {
  const config = upstreamConfig('groq');
  if (!config) return null;

  const data = (await postJson(
    'https://api.groq.com/openai/v1/chat/completions',
    { Authorization: `Bearer ${config.apiKey}` },
    {
      model: config.model,
      messages: [
        { role: 'system', content: turns.system },
        { role: 'user', content: turns.user },
      ],
      max_tokens: turns.maxTokens ?? 1024,
      temperature: 0,
      response_format: { type: 'json_object' },
    },
  )) as { choices?: Array<{ message?: { content?: string } }> };

  const text = data.choices?.[0]?.message?.content;
  return typeof text === 'string' ? { text } : null;
}

async function callClaude(turns: ChatTurns): Promise<RawResponse> {
  const config = upstreamConfig('claude');
  if (!config) return null;

  const data = (await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
    {
      model: config.model,
      max_tokens: turns.maxTokens ?? 1024,
      temperature: 0,
      // El parametro `system` es exactamente la separacion de roles que pide la
      // Fase 1: las instrucciones no viajan dentro del turno del usuario.
      system: turns.system,
      messages: [{ role: 'user', content: turns.user }],
    },
  )) as { content?: Array<{ text?: string }> };

  const text = data.content?.[0]?.text;
  return typeof text === 'string' ? { text } : null;
}

async function callBedrock(turns: ChatTurns): Promise<RawResponse> {
  const config = upstreamConfig('bedrock');
  if (!config?.endpoint) return null;

  // El proxy de Bedrock lo despliega cada quien (API Gateway + Lambda); no
  // viene en el repo. El contrato cambia respecto a la version anterior:
  // antes se mandaba `prompt` con todo concatenado, ahora `system` y `messages`
  // van separados. Como el proveedor nunca funciono sin trabajo extra, no hay
  // despliegue que romper.
  const data = (await postJson(
    config.endpoint,
    { 'x-api-key': config.apiKey },
    {
      model: config.model,
      max_tokens: turns.maxTokens ?? 1024,
      system: turns.system,
      messages: [{ role: 'user', content: turns.user }],
    },
  )) as { content?: string | Array<{ text?: string }>; completion?: string };

  const content = data.content ?? data.completion ?? '';
  const text = typeof content === 'string' ? content : content?.[0]?.text;
  return typeof text === 'string' ? { text } : null;
}

/** Manda dos turnos ya construidos. Es lo que usa el backoffice. */
export function callUpstreamChat(id: UpstreamId, turns: ChatTurns): Promise<RawResponse> {
  switch (id) {
    case 'groq':
      return callGroq(turns);
    case 'claude':
      return callClaude(turns);
    case 'bedrock':
      return callBedrock(turns);
    default:
      return Promise.resolve(null);
  }
}

/**
 * El camino caliente: analiza un mensaje.
 *
 * Construye los turnos a partir del AnalysisRequest, que es donde vive la
 * separacion instrucciones/dato de la Fase 1, y delega en el transporte.
 */
export function callUpstream(id: UpstreamId, request: AnalysisRequest): Promise<RawResponse> {
  return callUpstreamChat(id, {
    system: systemPromptFor(request.task),
    user: renderUserContent(request),
  });
}
