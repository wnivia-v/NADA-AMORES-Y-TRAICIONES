// =============================================================================
// El orquestador y su acta
//
// El caso que da nombre a este fichero es el primero: `race` no corria. Hacia
// Promise.allSettled —esperar a TODOS— y despues devolvia el primero no nulo
// recorriendo el array, que viene ordenado por prioridad. Resultado: ganaba
// siempre la de mayor prioridad, despues de pagar la latencia de la mas lenta.
// Y era la estrategia por defecto, asi que nadie lo notaba: el veredicto salia
// bien, solo que tarde y por el motivo equivocado.
//
// Un panel que dijera "gano por ser la mas rapida" encima de eso habria estado
// mintiendo con datos. De ahi que este test venga con el panel y no despues.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProviderId } from '@/services/aiProviders/types';
import type { AnalysisRequest, ProviderAnswer } from '@/shared/llm/types';

type Guion = {
  disponible: boolean;
  demoraMs: number;
  responde: ProviderAnswer;
};

const guiones = vi.hoisted(() => {
  const sinSeñal = { signal: null };
  const base: Record<string, { disponible: boolean; demoraMs: number; responde: any }> = {
    local:   { disponible: true,  demoraMs: 0, responde: sinSeñal },
    gemini:  { disponible: true,  demoraMs: 0, responde: sinSeñal },
    groq:    { disponible: true,  demoraMs: 0, responde: sinSeñal },
    claude:  { disponible: true,  demoraMs: 0, responde: sinSeñal },
    bedrock: { disponible: true,  demoraMs: 0, responde: sinSeñal },
  };
  return base;
});

function fake(id: string) {
  return {
    id,
    name: `fake-${id}`,
    cost: 'free-local' as const,
    isAvailable: () => guiones[id]!.disponible,
    async analyze(_r: unknown, _s?: AbortSignal) {
      const g = guiones[id]!;
      if (g.demoraMs > 0) await new Promise((r) => setTimeout(r, g.demoraMs));
      return g.responde;
    },
  };
}

vi.mock('@/services/aiProviders/localProvider', () => ({ localProvider: fake('local'), resetLocalProvider: () => {} }));
vi.mock('@/services/aiProviders/geminiProvider', () => ({ geminiProvider: fake('gemini'), resetGeminiProvider: () => {} }));
vi.mock('@/services/aiProviders/groqProvider', () => ({ groqProvider: fake('groq') }));
vi.mock('@/services/aiProviders/claudeProvider', () => ({ claudeProvider: fake('claude') }));
vi.mock('@/services/aiProviders/bedrockProvider', () => ({ bedrockProvider: fake('bedrock') }));

import { orchestrateAnalysis, saveProviderConfig } from '@/services/aiProviders/orchestrator';
import { clearRateLimiters } from '@/services/aiProviders/rateLimiter';

const PETICION: AnalysisRequest = {
  task: 'text',
  text: 'hola',
  hardening: {
    originalLength: 4,
    truncated: false,
    invisibleCharsRemoved: 0,
    homoglyphsFolded: 0,
    injectionAttempts: [],
  },
};

function señal(value: number, confidence = 0.8): ProviderAnswer {
  return {
    signal: {
      type: 'llm-risk',
      value,
      confidence,
      timestamp: Date.now(),
      tactics: [],
      explanation: `puntue ${value}`,
      recommendations: [],
    },
  };
}

/** Deja el guion en silencio y enciende solo los que se pidan. */
function escena(
  activos: Record<string, Partial<Guion>>,
  estrategia: 'fallback' | 'race' | 'best-result' | 'consensus',
) {
  for (const id of Object.keys(guiones)) {
    guiones[id] = { disponible: false, demoraMs: 0, responde: { signal: null } };
  }
  const providers: Record<string, { enabled: boolean }> = {
    local: { enabled: false }, gemini: { enabled: false }, groq: { enabled: false },
    claude: { enabled: false }, bedrock: { enabled: false },
  };
  for (const [id, g] of Object.entries(activos)) {
    guiones[id] = { disponible: true, demoraMs: 0, responde: { signal: null }, ...g } as any;
    providers[id] = { enabled: true };
  }
  saveProviderConfig({ strategy: estrategia, providers: providers as any });
}

