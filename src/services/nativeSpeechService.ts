import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// =============================================================================
// Native Speech Recognition — bridges android/.../SpeechRecognitionPlugin.java
// The Web Speech API this app uses on PWA/Electron (speechService.ts) does not
// exist in Android's WebView, so the voice shield needs a real native bridge
// onto android.speech.SpeechRecognizer instead. Only used when running inside
// the Capacitor Android shell — see speechRecognitionService.ts for the
// platform switch.
// =============================================================================

type TranscriptCallback = (text: string, isFinal: boolean) => void;
type ErrorCallback = (error: string) => void;
type SpeechActivityCallback = (active: boolean) => void;

interface NativeSpeechPlugin {
  start(options: { lang: string }): Promise<void>;
  stop(): Promise<void>;
  isSupported(): Promise<{ supported: boolean }>;
  addListener(
    eventName: 'transcript',
    listenerFunc: (data: { text: string; isFinal: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechActivity',
    listenerFunc: (data: { active: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(eventName: 'error', listenerFunc: (data: { code: string }) => void): Promise<PluginListenerHandle>;
}

const NativeSpeechRecognition = registerPlugin<NativeSpeechPlugin>('SpeechRecognition');

class NativeSpeechService {
  private running = false;
  private listenerHandles: PluginListenerHandle[] = [];

  isSupported(): boolean {
    // The native check is async (it round-trips to Kotlin/Java), but every
    // caller here needs a synchronous answer to decide whether to even try —
    // same contract as the web SpeechService. Android without Google's speech
    // services is rare enough that optimistically saying yes and surfacing
    // 'not-supported' through onError at start() is the simpler, honest
    // behavior: real errors are still visible, just one step later.
    return true;
  }

  async start(callback: TranscriptCallback, lang = 'es-ES', onError?: ErrorCallback, onActivity?: SpeechActivityCallback) {
    if (this.running) return;
    this.running = true;

    const transcriptHandle = await NativeSpeechRecognition.addListener('transcript', (data) => {
      callback(data.text, data.isFinal);
    });
    const activityHandle = await NativeSpeechRecognition.addListener('speechActivity', (data) => {
      onActivity?.(data.active);
    });
    const errorHandle = await NativeSpeechRecognition.addListener('error', (data) => {
      onError?.(data.code);
      const FATAL = new Set(['not-allowed', 'audio-capture', 'service-not-allowed', 'not-supported']);
      if (FATAL.has(data.code)) this.stop();
    });
    this.listenerHandles = [transcriptHandle, activityHandle, errorHandle];

    try {
      await NativeSpeechRecognition.start({ lang });
    } catch {
      onError?.('start-failed');
      this.stop();
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    void NativeSpeechRecognition.stop();
    for (const handle of this.listenerHandles) void handle.remove();
    this.listenerHandles = [];
  }

  isRunning() {
    return this.running;
  }
}

export const nativeSpeechService = new NativeSpeechService();
