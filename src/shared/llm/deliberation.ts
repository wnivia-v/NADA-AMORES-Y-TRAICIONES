// =============================================================================
// Acta de la deliberacion entre modelos
//
// Hasta ahora el orquestador devolvia { result, providerId }: el dictamen y
// quien lo firmaba. Todo lo demas —lo que dijeron los otros, cuanto tardo cada
// uno, cual se cayo, por que gano ese— se calculaba y se tiraba.
//
// Para quien usa la app eso basta. Para quien tiene que AUDITAR la app no: la
// diferencia entre "tres modelos coincidieron" y "dos estaban caidos y contesto
// uno" no se ve en el resultado, y es justo la diferencia que decide si el
// resultado merece credito.
//
// Este modulo es solo la forma del acta y las cuentas que se pueden hacer sobre
// ella. No llama a nadie y no decide nada: por eso se puede probar entero sin
// red, y por eso vale igual para la vista tecnica que para un informe.
//
// Lo que aqui NO se hace, a proposito: declarar que una IA "fue atacada". Eso
// no se puede saber desde fuera. Lo que se puede medir es que una se aparto del
// resto sobre un texto que ademas traia un intento de inyeccion, y eso es lo
// que se publica — como indicio, con su motivo al lado (§3).
// =============================================================================

import type { ProviderSignal, SignalRejection, TransportFailure } from './types';

/** Los identificadores viven en services/aiProviders; aqui basta la forma. */
export type DeliberationProviderId = string;

/**
 * Como termino un proveedor en ESTA deliberacion.
 *
 * El orden importa poco, pero la separacion mucho: `abstained` y `failed` se
 * confundian antes en el mismo `null`, y no son lo mismo ni de lejos. Un
 * proveedor que se abstiene porque no reconoce el texto esta funcionando
 * bien; uno que devuelve prosa donde toca JSON, no.
 */
export type ProviderOutcome =
  /** Contesto y su respuesta paso el esquema. */
  | 'answered'
  /** Contesto, pero la carga util no paso el esquema. Se descarto entera. */
  | 'rejected'
  /** Funciono y decidio no pronunciarse. No es un fallo. */
  | 'abstained'
  /** No llego a haber respuesta: red, HTTP, SDK, modelo que no arranca. */
  | 'failed'
  /** Se paso del tiempo maximo por proveedor. */
  | 'timeout'
  /** Sin cuota libre en su tier gratuito. Ni se le pregunto. */
  | 'no-quota'
  /** Habilitado pero sin configurar (falta proxy, clave o proyecto). */
  | 'unavailable'
  /** Apagado por quien usa la app. */
  | 'disabled'
  /**
   * Participaba, pero la decision se tomo antes de que contestara.
   *
   * Solo ocurre en la estrategia de carrera, y no es una averia: es LA carrera.
   * Verlo escrito es la unica forma de que se note que hubo carrera de verdad.
   */
  | 'still-running'
  /** La estrategia nunca llego a el (la cadena se corto antes). */
  | 'not-reached';

/** Lo que hizo un proveedor concreto, con su reloj. */
export interface ProviderRun {
  id: DeliberationProviderId;
  name: string;
  outcome: ProviderOutcome;
  /** Milisegundos medidos de verdad. null si no se le llego a llamar. */
  ms: number | null;
  /** La señal, cuando la hubo. Trae puntuacion, confianza y su explicacion. */
  signal: ProviderSignal | null;
  rejection?: SignalRejection;
  transport?: TransportFailure;
  /** Detalle corto y legible. Nunca lleva texto de la persona usuaria. */
  detail?: string;
}

/**
 * Por que el resultado es el que es.
 *
 * Es una union cerrada y no una cadena de texto porque esto se enseña a un
 * tribunal: "consenso" tiene que venir con quienes estaban de acuerdo y quienes
 * no, y "la mas rapida" con los milisegundos. Una frase suelta no se puede
 * comprobar.
 */
export type DecisionReason =
  /** Cadena por prioridad: gano el primero que contesto. */
  | { kind: 'first-available'; skipped: DeliberationProviderId[] }
  /** Carrera: gano quien contesto antes, y por cuanto. */
  | { kind: 'fastest'; ms: number; stillRunning: DeliberationProviderId[] }
  /** Se eligio la puntuacion mas alta para proteger a quien usa la app. */
  | { kind: 'most-cautious'; among: number }
  /** Todos coincidieron en SEGURO: se eligio el mas seguro de que lo es. */
  | { kind: 'most-confident-safe'; among: number }
  /** Mayoria suficiente sobre la misma banda. */
  | {
      kind: 'consensus';
      band: string;
      agreeing: DeliberationProviderId[];
      dissenting: DeliberationProviderId[];
      /** Cuantos hacian falta para que contara como consenso. */
      threshold: number;
    }
  /** Nadie reunio mayoria: se cayo a la lectura mas prudente. */
  | { kind: 'no-consensus'; bands: string[] }
  /** Contesto uno solo. No hay deliberacion que enseñar, y se dice. */
  | { kind: 'sole-answer' }
  /** No contesto nadie. El resultado sale del motor local, sin IA. */
  | { kind: 'silence' };

