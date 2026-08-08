import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VoiceEngine, VoiceHandlers, VoiceLanguage, VoiceErrorCode } from '@/services/voice/types';

// Each fake engine records what it was asked to do and exposes its handlers so
// a test can make it fail exactly the way a real one would.
class FakeEngine implements VoiceEngine {
  handlers: VoiceHandlers | null = null;
  started = false;
  stopped = false;
  startedWithLang: VoiceLanguage | null = null;

  constructor(
    readonly id: 'web-speech' | 'whisper-local' | 'android-native',
    readonly label: string,
    private available = true,
  ) {}

  isAvailable() { return this.available; }

  async start(lang: VoiceLanguage, handlers: VoiceHandlers) {
    this.started = true;
    this.startedWithLang = lang;
    this.handlers = handlers;
  }

  stop() { this.stopped = true; }

  /** Simulate this engine dying the way a real one reports a fatal condition. */
  fail(code: VoiceErrorCode, detail?: string) {
    this.handlers?.onFatal(code, detail);
  }
}

let primary: FakeEngine;
let fallback: FakeEngine;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}));

vi.mock('@/services/voice/webSpeechEngine', () => ({
  WebSpeechEngine: class { constructor() { return primary; } },
}));

vi.mock('@/services/voice/whisperEngine', () => ({
  WhisperEngine: class { constructor() { return fallback; } },
}));

vi.mock('@/services/voice/nativeEngine', () => ({
  NativeAndroidEngine: class { constructor() { return new FakeEngine('android-native', 'native'); } },
}));

function makeOptions(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lang: 'es',
    onTranscript: vi.fn(),
    onActivity: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onEngineChange: vi.fn(),
    ...overrides,
  };
}

describe('voice orchestrator engine chain', () => {
  beforeEach(() => {
    vi.resetModules();
    primary = new FakeEngine('web-speech', 'Reconocimiento del navegador');
    fallback = new FakeEngine('whisper-local', 'Reconocimiento local (sin internet)');
  });

  afterEach(() => vi.clearAllMocks());

  it('starts on the primary engine and reports which one is live', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    const options = makeOptions();

    await voiceRecognition.start(options as never);

    expect(primary.started).toBe(true);
    expect(fallback.started).toBe(false);
    expect(voiceRecognition.getActiveEngine()?.id).toBe('web-speech');
    expect(options.onEngineChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'web-speech' }),
    );

    voiceRecognition.stop();
  });

  it('falls back to the offline engine when the primary cannot work here', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    const options = makeOptions();
    await voiceRecognition.start(options as never);

    // What a blocked network looks like: the browser recognizer gives up.
    primary.fail('engine-unavailable', 'Red bloqueada.');
    await vi.waitFor(() => expect(fallback.started).toBe(true));

    expect(voiceRecognition.getActiveEngine()?.id).toBe('whisper-local');
    // The user is told, and the reason survives into the message.
    expect(options.onStatus).toHaveBeenCalledWith(expect.stringContaining('Red bloqueada.'));
    // Still listening — no error surfaced, because the shield kept working.
    expect(options.onError).not.toHaveBeenCalled();

    voiceRecognition.stop();
  });

  it('does NOT try other engines when the microphone itself is denied', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    const options = makeOptions();
    await voiceRecognition.start(options as never);

    // Every engine would hit the same wall, and retrying would mean another
    // permission prompt for nothing.
    primary.fail('not-allowed');

    expect(fallback.started).toBe(false);
    expect(options.onError).toHaveBeenCalledWith('not-allowed', undefined);
    expect(voiceRecognition.isRunning()).toBe(false);
  });

  it('does NOT try other engines when there is no microphone', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    const options = makeOptions();
    await voiceRecognition.start(options as never);

    primary.fail('no-microphone');

    expect(fallback.started).toBe(false);
    expect(options.onError).toHaveBeenCalledWith('no-microphone', undefined);
  });

  it('reports a single final error only after every engine is exhausted', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    const options = makeOptions();
    await voiceRecognition.start(options as never);

    primary.fail('engine-unavailable', 'Sin red.');
    await vi.waitFor(() => expect(fallback.started).toBe(true));
    fallback.fail('engine-unavailable', 'Modelo no cargo.');

    await vi.waitFor(() => expect(options.onError).toHaveBeenCalledTimes(1));
    expect(options.onError).toHaveBeenCalledWith('engine-unavailable', 'Modelo no cargo.');
    expect(voiceRecognition.isRunning()).toBe(false);
  });

  it('skips an engine that declares itself unavailable up front', async () => {
    primary = new FakeEngine('web-speech', 'navegador', false);

    const { voiceRecognition } = await import('@/services/voice');
    await voiceRecognition.start(makeOptions() as never);

    expect(primary.started).toBe(false);
    expect(fallback.started).toBe(true);

    voiceRecognition.stop();
  });

  it('stops every engine, not only the active one', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    await voiceRecognition.start(makeOptions() as never);

    primary.fail('engine-unavailable');
    await vi.waitFor(() => expect(fallback.started).toBe(true));

    voiceRecognition.stop();

    // A fallback can start while the previous engine is still winding down,
    // so leaving the earlier one running would keep the mic open invisibly.
    expect(primary.stopped).toBe(true);
    expect(fallback.stopped).toBe(true);
    expect(voiceRecognition.isRunning()).toBe(false);
  });

  it('passes the resolved language down to the engine', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    await voiceRecognition.start(makeOptions({ lang: 'en-GB' }) as never);

    expect(primary.startedWithLang).toBe('en');

    voiceRecognition.stop();
  });

  it('ignores a second start while already listening', async () => {
    const { voiceRecognition } = await import('@/services/voice');
    await voiceRecognition.start(makeOptions() as never);

    const secondOptions = makeOptions();
    await voiceRecognition.start(secondOptions as never);

    expect(secondOptions.onEngineChange).not.toHaveBeenCalled();

    voiceRecognition.stop();
  });
});
