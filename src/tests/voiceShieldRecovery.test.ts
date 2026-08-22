// =============================================================================
// El escudo de voz no puede rendirse solo
//
// Reportado usando la app: "el escudo se esta desactivando cada pocos segundos
// y me toca activarlo manualmente".
//
// La causa: tres fallos de red seguidos —tres a cinco segundos— bastaban para
// declarar inservible el reconocedor del navegador. Si el motor local tampoco
// conseguia descargar su modelo, la cadena se agotaba y el escudo se apagaba.
// Sin reintento y sin vuelta atras.
//
// Pero casi nada de lo que tumba el reconocimiento es permanente: una red que
// va y viene, un cortafuegos, una descarga a medias. Rendirse a los cinco
// segundos ante algo que se arregla solo —y encima dejando el escudo apagado—
// es lo peor de las dos opciones: quien lo activo sigue creyendo que esta
// protegido.
//
// Lo que NO se puede hacer es fingir. Mientras no hay reconocimiento no se oye
// nada, y eso se dice con esas palabras.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const voiceMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  isSupported: vi.fn(() => true),
  isRunning: vi.fn(() => false),
  getActiveEngine: vi.fn(() => null),
}));

vi.mock('@/services/voice', () => ({
  voiceRecognition: voiceMock,
  isEngineIndependentFailure: (c: string) => c === 'not-allowed' || c === 'no-microphone',
}));
vi.mock('@/services/safeBrowsingService', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true, threats: [] }),
}));
vi.mock('@/services/scamDatabase', () => ({
  scamDatabase: { lookup: vi.fn().mockResolvedValue({ found: false }), store: vi.fn() },
}));
vi.mock('@/services/aiProviders', () => ({ orchestrateAnalysis: vi.fn() }));

import { protectionEngine } from '@/services/protectionEngine';

/** Ultimo juego de manejadores que el motor entrego al reconocedor. */
let entregados: Record<string, (...args: never[]) => void> = {};

function callbacks() {
  return {
    onAlert: vi.fn(),
    onAnalysisResult: vi.fn(),
    onShieldStatusChange: vi.fn(),
    onNotification: vi.fn(),
    onLog: vi.fn(),
    onVoiceTranscript: vi.fn(),
    onVoiceInterim: vi.fn(),
    onVoiceRealtimeVerdict: vi.fn(),
    onVoiceSpeechActive: vi.fn(),
    onVoiceError: vi.fn(),
    getLanguage: () => 'es' as const,
  };
}

/** El estado de voz mas reciente que se le comunico a la interfaz. */
function ultimoEstadoVoz(cb: ReturnType<typeof callbacks>) {
  const llamadas = cb.onShieldStatusChange.mock.calls.filter((c) => c[0] === 'voice');
  return llamadas.length > 0 ? (llamadas[llamadas.length - 1]![1] as Record<string, unknown>) : null;
}

describe('recuperacion del escudo de voz', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    voiceMock.isSupported.mockReturnValue(true);
    voiceMock.start.mockImplementation(async (opts: Record<string, (...a: never[]) => void>) => {
      entregados = opts;
    });
  });

  afterEach(() => {
    protectionEngine.stopVoiceMonitoring();
    vi.useRealTimers();
  });

  it('un fallo de red NO apaga el escudo: se reintenta solo', async () => {
    const cb = callbacks();
    protectionEngine.init(cb);
    await protectionEngine.startVoiceMonitoring();

    (entregados.onError as (c: string, d?: string) => void)(
      'engine-unavailable',
      'VPN o cortafuegos.',
    );

    // Sigue ACTIVO —nadie tiene que acordarse de reactivarlo— pero no
    // escuchando, y las dos cosas se dicen por separado.
    expect(ultimoEstadoVoz(cb)).toMatchObject({ active: true, scanning: false });

    // Y el aviso no promete lo que no hay.
    const aviso = cb.onVoiceError.mock.calls.at(-1)?.[0] as string;
    expect(aviso).toContain('Sin escuchar');
    expect(aviso).toMatch(/reintenta en \d+ s/);
  });

  it('el reintento ocurre de verdad', async () => {
    const cb = callbacks();
    protectionEngine.init(cb);
    await protectionEngine.startVoiceMonitoring();
    expect(voiceMock.start).toHaveBeenCalledTimes(1);

    (entregados.onError as (c: string) => void)('engine-unavailable');
    await vi.advanceTimersByTimeAsync(6000);

    expect(voiceMock.start).toHaveBeenCalledTimes(2);
  });

  it('cada caida seguida espera mas que la anterior', async () => {
    const cb = callbacks();
    protectionEngine.init(cb);
    await protectionEngine.startVoiceMonitoring();

    const esperas: number[] = [];
    for (let i = 0; i < 3; i++) {
      (entregados.onError as (c: string) => void)('engine-unavailable');
      const aviso = cb.onVoiceError.mock.calls.at(-1)?.[0] as string;
      esperas.push(Number(/reintenta en (\d+) s/.exec(aviso)![1]));
      await vi.advanceTimersByTimeAsync(70_000);
    }

    // Insistir cada cinco segundos contra una red caida no la levanta.
    expect(esperas[1]).toBeGreaterThan(esperas[0]!);
    expect(esperas[2]).toBeGreaterThan(esperas[1]!);
  });

  it('una transcripcion retira el aviso y vuelve a escuchando', async () => {
    const cb = callbacks();
    protectionEngine.init(cb);
    await protectionEngine.startVoiceMonitoring();

    (entregados.onError as (c: string) => void)('engine-unavailable');
    await vi.advanceTimersByTimeAsync(6000);

    (entregados.onTranscript as (t: string, f: boolean) => void)('hola que tal', true);

    expect(cb.onVoiceError).toHaveBeenLastCalledWith(null);
    expect(ultimoEstadoVoz(cb)).toMatchObject({ scanning: true });
  });

  it('un microfono denegado SI apaga el escudo: esperar no lo arregla', async () => {
    const cb = callbacks();
    protectionEngine.init(cb);
    await protectionEngine.startVoiceMonitoring();

    (entregados.onError as (c: string) => void)('not-allowed');

    expect(ultimoEstadoVoz(cb)).toMatchObject({ active: false, scanning: false });

    // Y no se reintenta: seria pedir permiso una y otra vez.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(voiceMock.start).toHaveBeenCalledTimes(1);
  });

  it('apagar el escudo cancela un reintento en vuelo', async () => {
    const cb = callbacks();
    protectionEngine.init(cb);
    await protectionEngine.startVoiceMonitoring();

    (entregados.onError as (c: string) => void)('engine-unavailable');
    protectionEngine.stopVoiceMonitoring();

    // Sin esto, el escudo reaparecia solo despues de que alguien lo apagara.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(voiceMock.start).toHaveBeenCalledTimes(1);
  });
});
