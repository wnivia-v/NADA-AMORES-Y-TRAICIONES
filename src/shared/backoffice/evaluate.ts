// =============================================================================
// Medir una propuesta antes de que la mire nadie
//
// Es la pieza que hace segura la sugerencia de un agente. El agente propone, el
// banco mide, y solo lo que sobrevive a la medida llega a una persona. Sin esto,
// "aprobacion humana obligatoria" seria alguien leyendo regexes a ojo y diciendo
// que si, que es peor que no revisar nada porque parece revision.
//
// Dos ideas:
//
//   1. LO QUE IMPORTA NO ES EL PROMEDIO, SON LOS CASOS QUE CAMBIARON. Una
//      propuesta puede subir la exactitud global y a la vez romper un caso
//      grave; el promedio lo esconde y la lista de cambios no. Por eso se
//      devuelven los casos uno a uno, en las dos direcciones.
//   2. HAY RECHAZOS AUTOMATICOS. Una propuesta que crea una falsa alarma o que
//      pierde una amenaza que antes se veia no llega a la persona. No es por
//      desconfianza del agente: es que la atencion humana es el recurso escaso,
//      y gastarla en propuestas que ya se sabe que empeoran las cosas es
//      garantizar que se gaste mal en las que importan.
// =============================================================================

import { scanLocalPatterns, PRODUCTION_VOCABULARY, type Vocabulary } from '@/utils/scamPatterns';
import { COMBOS } from '@/utils/threatLexicon';
import { applyProposal, type LexiconProposal } from './proposal';

export type Band = 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';

export interface CorpusCase {
  id: string;
  label: string;
  text: string;
  category?: string;
}

/** Los mismos umbrales que el motor de fusion, para no discrepar. */
function bandFor(score: number): Band {
  if (score >= 70) return 'PELIGROSO';
  if (score >= 40) return 'SOSPECHOSO';
  return 'SEGURO';
}

export interface Metrics {
  cases: number;
  exact: number;
  /** Amenazas que se ven (banda distinta de SEGURO). */
  threatRecall: number;
  /** Casos SEGURO que se marcaron. Lo que mas duele. */
  falseAlarms: number;
  /** Amenazas PELIGROSO que se quedaron en SEGURO. */
  severeMisses: number;
}

export interface CaseChange {
  id: string;
  text: string;
  expected: string;
  before: Band;
  after: Band;
  beforeScore: number;
  afterScore: number;
}

export interface Evaluation {
  before: Metrics;
  after: Metrics;
  /** Casos que mejoraron: se acercaron a lo esperado. */
  improved: CaseChange[];
  /** Casos que empeoraron. Esta lista es la que decide. */
  regressed: CaseChange[];
  /** Cambios que no se pudieron aplicar y por que. */
  skipped: string[];
  /** Rechazo automatico, si procede. */
  autoReject: string | null;
}

function measure(cases: CorpusCase[], vocabulary: Vocabulary) {
  const results = cases.map((c) => {
    const score = scanLocalPatterns(c.text, { vocabulary }).riskScore;
    return { id: c.id, score, band: bandFor(score) };
  });

  const byId = new Map(results.map((r) => [r.id, r]));
  const threats = cases.filter((c) => c.label !== 'SEGURO');
  const safe = cases.filter((c) => c.label === 'SEGURO');

  const metrics: Metrics = {
    cases: cases.length,
    exact: cases.filter((c) => byId.get(c.id)?.band === c.label).length,
    threatRecall: threats.filter((c) => byId.get(c.id)?.band !== 'SEGURO').length,
    falseAlarms: safe.filter((c) => byId.get(c.id)?.band !== 'SEGURO').length,
    severeMisses: cases.filter((c) => c.label === 'PELIGROSO' && byId.get(c.id)?.band === 'SEGURO').length,
  };

  return { metrics, byId };
}

/** A que distancia esta un resultado de lo esperado. Menos es mejor. */
function distance(expected: string, actual: Band): number {
  const order: Record<string, number> = { SEGURO: 0, SOSPECHOSO: 1, PELIGROSO: 2 };
  return Math.abs((order[expected] ?? 0) - (order[actual] ?? 0));
}

/**
 * Mide una propuesta contra el corpus.
 *
 * `baseVocabulary` es parametro para poder probar el evaluador con vocabularios
 * inventados, sin depender de como este el lexico de produccion ese dia.
 */