/** Indicio sobre un proveedor. Indicio, no acusacion (§3). */
export interface Suspicion {
  provider: DeliberationProviderId;
  kind: 'schema-rejected' | 'diverges-low' | 'diverges-high' | 'went-quiet';
  /** Frase corta que explica el indicio. Se enseña tal cual. */
  note: string;
}

export interface Deliberation {
  strategy: string;
  runs: ProviderRun[];
  /** Quien firma el resultado. null cuando no contesto nadie. */
  winner: DeliberationProviderId | null;
  reason: DecisionReason;
  /** Intentos de inyeccion vistos en el texto de ENTRADA. Comun a todos. */
  injectionIds: string[];
  suspicions: Suspicion[];
  totalMs: number;
}

// =============================================================================
// Cuentas sobre el acta
// =============================================================================

/**
 * Cuanto tiene que apartarse una puntuacion de la mediana de las demas para
 * que se considere divergencia. 35 sobre 100 es mas de una banda entera: por
 * debajo de eso, dos modelos discrepando es lo normal y marcarlo seria ruido.
 */
export const DIVERGENCE_POINTS = 35;

/**
 * Minimo de respuestas para poder hablar de divergencia.
 *
 * Con dos no se puede: si una dice 10 y otra 90, no hay forma de saber cual se
 * aparta. Hace falta un tercero que rompa el empate. Esto es el principio del
 * proyecto aplicado aqui — ninguna alerta por una señal aislada— y es la razon
 * de que con dos modelos la columna de indicios salga vacia en vez de inventar.
 */
export const MIN_FOR_DIVERGENCE = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Indicios a partir del acta.
 *
 * `injectionSeen` cambia el tono de la nota, no la deteccion: apartarse del
 * resto siempre se marca, pero si ademas el texto traia un intento de
 * inyeccion, la nota lo dice, porque es la combinacion —y no cada mitad por su
 * cuenta— la que se parece a un modelo que obedecio al atacante.
 */
export function findSuspicions(runs: ProviderRun[], injectionSeen: boolean): Suspicion[] {
  const out: Suspicion[] = [];

  for (const run of runs) {
    if (run.outcome === 'rejected') {
      out.push({
        provider: run.id,
        kind: 'schema-rejected',
        note: injectionSeen
          ? `respondio fuera de esquema (${run.rejection ?? 'sin detalle'}) sobre un texto que traia intento de inyeccion`
          : `respondio fuera de esquema (${run.rejection ?? 'sin detalle'}): o el prompt se rompio o el modelo cambio`,
      });
    }
  }

  const answers = runs.filter((r) => r.outcome === 'answered' && r.signal);

  // Alguien se callo mientras los demas contestaban. Solo cuenta si hubo con
  // quien comparar: si no contesto nadie, callarse no distingue a nadie.
  if (answers.length >= 2) {
    for (const run of runs) {
      if (run.outcome === 'failed' || run.outcome === 'timeout') {
        out.push({
          provider: run.id,
          kind: 'went-quiet',
          note: `no contesto (${run.detail ?? run.transport ?? run.outcome}) mientras otros ${answers.length} si lo hicieron`,
        });
      }
    }
  }

  if (answers.length < MIN_FOR_DIVERGENCE) return out;

  // La referencia es la mediana del grupo ENTERO, no la de "los demas".
  //
  // Restar a cada uno la mediana de los otros parecia mas justo y es lo que
  // habia: con tres respuestas, la mediana de los otros dos es su punto medio,
  // que el propio outlier arrastra. Con 90, 92 y 5 la referencia del que dijo
  // 90 salia 48.5, y quedaba marcado como divergente el grupo mayoritario
  // ademas del que se aparto — las tres a la vez. La mediana del grupo resiste
  // al outlier justamente porque no lo promedia, y ahi 90, 92 y 5 dan 90.
  const ref = median(answers.map((r) => r.signal!.value));

  for (const run of answers) {
    const delta = run.signal!.value - ref;
    if (Math.abs(delta) < DIVERGENCE_POINTS) continue;

    const low = delta < 0;
    const base = `puntuo ${run.signal!.value} frente a ${ref} de mediana entre las ${answers.length} que respondieron`;
    out.push({
      provider: run.id,
      kind: low ? 'diverges-low' : 'diverges-high',
      note:
        low && injectionSeen
          ? `${base}, y el texto traia intento de inyeccion: revisar si obedecio al mensaje`
          : low
            ? `${base}: ve menos riesgo que el resto`
            : `${base}: ve mas riesgo que el resto`,
    });
  }

  return out;
}

/** Cuantos proveedores llegaron a pronunciarse. Lo que el terminal reparte. */
export function participants(runs: ProviderRun[]): ProviderRun[] {
  return runs.filter((r) => r.outcome !== 'disabled');
}
