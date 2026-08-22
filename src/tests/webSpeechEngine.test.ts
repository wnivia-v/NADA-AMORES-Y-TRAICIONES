import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSpeechEngine } from '@/services/voice/webSpeechEngine';
import type { VoiceHandlers } from '@/services/voice/types';

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();

  constructor() { live = this; }
}

let live: FakeRecognition | null = null;

function handlers() {
  return {
    onTranscript: vi.fn(),
    onActivity: vi.fn(),
    onStatus: vi.fn(),
    onFatal: vi.fn(),
  } satisfies Record<keyof VoiceHandlers, unknown>;
}

describe('WebSpeechEngine restart policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    live = null;
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  });

  afterEach(() => vi.useRealTimers());

  /** One end-of-session plus the restart timer. */
  function cycle(withAudio: boolean) {
    if (withAudio) live?.onaudiostart?.();
    live?.onend?.();
    vi.advanceTimersByTime(500);
  }

  it('keeps listening through long silence when audio is reaching the recognizer', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    // Mobile ends a session every few seconds of quiet. Fifty of those is a
    // user who simply is not talking — not a broken engine. An earlier
    // version gave up after twelve and handed over to the slower offline
    // engine, which read as "it stopped recognizing".
    for (let i = 0; i < 50; i++) cycle(true);

    expect(h.onFatal).not.toHaveBeenCalled();
    engine.stop();
  });

  it('gives up when sessions die without ever reaching the microphone', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    // No onaudiostart: the recognizer is wedged, not merely unspoken-to.
    for (let i = 0; i < 12; i++) cycle(false);

    expect(h.onFatal).toHaveBeenCalledWith('engine-unavailable', expect.any(String));
  });

  it('recovers its patience once audio starts flowing again', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    for (let i = 0; i < 11; i++) cycle(false); // one short of giving up
    cycle(true);                               // mic comes back
    for (let i = 0; i < 11; i++) cycle(false); // budget must have reset

    expect(h.onFatal).not.toHaveBeenCalled();
    engine.stop();
  });

  it('hands over when the user speaks but no transcript ever comes back', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    // A blocked speech backend looks healthy from the browser: the mic opens
    // and speech is detected locally, but recognition happens remotely so no
    // words arrive. Watching audio alone would call this fine forever, which
    // is exactly the "shows it is listening but never writes" report.
    for (let i = 0; i < 3; i++) {
      live?.onaudiostart?.();
      live?.onspeechstart?.();
      live?.onspeechend?.();
      live?.onend?.();
      vi.advanceTimersByTime(500);
    }

    expect(h.onFatal).toHaveBeenCalledWith('engine-unavailable', expect.any(String));
  });

  it('does not count silent sessions as unproductive', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    // Audio flowing, nobody speaking. Never a failure, however long it lasts.
    for (let i = 0; i < 30; i++) cycle(true);

    expect(h.onFatal).not.toHaveBeenCalled();
    engine.stop();
  });

  it('surfaces a denied microphone immediately, without retrying', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    live?.onerror?.({ error: 'not-allowed' });

    expect(h.onFatal).toHaveBeenCalledWith('not-allowed', undefined);
  });

  it('declares itself unavailable after repeated network failures, so a fallback can take over', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    live?.onerror?.({ error: 'network' });
    live?.onerror?.({ error: 'network' });
    expect(h.onFatal).not.toHaveBeenCalled(); // one flaky round-trip is survivable
    live?.onerror?.({ error: 'network' });

    expect(h.onFatal).toHaveBeenCalledWith('engine-unavailable', expect.stringContaining('VPN'));
  });

  it('treats a transcript as proof the whole path works', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    live?.onerror?.({ error: 'network' });
    live?.onerror?.({ error: 'network' });

    live?.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, 0: { transcript: 'mandame la plata', confidence: 1 } } },
    });
    expect(h.onTranscript).toHaveBeenCalledWith('mandame la plata', true);

    // Counter reset, so two more network errors must not reach the threshold.
    live?.onerror?.({ error: 'network' });
    live?.onerror?.({ error: 'network' });
    expect(h.onFatal).not.toHaveBeenCalled();

    engine.stop();
  });

  it('builds a fresh recognizer per restart', async () => {
    const engine = new WebSpeechEngine();
    await engine.start('es', handlers());

    const first = live;
    cycle(true);

    expect(live).not.toBe(first);
    engine.stop();
  });

  it('stops cleanly without triggering another restart', async () => {
    const engine = new WebSpeechEngine();
    const h = handlers();
    await engine.start('es', h);

    const current = live;
    engine.stop();
    // abort() makes the browser fire onend; it must not resurrect the loop.
    current?.onend?.();
    vi.advanceTimersByTime(1000);

    expect(live).toBe(current);
    expect(h.onFatal).not.toHaveBeenCalled();
  });

  // ── Escalera de espera en silencio ────────────────────────────────────────
  //
  // Reportado usando la app: un pitido cada siete segundos con el escudo
  // puesto. El sonido lo pone Android en cada recognition.start(), y el
  // navegador cierra la sesion tras unos segundos de silencio, asi que
  // reabrir a los 250 ms convertia una sala en calma en una alarma de horno.
  describe('espera creciente cuando no hay nadie hablando', () => {
    /** Termina una sesion SIN voz y deja pasar `ms`. */
    function silencio(ms: number) {
      live?.onaudiostart?.();
      live?.onend?.();
      vi.advanceTimersByTime(ms);
    }

    it('las dos primeras veces reabre rapido: una pausa al respirar no cuenta', async () => {
      const engine = new WebSpeechEngine();
      await engine.start('es', handlers());
      const primero = live;

      silencio(300);
      expect(live).not.toBe(primero);

      engine.stop();
    });

    it('en silencio sostenido deja de reabrir cada pocos milisegundos', async () => {
      const engine = new WebSpeechEngine();
      await engine.start('es', handlers());

      silencio(300);  // 1a: rapida
      silencio(300);  // 2a: rapida
      const antes = live;

      // 3a sesion en silencio: ya no reabre en 300 ms.
      live?.onaudiostart?.();
      live?.onend?.();
      vi.advanceTimersByTime(300);
      expect(live).toBe(antes);

      // Pero reabre. No se queda muerto, que seria el otro extremo.
      vi.advanceTimersByTime(2000);
      expect(live).not.toBe(antes);

      engine.stop();
    });

    it('una sola palabra devuelve el ritmo rapido', async () => {
      const engine = new WebSpeechEngine();
      await engine.start('es', handlers());

      for (let i = 0; i < 5; i++) silencio(9000);

      // Alguien habla.
      live?.onspeechstart?.();
      live?.onend?.();
      vi.advanceTimersByTime(300);
      const trasHablar = live;

      // Y la siguiente vuelve a ser rapida.
      live?.onspeechstart?.();
      live?.onend?.();
      vi.advanceTimersByTime(300);
      expect(live).not.toBe(trasHablar);

      engine.stop();
    });

    it('alguien presente y callado NO cuesta ocho segundos de sordera', async () => {
      // La primera version media "sin transcripcion" en vez de "sin voz", y
      // penalizaba a quien esta delante hablando bajito o con ruido de fondo.
      //
      // Se queda en DOS sesiones a proposito: a la tercera con voz y sin texto
      // el motor se rinde por otra regla —"hablo y no volvio nada"— que es
      // correcta y anterior a esto. Lo que se prueba aqui es solo que la voz
      // impide la escalera de espera, no lo que pasa despues.
      const engine = new WebSpeechEngine();
      await engine.start('es', handlers());

      for (let i = 0; i < 2; i++) {
        live?.onaudiostart?.();
        live?.onspeechstart?.();
        live?.onend?.();
        vi.advanceTimersByTime(300);
      }

      // Tercera reapertura, tambien rapida: la voz reinicio el contador cada vez.
      const antes = live;
      live?.onaudiostart?.();
      live?.onend?.();
      vi.advanceTimersByTime(300);
      expect(live).not.toBe(antes);

      engine.stop();
    });

    it('parar durante una espera larga no deja un reinicio en vuelo', async () => {
      const engine = new WebSpeechEngine();
      await engine.start('es', handlers());

      for (let i = 0; i < 4; i++) silencio(9000);
      const ultimo = live;

      live?.onaudiostart?.();
      live?.onend?.();
      engine.stop();

      vi.advanceTimersByTime(60_000);
      expect(live).toBe(ultimo);
    });
  });

});
