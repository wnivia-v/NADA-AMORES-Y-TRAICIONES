import { describe, it, expect } from 'vitest';

import {
  parseProposal, applyProposal, MAX_CHANGES, MAX_ENTRY_WEIGHT, MAX_PATTERN_LENGTH,
  type LexiconProposal,
} from '@/shared/backoffice/proposal';
import { evaluateProposal, autoRejectReason, type CorpusCase } from '@/shared/backoffice/evaluate';
import { clusterReports, type ReportLike } from '@/shared/backoffice/cluster';
import { LEXICON, DAMPENERS, COMBOS } from '@/utils/threatLexicon';
import { PRODUCTION_VOCABULARY } from '@/utils/scamPatterns';

const base = {
  baseLexiconVersion: 'abc12345',
  summary: 'una propuesta',
  motivatingReportIds: ['r1'],
};

const cambioValido = {
  kind: 'add-entry',
  id: 'nueva-entrada',
  category: 'fraude-financiero',
  label: 'Prueba',
  pattern: 'palabra-de-prueba',
  weight: 20,
  langs: ['es'],
  rationale: 'porque si',
};

describe('una propuesta es entrada no fiable', () => {
  it('lo que no es un objeto se rechaza', () => {
    for (const basura of [null, 'texto', 42, []]) {
      expect(parseProposal(basura).ok).toBe(false);
    }
  });

  it('sin huella base no se acepta: no se sabria sobre que se propuso', () => {
    const res = parseProposal({ ...base, baseLexiconVersion: undefined, changes: [cambioValido] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.reason).toContain('baseLexiconVersion');
  });

  it('una regex que no compila tumba la propuesta entera', () => {
    // Cerrado por defecto: no se coge "la parte buena" de algo que vino mal.
    const res = parseProposal({ ...base, changes: [{ ...cambioValido, pattern: '([sin cerrar' }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.index).toBe(0);
  });

  it('una regex enorme tampoco: nadie puede revisarla, y revisarla es el paso', () => {
    const res = parseProposal({
      ...base,
      changes: [{ ...cambioValido, pattern: 'a'.repeat(MAX_PATTERN_LENGTH + 1) }],
    });
    expect(res.ok).toBe(false);
  });

  it('ninguna entrada sola puede pesar lo bastante para alarmar por si misma', () => {
    const res = parseProposal({
      ...base, changes: [{ ...cambioValido, weight: MAX_ENTRY_WEIGHT + 10 }],
    });
    expect(res.ok).toBe(false);
  });

  it('no caben cien cambios de golpe: revisarlos asi no es revisar', () => {
    const muchos = Array.from({ length: MAX_CHANGES + 1 }, (_, i) => ({ ...cambioValido, id: `e-${i}` }));
    expect(parseProposal({ ...base, changes: muchos }).ok).toBe(false);
  });

  it('ids repetidos dentro de la propuesta', () => {
    expect(parseProposal({ ...base, changes: [cambioValido, cambioValido] }).ok).toBe(false);
  });

  it('un tipo de cambio inventado', () => {
    expect(parseProposal({ ...base, changes: [{ ...cambioValido, kind: 'borrar-todo' }] }).ok).toBe(false);
  });

  it('sin motivo no se acepta: quien aprueba tiene que poder leer por que', () => {
    const { rationale: _r, ...sinMotivo } = cambioValido;
    expect(parseProposal({ ...base, changes: [sinMotivo] }).ok).toBe(false);
  });

  it('una propuesta bien formada pasa', () => {
    const res = parseProposal({ ...base, changes: [cambioValido] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proposal.changes[0]?.id).toBe('nueva-entrada');
  });
});

describe('aplicar no toca produccion', () => {
  const propuesta: LexiconProposal = {
    ...base, changes: [{ ...cambioValido, kind: 'add-entry' } as never],
  };

  it('el lexico de produccion no cambia de tamaño', () => {
    const antes = LEXICON.length;
    const result = applyProposal({ lexicon: LEXICON, dampeners: DAMPENERS }, propuesta);

    expect(result.lexicon.length).toBe(antes + 1);
    // La garantia del §4.2 hecha codigo: el agente propone sobre una copia.
    expect(LEXICON.length).toBe(antes);
  });

  it('no pisa una entrada existente aunque la propuesta use su id', () => {
    // Sustituir una entrada de produccion sin decirlo seria cambiar el codigo
    // por la puerta de atras. Para eso esta adjust-weight, que es explicito.
    const existente = LEXICON[0]!;
    const result = applyProposal({ lexicon: LEXICON, dampeners: DAMPENERS }, {
      ...base,
      changes: [{ ...cambioValido, id: existente.id } as never],
    });

    expect(result.skipped.some((s) => s.includes(existente.id))).toBe(true);
    expect(result.lexicon.find((e) => e.id === existente.id)?.regex).toBe(existente.regex);
  });

  it('adjust-weight cambia el peso en la copia y no en el original', () => {
    const objetivo = LEXICON[0]!;
    const pesoOriginal = objetivo.weight;
    const result = applyProposal({ lexicon: LEXICON, dampeners: DAMPENERS }, {
      ...base,
      changes: [{ kind: 'adjust-weight', id: objetivo.id, weight: 5, rationale: 'prueba' }],
    });

    expect(result.lexicon.find((e) => e.id === objetivo.id)?.weight).toBe(5);
    expect(objetivo.weight).toBe(pesoOriginal);
  });

  it('un adjust-weight sobre algo que no existe se salta y se dice', () => {
    const result = applyProposal({ lexicon: LEXICON, dampeners: DAMPENERS }, {
      ...base,
      changes: [{ kind: 'adjust-weight', id: 'no-existe-nada', weight: 5, rationale: 'x' }],
    });
    expect(result.skipped[0]).toContain('no existe');
  });
});

describe('el filtro automatico', () => {
  const casos: CorpusCase[] = [
    { id: 'seguro-1', label: 'SEGURO', text: 'nos vemos manana en el parque' },
    { id: 'seguro-2', label: 'SEGURO', text: 'te dejo las llaves en el buzon' },
    { id: 'amenaza-1', label: 'PELIGROSO', text: 'envia dinero urgente a mi cuenta bitcoin ahora' },
  ];

  it('rechaza lo que crea una falsa alarma', () => {
    const res = evaluateProposal({
      ...base,
      changes: [{
        kind: 'add-entry', id: 'demasiado-amplio', category: 'fraude-financiero',
        label: 'Todo', pattern: '(manana|llaves|parque|buzon)', weight: 40, langs: ['es'],
        rationale: 'demasiado amplio a proposito',
      }],
    }, casos);

    expect(res.autoReject).toContain('falsa');
    expect(res.regressed.length).toBeGreaterThan(0);
  });

  it('rechaza lo que deja de ver una amenaza', () => {
    // Bajar a cero el peso de lo que sostenia una deteccion.
    const res = evaluateProposal({
      ...base,
      changes: [
        { kind: 'adjust-weight', id: 'fin-send-money', weight: 0, rationale: 'prueba' },
        { kind: 'adjust-weight', id: 'fin-crypto', weight: 0, rationale: 'prueba' },
        { kind: 'adjust-weight', id: 'urg-general', weight: 0, rationale: 'prueba' },
      ],
    }, casos);

    expect(res.autoReject).toBeTruthy();
    expect(res.after.threatRecall).toBeLessThan(res.before.threatRecall);
  });

  it('deja pasar lo inocuo, para que lo juzgue una persona', () => {
    const res = evaluateProposal({
      ...base,
      changes: [{
        kind: 'add-entry', id: 'algo-que-no-aparece', category: 'fraude-financiero',
        label: 'Inocuo', pattern: 'xyzzy-que-no-sale-en-ningun-sitio', weight: 10, langs: ['es'],
        rationale: 'no toca nada',
      }],
    }, casos);

    expect(res.autoReject).toBeNull();
    expect(res.regressed).toHaveLength(0);
  });

  it('las tres razones de rechazo, sin ambiguedad', () => {
    const m = (over: Partial<Record<string, number>> = {}) => ({
      cases: 10, exact: 8, threatRecall: 5, falseAlarms: 0, severeMisses: 0, ...over,
    });
    expect(autoRejectReason(m(), m({ falseAlarms: 1 }))).toContain('falsa');
    expect(autoRejectReason(m(), m({ threatRecall: 4 }))).toContain('amenaza');
    expect(autoRejectReason(m(), m({ severeMisses: 1 }))).toContain('grave');
    expect(autoRejectReason(m(), m())).toBeNull();
  });

  it('mide contra el vocabulario que se le pase, no contra el del dia', () => {
    const res = evaluateProposal({ ...base, changes: [cambioValido as never] }, casos, {
      lexicon: [], combos: COMBOS, dampeners: [],
    });
    // Con un lexico vacio no hay nada que detectar, asi que no hay amenazas
    // vistas ni antes ni despues. Sirve para probar el evaluador aislado.
    expect(res.before.threatRecall).toBe(0);
  });
});

describe('agrupar reportes', () => {
  const reporte = (over: Partial<ReportLike>): ReportLike => ({
    id: 'r', errorKind: 'false-positive', lexiconIds: ['fin-send-money'],
    lexiconVersion: 'v1', content: 'texto', region: 'es', band: 'SOSPECHOSO', riskScore: 45,
    ...over,
  });

  it('agrupa por entrada y clase de error', () => {
    const clusters = clusterReports([
      reporte({ id: 'a' }), reporte({ id: 'b' }),
      reporte({ id: 'c', errorKind: 'false-negative' }),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.count).toBe(2);
    expect(clusters[0]?.reportIds).toEqual(['a', 'b']);
  });

  it('los aciertos no generan trabajo', () => {
    expect(clusterReports([reporte({ errorKind: null })])).toHaveLength(0);
  });

  it('un falso negativo sin ninguna entrada detras es vocabulario que falta', () => {
    const clusters = clusterReports([
      reporte({ id: 'x', errorKind: 'false-negative', lexiconIds: [] }),
    ]);
    expect(clusters[0]?.lexiconId).toBeNull();
  });

  it('un reporte con varias entradas cuenta en todas', () => {
    // Cuando cuatro entradas coinciden sobre un texto legitimo, cualquiera
    // puede ser la culpable; decide la persona mirando los ejemplos.
    const clusters = clusterReports([reporte({ lexiconIds: ['a', 'b', 'c'] })]);
    expect(clusters).toHaveLength(3);
  });

  it('se puede filtrar por version del lexico', () => {
    const clusters = clusterReports(
      [reporte({ id: 'viejo', lexiconVersion: 'v0' }), reporte({ id: 'nuevo', lexiconVersion: 'v1' })],
      { lexiconVersion: 'v1' },
    );
    expect(clusters[0]?.reportIds).toEqual(['nuevo']);
  });

  it('el umbral deja fuera lo anecdotico', () => {
    expect(clusterReports([reporte({})], { minCount: 3 })).toHaveLength(0);
  });

  it('los grupos salen ordenados por cuantos reportes los sostienen', () => {
    const clusters = clusterReports([
      reporte({ id: '1', lexiconIds: ['poco'] }),
      reporte({ id: '2', lexiconIds: ['mucho'] }),
      reporte({ id: '3', lexiconIds: ['mucho'] }),
    ]);
    expect(clusters[0]?.lexiconId).toBe('mucho');
  });
});

describe('el vocabulario de produccion sigue siendo el de produccion', () => {
  it('PRODUCTION_VOCABULARY apunta a los arrays reales', () => {
    expect(PRODUCTION_VOCABULARY.lexicon).toBe(LEXICON);
    expect(PRODUCTION_VOCABULARY.dampeners).toBe(DAMPENERS);
    expect(PRODUCTION_VOCABULARY.combos).toBe(COMBOS);
  });
});
