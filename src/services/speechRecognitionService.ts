import { Capacitor } from '@capacitor/core';
import { speechService as webSpeechService } from './speechService';
import { nativeSpeechService } from './nativeSpeechService';
import { localSpeechService } from './localSpeechService';

// =============================================================================
// Speech Recognition — engine selection
//
// protectionEngine.ts talks to this single facade instead of picking an engine
// itself, so the rest of the app never has to know which one is running.
//
// Which engine, and why:
//
//   Android  -> native SpeechRecognizer (nativeSpeechService.ts).
//               Already built, fast, no model download, and the Web Speech API
//               does not exist in an Android WebView at all.
//
//   Web /    -> Whisper on-device (localSpeechService.ts).
//   Electron    NOT the Web Speech API, even though it is available there.
//               The Web Speech API streams audio to Google's servers, so a VPN,
//               firewall, guest network or privacy blocker kills the voice
//               shield outright with a 'network' error — observed in practice,
//               and the reason this default changed. A protection tool that
//               stops protecting on a locked-down network is not protecting
//               anyone, so the default is the engine nobody can block.
//
// webSpeechService is kept and still exported through this facade's fallback
// path: it is genuinely lower-latency when the network allows it, so it is
// what runs if the local model cannot be loaded at all.
// =============================================================================

type TranscriptCallback = (text: string, isFinal: boolean) => void;
type ErrorCallback = (error: string) => void;
type SpeechActivityCallback = (active: boolean) => void;
type StatusCallback = (message: string) => void;

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

class SpeechRecognitionService {
  /** True while the Web Speech API is standing in because the local model failed. */
  private usingWebFallback = false;

  isSupported(): boolean {
    if (isNativeAndroid()) return nativeSpeechService.isSupported();
    return localSpeechService.isSupported() || webSpeechService.isSupported();
  }

  start(
    callback: TranscriptCallback,
    lang = 'es-ES',
    onError?: ErrorCallback,
    onActivity?: SpeechActivityCallback,
    onStatus?: StatusCallback,
  ) {
    this.usingWebFallback = false;

    if (isNativeAndroid()) {
      void nativeSpeechService.start(callback, lang, onError, onActivity);
      return;
    }

    void localSpeechService.start(
      callback,
      lang,
      (error) => {
        // The local model failing to load is the one error worth retrying on a
        // different engine rather than reporting: the Web Speech API may well
        // work on this network, and a working shield beats a correct error
        // message. Every other error (mic denied, no mic) would fail there too.
        if (error === 'model-load-failed' && webSpeechService.isSupported()) {
          this.usingWebFallback = true;
          onStatus?.('No se pudo cargar el modelo local; usando reconocimiento del navegador.');
          webSpeechService.start(callback, lang, onError, onActivity);
          return;
        }
        onError?.(error);
      },
      onActivity,
      onStatus,
    );
  }

  stop() {
    if (isNativeAndroid()) {
      nativeSpeechService.stop();
      return;
    }
    // Stop both: which one is live depends on whether the fallback kicked in,
    // and stopping an already-stopped service is a no-op in both.
    localSpeechService.stop();
    webSpeechService.stop();
    this.usingWebFallback = false;
  }

  isRunning() {
    if (isNativeAndroid()) return nativeSpeechService.isRunning();
    return this.usingWebFallback ? webSpeechService.isRunning() : localSpeechService.isRunning();
  }
}

export const speechRecognitionService = new SpeechRecognitionService();
