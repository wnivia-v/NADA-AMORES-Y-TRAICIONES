// =============================================================================
// Speech Recognition Service — Web Speech API
// Continuous recognition with anti-loop protection for Electron
// =============================================================================

type TranscriptCallback = (text: string, isFinal: boolean) => void;

// Web Speech API types (not in all TS libs)
interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionResultItem | undefined;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult | undefined;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  start: () => void;
  abort: () => void;
}

class SpeechService {
  private recognition: SpeechRecognitionLike | null = null;
  private running = false;
  private callback: TranscriptCallback | null = null;
  private restartCount = 0;
  private maxRestarts = 50;

  isSupported(): boolean {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  start(callback: TranscriptCallback, lang = 'es-ES', onError?: (error: string) => void) {
    if (this.running) return;
    if (!this.isSupported()) {
      onError?.('not-supported');
      return;
    }

    this.callback = callback;
    this.restartCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SpeechAPI() as SpeechRecognitionLike;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = lang;

    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result) {
          const transcript = result[0]?.transcript ?? '';
          this.callback?.(transcript, result.isFinal);
        }
      }
    };

    this.recognition.onend = () => {
      if (this.running && this.restartCount < this.maxRestarts) {
        this.restartCount++;
        setTimeout(() => {
          if (this.running) this.recognition?.start();
        }, 200);
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        onError?.('not-allowed');
        this.stop();
      } else if (event.error === 'audio-capture') {
        onError?.('no-microphone');
        this.stop();
      } else if (event.error === 'network') {
        onError?.('network');
        // Speech API needs network for recognition — keep trying
      }
      // 'no-speech' is normal — user is just not talking, keep listening
    };

    this.running = true;
    try {
      this.recognition.start();
    } catch {
      onError?.('start-failed');
      this.running = false;
    }
  }

  stop() {
    this.running = false;
    this.callback = null;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.abort();
      this.recognition = null;
    }
  }

  isRunning() {
    return this.running;
  }
}

export const speechService = new SpeechService();
