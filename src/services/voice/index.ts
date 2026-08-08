import { Capacitor } from '@capacitor/core';
import { WebSpeechEngine } from './webSpeechEngine';
import { WhisperEngine } from './whisperEngine';
import { NativeAndroidEngine } from './nativeEngine';
import {
  isEngineIndependentFailure,
  toVoiceLanguage,
  type VoiceEngine,
  type VoiceEngineId,
  type VoiceErrorCode,
  type VoiceLanguage,
} from './types';

// =============================================================================
// Voice recognition orchestrator
//
// The only voice entry point the rest of the app uses. It owns engine choice
// and automatic fallback, so protectionEngine.ts asks for "listening" and gets
// it from whichever engine can actually deliver on this device and network.
//
// Engine order is deliberate, and reflects what was measured rather than what
// sounds most impressive:
//
//   Browser / Electron : Web Speech -> Whisper local
//     Web Speech is fast, accurate and multilingual. Its only real failure is
//     an unreachable backend (VPN/firewall/blocker), which it now detects in
//     seconds instead of half a minute, at which point Whisper takes over.
//
//   Android APK        : native SpeechRecognizer -> Whisper local
//     No Web Speech API in a WebView. The native recognizer is fast and needs
//     no download, so Whisper is the safety net rather than the default —
//     a tiny model on a phone CPU is slower and less accurate than both.
//
// Fallback only happens for 'engine-unavailable'. A denied microphone or a
// missing input device would fail identically on every engine, so retrying
// them would just spam the user with permission prompts.
// =============================================================================

export type { VoiceLanguage, VoiceEngineId, VoiceErrorCode } from './types';
export { SUPPORTED_VOICE_LANGUAGES, languageLabel } from './types';

export interface VoiceSessionOptions {
  lang: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onActivity: (speaking: boolean) => void;
  onStatus: (message: string) => void;
  /** Called once, after every engine has been ruled out. */
  onError: (code: VoiceErrorCode, detail?: string) => void;
  /** Which engine is actually producing transcripts now. */
  onEngineChange?: (engine: { id: VoiceEngineId; label: string }) => void;
}

function isAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

class VoiceRecognition {
  private engines: VoiceEngine[] = [];
  private activeIndex = -1;
  private active: VoiceEngine | null = null;
  private options: VoiceSessionOptions | null = null;
  private lang: VoiceLanguage = 'es';
  private running = false;

  private buildChain(): VoiceEngine[] {
    return isAndroid()
      ? [new NativeAndroidEngine(), new WhisperEngine()]
      : [new WebSpeechEngine(), new WhisperEngine()];
  }

  isSupported(): boolean {
    return this.buildChain().some((e) => e.isAvailable());
  }

  isRunning(): boolean {
    return this.running;
  }

  getActiveEngine(): { id: VoiceEngineId; label: string } | null {
    return this.active ? { id: this.active.id, label: this.active.label } : null;
  }

  async start(options: VoiceSessionOptions): Promise<void> {
    if (this.running) return;

    this.options = options;
    this.lang = toVoiceLanguage(options.lang);
    this.engines = this.buildChain();
    this.activeIndex = -1;
    this.running = true;

    await this.advance();
  }

  /** Starts the next engine that claims it can run here. */
  private async advance(detail?: string): Promise<void> {
    if (!this.running) return;
    const options = this.options;
    if (!options) return;

    for (let i = this.activeIndex + 1; i < this.engines.length; i++) {
      const engine = this.engines[i];
      if (!engine || !engine.isAvailable()) continue;

      this.activeIndex = i;
      this.active = engine;

      // Only announce a switch, not the first pick — saying "using X" before
      // anything has gone wrong is noise.
      if (i > 0) {
        options.onStatus(
          detail
            ? `${detail} Cambiando a: ${engine.label}.`
            : `Cambiando a: ${engine.label}.`,
        );
      }
      options.onEngineChange?.({ id: engine.id, label: engine.label });

      await engine.start(this.lang, {
        onTranscript: options.onTranscript,
        onActivity: options.onActivity,
        onStatus: options.onStatus,
        onFatal: (code, engineDetail) => this.onEngineFatal(code, engineDetail),
      });
      return;
    }

    // Chain exhausted.
    this.active = null;
    this.running = false;
    options.onError('engine-unavailable', detail);
  }

  private onEngineFatal(code: VoiceErrorCode, detail?: string): void {
    if (!this.running) return;

    if (isEngineIndependentFailure(code)) {
      // The microphone itself is unavailable — every engine would hit the same
      // wall, and retrying means another permission prompt for nothing.
      this.active = null;
      this.running = false;
      this.options?.onError(code, detail);
      return;
    }

    void this.advance(detail);
  }

  stop(): void {
    this.running = false;
    // Stop every engine, not just the active one: a fallback may have started
    // while an earlier engine was still winding down.
    for (const engine of this.engines) {
      try { engine.stop(); } catch { /* already stopped */ }
    }
    this.engines = [];
    this.active = null;
    this.activeIndex = -1;
    this.options = null;
  }
}

export const voiceRecognition = new VoiceRecognition();