function run(id: ProviderId, d: Awaited<ReturnType<typeof orchestrateAnalysis>>) {
  return d.deliberation.runs.find((r) => r.id === id)!;
}

beforeEach(() => {
  localStorage.clear();
  clearRateLimiters();
});

describe('estrategia race', () => {
  it('gana quien contesta ANTES, no quien tiene mas prioridad', async () => {
    // local es prioridad 1 y groq prioridad 2. Si el ganador se eligiera por el
    // array —el fallo que habia— saldria local. Sale groq porque llega antes.
    escena(
      {
        local: { demoraMs: 60, responde: señal(80) },
        groq: { demoraMs: 1, responde: señal(20) },
      },
      'race',
    );

    const d = await orchestrateAnalysis(PETICION);

    expect(d.providerId).toBe('groq');
    expect(d.result!.value).toBe(20);
    expect(d.deliberation.reason.kind).toBe('fastest');
  });

  it('la que aun pensaba queda anotada como tal, no como averiada', async () => {
    escena(
      {
        local: { demoraMs: 60, responde: señal(80) },
        groq: { demoraMs: 1, responde: señal(20) },
      },
      'race',
    );

    const d = await orchestrateAnalysis(PETICION);
    const lenta = run('local', d);

    expect(lenta.outcome).toBe('still-running');
    expect(lenta.detail).toContain('seguia pensando');
    // Y no genera indicio: no contestar a tiempo en una carrera es la carrera.
    expect(d.deliberation.suspicions).toEqual([]);
  });

  it('no espera a la lenta: cierra en cuanto llega la primera valida', async () => {
    escena(
      {
        local: { demoraMs: 300, responde: señal(80) },
        groq: { demoraMs: 1, responde: señal(20) },
      },
      'race',
    );

    const t0 = Date.now();
    await orchestrateAnalysis(PETICION);
    const transcurrido = Date.now() - t0;

    // Con el codigo anterior esto tardaba lo que la mas lenta (300 ms).
    expect(transcurrido).toBeLessThan(250);
  });

  it('si la rapida no trae señal valida, gana la siguiente que si', async () => {
    escena(
      {
        local: { demoraMs: 40, responde: señal(70) },
        groq: { demoraMs: 1, responde: { signal: null, rejection: 'not-json' } },
      },
      'race',
    );

    const d = await orchestrateAnalysis(PETICION);

    expect(d.providerId).toBe('local');
    expect(run('groq', d).outcome).toBe('rejected');
    expect(run('groq', d).rejection).toBe('not-json');
  });
});

describe('estrategia fallback', () => {
  it('gana la primera de la cadena y las de detras quedan como no llamadas', async () => {
    escena(
      {
        local: { responde: { signal: null, transport: 'model-init', detail: 'sin modelo' } },
        groq: { responde: señal(55) },
        gemini: { responde: señal(99) },
      },
      'fallback',
    );

    const d = await orchestrateAnalysis(PETICION);

    expect(d.providerId).toBe('groq');
    expect(run('local', d).outcome).toBe('failed');
    expect(run('gemini', d).outcome).toBe('not-reached');
    expect(d.deliberation.reason).toMatchObject({ kind: 'first-available', skipped: ['local'] });
  });
});

