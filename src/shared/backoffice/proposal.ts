// =============================================================================
// Propuestas del backoffice
//
// §4.2 dice que en el camino caliente no decide ningun agente, y que los
// agentes viven fuera de linea en un backoffice con aprobacion humana
// obligatoria. Este archivo es la forma que tiene una propuesta.
//
// La idea central: **un agente no cambia nada, propone un DIFF**. El diff se
// aplica sobre una COPIA del vocabulario, se mide contra el corpus, y solo
// entonces una persona decide. El agente no tiene manera de escribir en
// produccion aunque quiera, porque nada de lo que devuelve es codigo — es una
// estructura de datos que hay que validar antes de mirarla siquiera.
//
// El parseo es CERRADO POR DEFECTO, igual que el de la señal del LLM en la Fase
// 1 y por el mismo motivo: lo que devuelve un modelo es entrada no fiable. Una
// propuesta que no encaja se rechaza entera; no se coge "la parte buena".
// =============================================================================

import type { LexiconEntry, DampenerEntry, ThreatCategory } from '@/utils/threatLexicon';

export type ProposalKind = 'add-entry' | 'add-dampener' | 'adjust-weight';

/** Una entrada nueva del lexico. */
export interface AddEntry {
  kind: 'add-entry';
  id: string;
  category: string;
  label: string;
  /** Fuente de la regex, como texto. Se compila aqui, con limites. */
  pattern: string;
  weight: number;
  langs: string[];
  regions?: string[];
  /** Por que se propone. Lo lee la persona que aprueba. */
  rationale: string;
}

/** Un amortiguador nuevo: explica un falso positivo y retira su peso. */
export interface AddDampener {
  kind: 'add-dampener';
  id: string;
  label: string;
  pattern: string;
  /** Categorias cuyo peso retira. */
  reduces: string[];
  rationale: string;
}

/** Subir o bajar el peso de una entrada existente. */
export interface AdjustWeight {
  kind: 'adjust-weight';
  id: string;
  weight: number;
  rationale: string;
}

export type ProposalChange = AddEntry | AddDampener | AdjustWeight;

export interface LexiconProposal {
  /** Contra que huella del lexico se propuso. */
  baseLexiconVersion: string;
  /** Reportes que la motivan. Trazabilidad hacia atras. */
  motivatingReportIds: string[];
  changes: ProposalChange[];
  /** Resumen en lenguaje llano para quien aprueba. */
  summary: string;
}

/**
 * Limite de longitud de una regex propuesta.
 *
 * Una regex enorme escrita por un modelo es dificil de revisar por una persona,
 * y revisarla es justamente el paso que no se puede saltar. Si no cabe aqui, es
 * que hacen falta varias entradas.
 */
export const MAX_PATTERN_LENGTH = 400;
/** Peso maximo. Ninguna entrada sola deberia poder disparar una alerta. */
export const MAX_ENTRY_WEIGHT = 40;
/** Cuantos cambios caben en una propuesta. Revisar cien de golpe no es revisar. */
export const MAX_CHANGES = 12;

export type ParseFailure = { index: number | null; reason: string };
export type ParseResult =
  | { ok: true; proposal: LexiconProposal }
  | { ok: false; failure: ParseFailure };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shortString(value: unknown, max = 120): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function stringArray(value: unknown, max = 16): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const item of value) {
    const s = shortString(item);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

/**
 * Compila una regex propuesta, o falla.
 *
 * Sin flags: el escaner ya normaliza a minusculas y sin acentos, y una `g` mal
 * puesta cambia el comportamiento de `test` entre llamadas por culpa de
 * lastIndex — un fallo intermitente en el sitio donde menos se quiere.
 */
export function compilePattern(source: string): RegExp | null {
  if (source.length > MAX_PATTERN_LENGTH) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

/** Valida una propuesta venida de un agente. Cerrada por defecto. */
export function parseProposal(raw: unknown): ParseResult {
  if (!isPlainObject(raw)) return { ok: false, failure: { index: null, reason: 'no es un objeto' } };

  const baseLexiconVersion = shortString(raw['baseLexiconVersion']);
  if (!baseLexiconVersion) {
    // Sin la huella base no se sabe sobre que se propuso, y aplicar un diff a
    // ciegas sobre un lexico que ya cambio es como aplicar un parche a mano.
    return { ok: false, failure: { index: null, reason: 'falta baseLexiconVersion' } };
  }

  const summary = shortString(raw['summary'], 500);
  if (!summary) return { ok: false, failure: { index: null, reason: 'falta el resumen' } };

  const motivating = stringArray(raw['motivatingReportIds'], 200) ?? [];

  const rawChanges = raw['changes'];
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    return { ok: false, failure: { index: null, reason: 'no hay cambios' } };
  }
  if (rawChanges.length > MAX_CHANGES) {
    return { ok: false, failure: { index: null, reason: `mas de ${MAX_CHANGES} cambios` } };
  }

  const changes: ProposalChange[] = [];
  for (let i = 0; i < rawChanges.length; i += 1) {
    const parsed = parseChange(rawChanges[i]);
    if (!parsed.ok) return { ok: false, failure: { index: i, reason: parsed.reason } };
    changes.push(parsed.change);
  }

  const ids = changes.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, failure: { index: null, reason: 'ids repetidos en la propuesta' } };
  }

  return { ok: true, proposal: { baseLexiconVersion, motivatingReportIds: motivating, changes, summary } };
}

