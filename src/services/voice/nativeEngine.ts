import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { VoiceEngine, VoiceHandlers, VoiceLanguage } from './types';
import { languageTag } from './types';

// =============================================================================
// Android native engine — bridges SpeechRecognitionPlugin.java
//
// The Web Speech API does not exist in an Android WebView at all, so the APK
// needs a real bridge onto android.speech.SpeechRecognizer. It is fast, needs
// no model download, and is the right primary engine on Android — Whisper on
// a phone CPU is the fallback there, not the default.
//
// The plugin already simulates continuous listening (it restarts the
// recognizer after each result and each recoverable error), so this class only
// has to translate its events into the shared contract.
// =============================================================================

interface NativeSpeechPlugin {
  start(options: { lang: string }): Promise<void>;
  stop(): Promise<void>;
  isSupported(): Promise<{ supported: boolean }>;
  addListener(
    eventName: 'transcript',
    listener: (data: { text: string; isFinal: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechActivity',
    listener: (data: { active: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'error',
    listener: (data: { code: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeSpeech = registerPlugin<NativeSpeechPlugin>('SpeechRecognition');

export class NativeAndroidEngine implements VoiceEngine {
  readonly id = 'android-native' as const;
  readonly label = 'Reconocimiento de Android';

  private handlers: VoiceHandlers | null = null;
  private listeners: PluginListenerHandle[] = [];
  private running = false;

  isAvailable(): boolean {
    // The real check is async (it round-trips into Java). Answering
    // optimistically and surfacing a fatal 'engine-unavailable' from start()
    // is equivalent for the orchestrator — it falls through to the next
    // engine either way — and avoids making availability async everywhere.
    return true;
  }

  async start(lang: VoiceLanguage, handlers: VoiceHandlers): Promise<void> {
    if (this.running) return;
    this.handlers = handlers;
    this.running = true;

    try {
      const { supported } = await NativeSpeech.isSupported();
      if (!supported) {
        this.running = false;
        handlers.onFatal('engine-unavailable', 'El dispositivo no tiene reconocimiento de voz de Android.');
        return;
      }
    } catch {
      this.running = false;
      handlers.onFatal('engine-unavailable', 'El plugin de reconocimiento no respondio.');
      return;
    }

    if (!this.running) return;

    this.listeners = [
      await NativeSpeech.addListener('transcript', (d) => {
        const text = (d.text ?? '').trim();
        if (text) handlers.onTranscript(text, d.isFinal);
      }),
      await NativeSpeech.addListener('speechActivity', (d) => handlers.onActivity(d.active)),
      await NativeSpeech.addListener('error', (d) => this.onNativeError(d.code)),
    ];

    try {
      await NativeSpeech.start({ lang: languageTag(lang) });
    } catch {
      const h = this.handlers;
      this.stop();
      h?.onFatal('engine-unavailable', 'No se pudo iniciar el reconocedor de Android.');
    }
  }

  private onNativeError(code: string): void {
    const handlers = this.handlers;

    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        this.stop();
        handlers?.onFatal('not-allowed');
        return;

      case 'audio-capture':
        this.stop();
        handlers?.onFatal('no-microphone');
        return;

      case 'not-supported':
      case 'start-failed':
        this.stop();
        handlers?.onFatal('engine-unavailable');
        return;

      default:
        // 'no-speech' / 'network' / 'aborted': the plugin restarts itself.
        return;
    }
  }

  stop(): void {
    this.running = false;
    void NativeSpeech.stop().catch(() => {});
    for (const handle of this.listeners) void handle.remove();
    this.listeners = [];
    this.handlers?.onActivity(false);
    this.handlers = null;
  }
}
