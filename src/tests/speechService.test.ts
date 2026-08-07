import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal fake of the Web Speech API's SpeechRecognition — just enough surface
// for speechService.ts to drive, with handlers the test can trigger directly
// to simulate the browser ending a recognition session.
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();

  constructor() {
    lastInstance = this;
  }
}

let lastInstance: FakeRecognition | null = null;

describe('speechService restart loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastInstance = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  /**
   * Simulates the recognizer ending on its own and the restart timer firing.
   * Advances past the maximum backoff so the restart always lands.
   */
  function endAndAdvance() {
    lastInstance?.onend?.();
    vi.advanceTimersByTime(1000);
  }

  it('reports mic-unresponsive and stops instead of silently dying after repeated restarts with zero results', async () => {
    const { speechService } = await import('@/services/speechService');
    const onError = vi.fn();
    speechService.start(() => {}, 'es-ES', onError);

    expect(speechService.isRunning()).toBe(true);

    // 51 consecutive end-without-result cycles (the 51st is the one that
    // crosses the maxRestarts=50 threshold) — nothing ever came back, as if
    // the mic were muted or routed to a silent input device.
    for (let i = 0; i < 51; i++) endAndAdvance();

    expect(onError).toHaveBeenCalledWith('mic-unresponsive');
    expect(speechService.isRunning()).toBe(false);

    speechService.stop();
  });

  it('distinguishes a dead speech backend from a dead mic when audio WAS reaching the recognizer', async () => {
    const { speechService } = await import('@/services/speechService');
    const onError = vi.fn();
    speechService.start(() => {}, 'es-ES', onError);

    // Same silent restart loop, except the recognizer confirms each time that
    // it is receiving audio — so the microphone is fine and the fault is
    // downstream, in the browser's recognition service.
    for (let i = 0; i < 51; i++) {
      lastInstance?.onaudiostart?.();
      endAndAdvance();
    }

    expect(onError).toHaveBeenCalledWith('speech-service-unavailable');
    expect(onError).not.toHaveBeenCalledWith('mic-unresponsive');

    speechService.stop();
  });

  it('builds a fresh recognizer per restart instead of reusing a possibly-wedged one', async () => {
    const { speechService } = await import('@/services/speechService');
    speechService.start(() => {}, 'es-ES');

    const first = lastInstance;
    endAndAdvance();
    const second = lastInstance;

    expect(second).not.toBe(first);
    expect(second?.start).toHaveBeenCalled();

    speechService.stop();
  });

  it('never gives up as long as real results keep arriving between restarts', async () => {
    const { speechService } = await import('@/services/speechService');
    const onError = vi.fn();
    speechService.start(() => {}, 'es-ES', onError);

    // A long, healthy session: pauses (restarts) interleaved with real speech,
    // well past what would have been the old flat restart cap.
    for (let i = 0; i < 80; i++) {
      lastInstance?.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { isFinal: true, 0: { transcript: 'hola', confidence: 1 } } },
      });
      endAndAdvance();
    }

    expect(onError).not.toHaveBeenCalled();
    expect(speechService.isRunning()).toBe(true);

    speechService.stop();
  });
});
