import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { playAlertTone, resetAlertToneThrottle } from '@/utils/audioAlert';

/**
 * Fake mínimo de Web Audio: cuenta osciladores arrancados y guarda el pico de
 * ganancia, que es lo que determina qué tan fuerte suena la alerta.
 */
let startedOscillators = 0;
let peakGains: number[] = [];

/** Param de ganancia: registra la envolvente para poder medir el pico. */
class FakeGainParam {
  setValueAtTime(value: number) {
    // El pico real es el valor más alto programado en la envolvente.
    if (value > 0.001) peakGains.push(value);
    return this;
  }
  linearRampToValueAtTime(value: number) {
    if (value > 0.001) peakGains.push(value);
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}

/** Param de frecuencia: acepta valores pero no contamina la medición de volumen. */
class FakeFrequencyParam {
  setValueAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  resume = vi.fn();
  destination = {};

  createOscillator() {
    return {
      type: 'sine',
      frequency: new FakeFrequencyParam(),
      connect: vi.fn(),
      start: vi.fn(() => {
        startedOscillators++;
      }),
      stop: vi.fn(),
    };
  }

  createGain() {
    return { gain: new FakeGainParam(), connect: vi.fn() };
  }
}

beforeEach(() => {
  startedOscillators = 0;
  peakGains = [];
  resetAlertToneThrottle();
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('tono de alerta', () => {
  it('suena cuando hay una amenaza', () => {
    playAlertTone('high');
    expect(startedOscillators).toBeGreaterThan(0);
  });

  it('no se apila cuando dos escudos detectan casi al mismo tiempo', () => {
    // Voz, pantalla y video son independientes: sin este piso, dos tonos
    // superpuestos suenan como distorsión — exactamente el ruido áspero que
    // se reportó como molesto.
    playAlertTone('high');
    const afterFirst = startedOscillators;

    playAlertTone('high');
    playAlertTone('medium');

    expect(startedOscillators).toBe(afterFirst);
  });

  it('vuelve a sonar una vez pasado el piso entre tonos', () => {
    vi.useFakeTimers();
    playAlertTone('high');
    const afterFirst = startedOscillators;

    vi.advanceTimersByTime(5_000);
    playAlertTone('high');

    expect(startedOscillators).toBeGreaterThan(afterFirst);
  });

  it('deja pasar un aviso forzado aunque el anterior sea reciente', () => {
    playAlertTone('high');
    const afterFirst = startedOscillators;

    playAlertTone('high', { force: true });

    expect(startedOscillators).toBeGreaterThan(afterFirst);
  });

  it('mantiene el volumen muy por debajo de una alarma', () => {
    // La versión anterior usaba 0.15 con ondas de sierra y cuadrada. El
    // objetivo ahora es informar sin tapar la conversación que el usuario
    // está tratando de evaluar.
    playAlertTone('high');
    expect(Math.max(...peakGains)).toBeLessThanOrEqual(0.08);
  });

  it('suena mas suave para una sospecha que para una amenaza confirmada', () => {
    playAlertTone('low');
    const suspicionPeak = Math.max(...peakGains);

    peakGains = [];
    resetAlertToneThrottle();
    playAlertTone('high');
    const dangerPeak = Math.max(...peakGains);

    expect(suspicionPeak).toBeLessThan(dangerPeak);
  });

  it('no rompe nada si el navegador no tiene audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    resetAlertToneThrottle();
    expect(() => playAlertTone('high')).not.toThrow();
  });
});