export function evaluateProposal(
  proposal: LexiconProposal,
  cases: CorpusCase[],
  baseVocabulary: Vocabulary = PRODUCTION_VOCABULARY,
): Evaluation {
  const applied = applyProposal(
    { lexicon: baseVocabulary.lexicon, dampeners: baseVocabulary.dampeners },
    proposal,
  );

  const proposed: Vocabulary = {
    lexicon: applied.lexicon,
    // Las combinaciones no se tocan desde una propuesta: cambian el
    // comportamiento de muchas entradas a la vez y merecen su propio proceso.
    combos: baseVocabulary.combos ?? COMBOS,
    dampeners: applied.dampeners,
  };

  const base = measure(cases, baseVocabulary);
  const next = measure(cases, proposed);

  const improved: CaseChange[] = [];
  const regressed: CaseChange[] = [];

  for (const c of cases) {
    const before = base.byId.get(c.id)!;
    const after = next.byId.get(c.id)!;
    if (before.band === after.band) continue;

    const change: CaseChange = {
      id: c.id,
      text: c.text.slice(0, 90),
      expected: c.label,
      before: before.band,
      after: after.band,
      beforeScore: before.score,
      afterScore: after.score,
    };

    if (distance(c.label, after.band) < distance(c.label, before.band)) improved.push(change);
    else regressed.push(change);
  }

  return {
    before: base.metrics,
    after: next.metrics,
    improved,
    regressed,
    skipped: applied.skipped,
    autoReject: autoRejectReason(base.metrics, next.metrics),
  };
}

/**
 * Motivos por los que una propuesta no llega a una persona.
 *
 * Son los tres que no admiten discusion. Todo lo demas —una propuesta que no
 * mejora nada, una que mejora poco— si va a revision: puede haber contexto que
 * el corpus no captura, y esa es justamente la clase de juicio que se le pide a
 * la persona.
 */
export function autoRejectReason(before: Metrics, after: Metrics): string | null {
  if (after.falseAlarms > before.falseAlarms) {
    return `crea ${after.falseAlarms - before.falseAlarms} falsa(s) alarma(s): es el Problema A otra vez`;
  }
  if (after.threatRecall < before.threatRecall) {
    return `deja de ver ${before.threatRecall - after.threatRecall} amenaza(s) que antes si veia`;
  }
  if (after.severeMisses > before.severeMisses) {
    return `añade ${after.severeMisses - before.severeMisses} fallo(s) grave(s)`;
  }
  return null;
}

/** Resumen legible, para el CLI y para el registro de la decision. */
export function formatEvaluation(evaluation: Evaluation): string {
  const { before, after } = evaluation;
  const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`;

  const lines = [
    '  Metrica            Antes     Despues',
    '  -------------------------------------',
    `  Exactitud          ${pct(before.exact, before.cases).padEnd(9)} ${pct(after.exact, after.cases)}`,
    `  Amenazas vistas    ${String(before.threatRecall).padEnd(9)} ${after.threatRecall}`,
    `  Falsas alarmas     ${String(before.falseAlarms).padEnd(9)} ${after.falseAlarms}`,
    `  Fallos graves      ${String(before.severeMisses).padEnd(9)} ${after.severeMisses}`,
  ];

  if (evaluation.improved.length > 0) {
    lines.push('', `  Mejoran (${evaluation.improved.length}):`);
    for (const c of evaluation.improved) {
      lines.push(`    ${c.id}  ${c.before}(${c.beforeScore}) -> ${c.after}(${c.afterScore})  esperado ${c.expected}`);
    }
  }

  if (evaluation.regressed.length > 0) {
    lines.push('', `  EMPEORAN (${evaluation.regressed.length}):`);
    for (const c of evaluation.regressed) {
      lines.push(`    ${c.id}  ${c.before}(${c.beforeScore}) -> ${c.after}(${c.afterScore})  esperado ${c.expected}`);
      lines.push(`      "${c.text}"`);
    }
  }

  if (evaluation.skipped.length > 0) {
    lines.push('', '  Sin aplicar:');
    for (const s of evaluation.skipped) lines.push(`    ${s}`);
  }

  lines.push('', evaluation.autoReject
    ? `  RECHAZO AUTOMATICO: ${evaluation.autoReject}`
    : '  Pasa el filtro automatico. Necesita aprobacion humana.');

  return lines.join('\n');
}