type ChangeResult = { ok: true; change: ProposalChange } | { ok: false; reason: string };

function parseChange(raw: unknown): ChangeResult {
  if (!isPlainObject(raw)) return { ok: false, reason: 'el cambio no es un objeto' };

  const id = shortString(raw['id'], 60);
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return { ok: false, reason: 'id ausente o con caracteres raros' };
  }
  const rationale = shortString(raw['rationale'], 400);
  if (!rationale) return { ok: false, reason: 'falta el motivo' };

  switch (raw['kind']) {
    case 'add-entry': {
      const pattern = typeof raw['pattern'] === 'string' ? raw['pattern'] : '';
      if (!compilePattern(pattern)) return { ok: false, reason: 'regex invalida o demasiado larga' };

      const category = shortString(raw['category'], 60);
      const label = shortString(raw['label'], 120);
      const langs = stringArray(raw['langs'], 8);
      if (!category || !label || !langs || langs.length === 0) {
        return { ok: false, reason: 'faltan categoria, etiqueta o idiomas' };
      }

      const weight = raw['weight'];
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > MAX_ENTRY_WEIGHT) {
        return { ok: false, reason: `peso fuera de rango (1..${MAX_ENTRY_WEIGHT})` };
      }

      const regions = raw['regions'] === undefined ? undefined : stringArray(raw['regions'], 8);
      if (raw['regions'] !== undefined && !regions) return { ok: false, reason: 'regiones invalidas' };

      return {
        ok: true,
        change: { kind: 'add-entry', id, category, label, pattern, weight, langs, ...(regions ? { regions } : {}), rationale },
      };
    }

    case 'add-dampener': {
      const pattern = typeof raw['pattern'] === 'string' ? raw['pattern'] : '';
      if (!compilePattern(pattern)) return { ok: false, reason: 'regex invalida o demasiado larga' };

      const label = shortString(raw['label'], 120);
      const reduces = stringArray(raw['reduces'], 16);
      if (!label || !reduces || reduces.length === 0) {
        return { ok: false, reason: 'faltan etiqueta o categorias que amortigua' };
      }

      return { ok: true, change: { kind: 'add-dampener', id, label, pattern, reduces, rationale } };
    }

    case 'adjust-weight': {
      const weight = raw['weight'];
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > MAX_ENTRY_WEIGHT) {
        return { ok: false, reason: `peso fuera de rango (0..${MAX_ENTRY_WEIGHT})` };
      }
      return { ok: true, change: { kind: 'adjust-weight', id, weight, rationale } };
    }

    default:
      return { ok: false, reason: 'tipo de cambio desconocido' };
  }
}

/**
 * Aplica la propuesta sobre una COPIA del vocabulario.
 *
 * No escribe ningun archivo y no toca los arrays de produccion. Devuelve
 * estructuras nuevas, que es lo que permite medir sin arriesgar nada.
 */
export function applyProposal(
  base: { lexicon: readonly LexiconEntry[]; dampeners: readonly DampenerEntry[] },
  proposal: LexiconProposal,
): { lexicon: LexiconEntry[]; dampeners: DampenerEntry[]; skipped: string[] } {
  const lexicon = [...base.lexicon];
  const dampeners = [...base.dampeners];
  const skipped: string[] = [];

  for (const change of proposal.changes) {
    switch (change.kind) {
      case 'add-entry': {
        if (lexicon.some((e) => e.id === change.id)) {
          // Un id que ya existe no se pisa: sustituir una entrada de produccion
          // por otra sin decirlo es como cambiar el codigo por la puerta de
          // atras. Para eso esta adjust-weight, que es explicito.
          skipped.push(`${change.id}: ya existe`);
          break;
        }
        const regex = compilePattern(change.pattern);
        if (!regex) { skipped.push(`${change.id}: regex invalida`); break; }

        lexicon.push({
          id: change.id,
          category: change.category as ThreatCategory,
          weight: change.weight,
          langs: change.langs as LexiconEntry['langs'],
          ...(change.regions ? { regions: change.regions as LexiconEntry['regions'] } : {}),
          regex,
          label: change.label,
          source: 'propuesta del backoffice',
        });
        break;
      }

      case 'add-dampener': {
        if (dampeners.some((d) => d.id === change.id)) { skipped.push(`${change.id}: ya existe`); break; }
        const regex = compilePattern(change.pattern);
        if (!regex) { skipped.push(`${change.id}: regex invalida`); break; }

        dampeners.push({
          id: change.id,
          kind: 'modismo',
          label: change.label,
          reduces: change.reduces as DampenerEntry['reduces'],
          regex,
        });
        break;
      }

      case 'adjust-weight': {
        const index = lexicon.findIndex((e) => e.id === change.id);
        if (index === -1) { skipped.push(`${change.id}: no existe`); break; }
        lexicon[index] = { ...lexicon[index]!, weight: change.weight };
        break;
      }
    }
  }

  return { lexicon, dampeners, skipped };
}
