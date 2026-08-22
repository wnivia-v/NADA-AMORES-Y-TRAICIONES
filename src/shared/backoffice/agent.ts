// =============================================================================
// El agente que redacta la propuesta
//
// Todo lo que hace: mirar los grupos, escribir un JSON, y devolverlo. No aplica
// nada, no escribe ningun archivo y no habla con produccion. Lo que sale de aqui
// entra en el evaluador y termina delante de una persona.
//
// La llamada al modelo entra como PARAMETRO. No es purismo de inyeccion de
// dependencias: es que asi el agente se puede probar entero —incluida su
// defensa contra un reporte que intente secuestrarlo— sin credenciales y sin
// red. Un agente que solo se puede probar con una clave de API es un agente que
// nadie prueba.
// =============================================================================

import { parseProposal, type LexiconProposal } from './proposal';
import { buildAgentRequest, type AgentRequest } from './agentPrompt';
import type { Cluster } from './cluster';

/** Lo que hace falta de un modelo: dos turnos entran, texto sale. */
export type Completion = (turns: { system: string; user: string }) => Promise<string | null>;

export type AgentOutcome =
  | { ok: true; proposal: LexiconProposal; request: AgentRequest }
  | { ok: false; reason: string; request: AgentRequest; raw?: string };

/**
 * Saca el JSON de una respuesta.
 *
 * Los modelos envuelven el JSON en ```json a pesar de que se les pida que no, y
 * a veces añaden una frase antes. Se recorta al primer `{` y al ultimo `}`. Es
 * tolerante con el envoltorio y CERRADO con el contenido: lo que salga de aqui
 * pasa igualmente por parseProposal, que rechaza entero lo que no encaje.
 */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Pide una propuesta.
 *
 * Devuelve un resultado explicito en lugar de lanzar: que un modelo conteste
 * algo inservible es lo normal, no una excepcion, y quien llama tiene que poder
 * enseñar el motivo a la persona que revisa.
 */
export async function proposeChanges(
  clusters: Cluster[],
  lexiconVersion: string,
  complete: Completion,
): Promise<AgentOutcome> {
  const request = buildAgentRequest(clusters, lexiconVersion);

  const raw = await complete({ system: request.system, user: request.user });
  if (!raw) return { ok: false, reason: 'el modelo no devolvio nada', request };

  const json = extractJson(raw);
  if (json === null) return { ok: false, reason: 'la respuesta no contenia JSON', request, raw };

  const parsed = parseProposal(json);
  if (!parsed.ok) {
    const where = parsed.failure.index === null ? '' : ` (cambio ${parsed.failure.index})`;
    return { ok: false, reason: `propuesta invalida${where}: ${parsed.failure.reason}`, request, raw };
  }

  // La huella la fijamos NOSOTROS, no el modelo. Si el modelo la copio mal —o
  // se la dicto una muestra— la propuesta acabaria diciendo que se baso en un
  // lexico que no es, y eso invalida toda la trazabilidad hacia atras.
  if (parsed.proposal.baseLexiconVersion !== lexiconVersion) {
    return {
      ok: false,
      reason: `el agente dice basarse en el lexico ${parsed.proposal.baseLexiconVersion}, pero se le dio ${lexiconVersion}`,
      request,
      raw,
    };
  }

  return { ok: true, proposal: parsed.proposal, request };
}