describe('estrategia consensus', () => {
  it('anota quien coincidio y quien no, con el umbral', async () => {
    escena(
      {
        local: { responde: señal(85) },
        groq: { responde: señal(90) },
        gemini: { responde: señal(10) },
      },
      'consensus',
    );

    const d = await orchestrateAnalysis(PETICION);
    const reason = d.deliberation.reason;

    expect(reason.kind).toBe('consensus');
    if (reason.kind !== 'consensus') throw new Error('rama imposible');
    expect(reason.agreeing.sort()).toEqual(['groq', 'local']);
    expect(reason.dissenting).toEqual(['gemini']);
    expect(reason.threshold).toBeGreaterThan(0);
  });

  it('sin mayoria cae a la lectura mas prudente y lo dice', async () => {
    escena(
      {
        local: { responde: señal(10) },
        groq: { responde: señal(50) },
        gemini: { responde: señal(95) },
      },
      'consensus',
    );

    const d = await orchestrateAnalysis(PETICION);

    expect(d.deliberation.reason.kind).toBe('no-consensus');
    expect(d.result!.value).toBe(95);
  });
});

describe('estrategia best-result', () => {
  it('con desacuerdo toma la mas alta, para proteger a quien usa la app', async () => {
    escena({ local: { responde: señal(20) }, groq: { responde: señal(88) } }, 'best-result');
    const d = await orchestrateAnalysis(PETICION);

    expect(d.result!.value).toBe(88);
    expect(d.deliberation.reason).toMatchObject({ kind: 'most-cautious', among: 2 });
  });

  it('si todas ven SEGURO toma la mas convencida de que lo es', async () => {
    escena({ local: { responde: señal(5) }, groq: { responde: señal(30) } }, 'best-result');
    const d = await orchestrateAnalysis(PETICION);

    expect(d.result!.value).toBe(5);
    expect(d.deliberation.reason.kind).toBe('most-confident-safe');
  });
});

describe('el acta cuenta lo que antes se perdia', () => {
  it('distingue abstenerse de fallar', async () => {
    escena(
      {
        local: { responde: { signal: null, detail: 'sin vecino bastante parecido' } },
        groq: { responde: { signal: null, transport: 'http-error', detail: 'HTTP 502' } },
        gemini: { responde: señal(40) },
      },
      'consensus',
    );

    const d = await orchestrateAnalysis(PETICION);

    expect(run('local', d).outcome).toBe('abstained');
    expect(run('groq', d).outcome).toBe('failed');
    expect(run('groq', d).detail).toBe('HTTP 502');
  });

  it('las apagadas salen en el acta, para que se vea POR QUE hubo poca deliberacion', async () => {
    escena({ local: { responde: señal(50) } }, 'race');
    const d = await orchestrateAnalysis(PETICION);

    expect(run('claude', d).outcome).toBe('disabled');
    expect(run('bedrock', d).outcome).toBe('disabled');
    // Y con una sola participante se dice que no hubo deliberacion.
    expect(d.deliberation.reason.kind).toBe('sole-answer');
  });

  it('cuando no contesta ninguna, el acta lo dice en vez de quedarse vacia', async () => {
    escena(
      {
        local: { responde: { signal: null, transport: 'network', detail: 'sin red' } },
        groq: { responde: { signal: null, transport: 'network', detail: 'sin red' } },
      },
      'race',
    );

    const d = await orchestrateAnalysis(PETICION);

    expect(d.result).toBeNull();
    expect(d.deliberation.reason.kind).toBe('silence');
    expect(d.deliberation.runs.filter((r) => r.outcome === 'failed')).toHaveLength(2);
  });

  it('mide el tiempo de cada una', async () => {
    escena({ local: { demoraMs: 30, responde: señal(50) } }, 'race');
    const d = await orchestrateAnalysis(PETICION);

    expect(run('local', d).ms).toBeGreaterThanOrEqual(25);
  });

  it('arrastra los intentos de inyeccion de la entrada al acta', async () => {
    escena({ local: { responde: señal(50) } }, 'race');

    const d = await orchestrateAnalysis({
      ...PETICION,
      hardening: {
        ...PETICION.hardening,
        injectionAttempts: [{ id: 'ignore-previous', excerpt: 'ignora lo anterior' }],
      },
    });

    expect(d.deliberation.injectionIds).toEqual(['ignore-previous']);
  });
});
