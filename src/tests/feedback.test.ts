import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/aiProviders', () => ({ orchestrateAnalysis: vi.fn() }));
vi.mock('@/services/safeBrowsingService', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true, threats: [] }),
}));
vi.mock('@/services/scamDatabase', () => ({
  scamDatabase: {
    lookup: vi.fn().mockResolvedValue({ found: false }),
    store: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  buildReport,
  errorKindFor,
  carriesText,
  MAX_REPORT_CHARS,
  type AnalysisDraft,
  type ShownVerdict,
} from '@/shared/feedback/types';
import { feedbackService } from '@/services/feedbackService';
import { LEXICON, LEXICON_VERSION } from '@/utils/threatLexicon';
import { scanLocalPatterns } from '@/utils/scamPatterns';
import { analyzeText } from '@/services/geminiService';
import { orchestrateAnalysis } from '@/services/aiProviders';
import { clearAllLanes } from '@/shared/risk';

const shown: ShownVerdict = {
  band: 'PELIGROSO',
  riskScore: 82,
  alerted: true,
  corroborated: true,
  scanSource: 'hybrid',
};

function draft(overrides: Partial<AnalysisDraft> = {}): AnalysisDraft {
  return {
    id: 'draft-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    surface: 'text',
    shown,
    trace: {
      drivers: [{ type: 'local-patterns', evidence: 0.7 }],
      lexiconIds: ['dinero-transferencia'],
      combos: [],
      dampened: [],
      localScore: 80,
      llmScore: 60,
      injectionHits: [],
    },
    content: 'mandame 300 euros en bitcoin ahora mismo',
    context: { region: 'es', language: 'es', appVersion: '2.0.0', lexiconVersion: LEXICON_VERSION },
    ...overrides,
  };
}

describe('regla dura: el video no lleva contenido', () => {
  it('un reporte de video se queda sin contenido aunque el borrador lo traiga', () => {
    // §4.1: ningun frame facial sale del dispositivo. Una tuberia de
    // aprendizaje es justo donde esa regla se erosionaria primero, asi que se
    // corta aqui y no en la disciplina de quien llame.
    const report = buildReport(
      draft({ surface: 'video', content: 'esto no deberia viajar jamas' }),
      { judgment: 'incorrect' },
    );
    expect(report.content).toBeNull();
  });

  it('las superficies de texto si lo llevan', () => {
    for (const surface of ['text', 'voice', 'image', 'clipboard', 'screen'] as const) {
      expect(carriesText(surface)).toBe(true);
      expect(buildReport(draft({ surface }), { judgment: 'correct' }).content).not.toBeNull();
    }
    expect(carriesText('video')).toBe(false);
  });

  it('el texto se recorta, no se manda entero sin limite', () => {
    const largo = 'a'.repeat(MAX_REPORT_CHARS + 5000);
    const report = buildReport(draft({ content: largo }), { judgment: 'incorrect' });
    expect(report.content).toHaveLength(MAX_REPORT_CHARS);
  });
});

describe('deduccion de la clase de error', () => {
  it('negar un SEGURO es un falso negativo', () => {
    expect(errorKindFor({ ...shown, band: 'SEGURO' }, 'incorrect')).toBe('false-negative');
  });

  it('negar una alerta es un falso positivo', () => {
    expect(errorKindFor({ ...shown, band: 'PELIGROSO' }, 'incorrect')).toBe('false-positive');
    expect(errorKindFor({ ...shown, band: 'SOSPECHOSO' }, 'incorrect')).toBe('false-positive');
  });

  it('un acierto no tiene clase de error', () => {
    expect(errorKindFor(shown, 'correct')).toBeNull();
  });

  it('no se le pregunta al usuario: se deduce', () => {
    // Quien acaba de llevarse un susto no tiene por que saber que es un falso
    // positivo. Obligarle a clasificar produce etiquetas peores que ninguna.
    const report = buildReport(draft({ shown: { ...shown, band: 'SEGURO' } }), { judgment: 'incorrect' });
    expect(report.errorKind).toBe('false-negative');
  });
});

describe('comentario del usuario', () => {
  it('un comentario vacio no ocupa sitio en el reporte', () => {
    expect(buildReport(draft(), { judgment: 'incorrect', note: '   ' })).not.toHaveProperty('note');
  });

  it('un comentario real se conserva, recortado', () => {
    const report = buildReport(draft(), { judgment: 'incorrect', note: '  era mi madre de broma  ' });
    expect(report.note).toBe('era mi madre de broma');
    expect(buildReport(draft(), { judgment: 'incorrect', note: 'x'.repeat(900) }).note).toHaveLength(500);
  });
});

describe('servicio de feedback', () => {
  beforeEach(() => {
    feedbackService.resetDrafts();
  });

  it('registra un borrador y se puede opinar sobre el', () => {
    const id = feedbackService.registerDraft({
      surface: 'text', shown, trace: draft().trace, content: 'hola', context: draft().context,
    });
    expect(feedbackService.hasDraft(id)).toBe(true);
  });

  it('guarda el reporte y el borrador deja de estar disponible', async () => {
    const id = feedbackService.registerDraft({
      surface: 'text', shown, trace: draft().trace, content: 'hola', context: draft().context,
    });

    const outcome = await feedbackService.submit(id, { judgment: 'incorrect' });
    expect(outcome.ok).toBe(true);

    // Un mismo analisis no se puede reportar dos veces: falsearia el peso de
    // ese caso en el corpus.
    expect(feedbackService.hasDraft(id)).toBe(false);
    expect((await feedbackService.submit(id, { judgment: 'correct' })).ok).toBe(false);
  });

  it('el reporte sobrevive: queda en cola aunque no haya red', async () => {
    await feedbackService.clear();
    const id = feedbackService.registerDraft({
      surface: 'text', shown, trace: draft().trace, content: 'mandame bitcoin', context: draft().context,
    });
    await feedbackService.submit(id, { judgment: 'incorrect', note: 'era mi hermano' });

    const pending = await feedbackService.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('pending');
    expect(pending[0]?.errorKind).toBe('false-positive');
    expect(pending[0]?.note).toBe('era mi hermano');
  });

  it('no crece sin limite: los borradores viejos se caen', () => {
    // El escudo de portapapeles analiza cada copia. Casi ninguno se juzga.
    for (let i = 0; i < 200; i += 1) {
      feedbackService.registerDraft({
        surface: 'clipboard', shown, trace: draft().trace, content: `texto ${i}`, context: draft().context,
      });
    }
    const primero = feedbackService.registerDraft({
      surface: 'text', shown, trace: draft().trace, content: 'el mas nuevo', context: draft().context,
    });
    expect(feedbackService.hasDraft(primero)).toBe(true);
  });

  it('opinar sobre un analisis que ya no existe falla de forma explicita', async () => {
    const outcome = await feedbackService.submit('no-existe', { judgment: 'correct' });
    expect(outcome).toEqual({ ok: false, reason: 'draft-missing' });
  });
});

describe('trazabilidad del lexico', () => {
  it('cada entrada tiene un id unico', () => {
    // Dos entradas con el mismo id harian ambiguo cualquier reporte: no se
    // sabria cual de las dos hay que arreglar.
    const ids = LEXICON.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('una coincidencia dice QUE entrada fue, no solo su regex', () => {
    const result = scanLocalPatterns('mandame 300 euros en bitcoin urgente');
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.id).toBeTruthy();
    }
  });

  it('la huella del lexico es estable y tiene forma de huella', () => {
    expect(LEXICON_VERSION).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('el analisis deja un rastro sobre el que se puede opinar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllLanes();
    feedbackService.resetDrafts();
    (orchestrateAnalysis as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ result: null, providerId: null });
  });

  it('un analisis normal se puede juzgar, y su rastro nombra las entradas que dispararon', async () => {
    // Texto elegido porque el escaner LO ALARMA de verdad (62/100). El primer
    // intento uso 'mandame 300 euros en bitcoin urgente' y salio SEGURO: la
    // entrada fin-send-money no cubre el imperativo con enclitico. El test
    // estaba mal, pero el hueco es real y quedo anotado aparte.
    const result = await analyzeText('Envia dinero urgente a mi cuenta bitcoin ahora');

    expect(result.analysisId).toBeTruthy();
    expect(feedbackService.hasDraft(result.analysisId!)).toBe(true);

    await feedbackService.clear();
    const outcome = await feedbackService.submit(result.analysisId!, { judgment: 'incorrect' });
    expect(outcome.ok).toBe(true);

    const [report] = await feedbackService.pending();
    // Lo que hace accionable el reporte: no dice solo "estaba mal", dice cual
    // de las entradas del lexico hay que mirar.
    expect(report?.trace.lexiconIds.length).toBeGreaterThan(0);
    expect(report?.trace.localScore).toBeGreaterThan(0);
    expect(report?.context.lexiconVersion).toBe(LEXICON_VERSION);
    expect(report?.errorKind).toBe('false-positive');
  });

  it('el texto analizado viaja con el reporte, recortado al limite', async () => {
    const result = await analyzeText('hola que tal, nos vemos manana en la plaza');
    await feedbackService.clear();
    await feedbackService.submit(result.analysisId!, { judgment: 'incorrect' });

    const [report] = await feedbackService.pending();
    expect(report?.content).toContain('nos vemos manana');
    // Enseñaron SEGURO y el usuario dice que no: falso negativo.
    expect(report?.errorKind).toBe('false-negative');
  });
});
