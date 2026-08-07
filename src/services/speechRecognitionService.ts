import { Capacitor } from '@capacitor/core';
import { speechService as webSpeechService } from './speechService';
import { nativeSpeechService } from './nativeSpeechService';

// =============================================================================
// Speech Recognition — platform switch
// protectionEngine.ts talks to this single facade instead of picking a service
// itself. PWA/Electron use the Web Speech API (speechService.ts); the Android
// APK has no Web Speech API in its WebView, so it uses the native
// SpeechRecognizer bridge (nativeSpeechService.ts) instead. Same
// start/stop/isSupported/isRunning shape either way.
// =============================================================================

type TranscriptCallback = (text: string, isFinal: boolean) => void;
type ErrorCallback = (error: string) => void;
type SpeechActivityCallback = (active: boolean) => void;

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

class SpeechRecognitionService {
  isSupported(): boolean {
    return isNativeAndroid() ? nativeSpeechService.isSupported() : webSpeechService.isSupported();
  }

  start(callback: TranscriptCallback, lang = 'es-ES', onError?: ErrorCallback, onActivity?: SpeechActivityCallback) {
    if (isNativeAndroid()) {
      nativeSpeechService.start(callback, lang, onError, onActivity);
    } else {
      webSpeechService.start(callback, lang, onError, onActivity);
    }
  }

  stop() {
    if (isNativeAndroid()) {
      nativeSpeechService.stop();
    } else {
      webSpeechService.stop();
    }
  }

  isRunning() {
    return isNativeAndroid() ? nativeSpeechService.isRunning() : webSpeechService.isRunning();
  }
}

export const speechRecognitionService = new SpeechRecognitionService();
