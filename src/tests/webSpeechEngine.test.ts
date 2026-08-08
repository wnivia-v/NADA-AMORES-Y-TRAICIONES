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
});
