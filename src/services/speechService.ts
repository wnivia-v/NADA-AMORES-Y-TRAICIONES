// =============================================================================
// Speech Recognition Service — Web Speech API
// Continuous recognition with anti-loop protection for Electron
// =============================================================================

type TranscriptCallback = (text: string, isFinal: boolean) => void;
/** Fired on every recognition error, even ones that don't stop the session. */
type ErrorCallback = (error: string) => void;
/** Fired when the browser detects speech starting/ending — real proof the mic is live. */
type SpeechActivityCallback = (active: boolean) => void;

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
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

// Errors that mean the recognition session is actually dead and won't recover
// on its own — the caller must be told so it can stop pretending to listen.
const FATAL_ERRORS = new Set(['not-allowed', 'audio-capture', 'service-not-allowed']);

class SpeechService {
  private recognition: SpeechRecognitionLike | null = null;
  private running = false;
  private callback: TranscriptCallback | null = null;
  private errorCallback: ErrorCallback | null = null;
  private activityCallback: SpeechActivityCallback | null = null;
  private restartCount = 0;
  private maxRestarts = 50;

  isSupported(): boolean {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  start(callback: TranscriptCallback, lang = 'es-ES', onError?: ErrorCallback, onActivity?: SpeechActivityCallback) {
    if (this.running) return;
    if (!this.isSupported()) {
      onError?.('not-supported');
      return;
    }

    this.callback = callback;
    this.errorCallback = onError ?? null;
    this.activityCallback = onActivity ?? null;
    this.restartCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SpeechAPI() as SpeechRecognitionLike;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = lang;

    this.recognition.onresult = (event) => {
      // A real result proves the mic path genuinely works right now — reset
      // the restart counter so a long, healthy session with normal pauses
      // never drifts toward the give-up threshold below.
      this.restartCount = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result) {
          const transcript = result[0]?.transcript ?? '';
          this.callback?.(transcript, result.isFinal);
        }
      }
    };

    this.recognition.onspeechstart = () => this.activityCallback?.(true);
    this.recognition.onspeechend = () => this.activityCallback?.(false);

    this.recognition.onend = () => {
      if (!this.running) return;

      if (this.restartCount >= this.maxRestarts) {
        // 50 consecutive restarts with not a single result in between means
        // something is actually broken (mic muted, wrong input device, OS
        // permission silently revoked mid-session) — not just a normal pause
        // in conversation, which the onresult reset above already protects
        // against. Doing nothing here used to leave `running` true forever
        // with a dead recognizer underneath: the UI kept showing "listening"
        // while nothing was, or could ever again be, captured.
        this.errorCallback?.('mic-unresponsive');
        this.stop();
        return;
      }

      this.restartCount++;
      setTimeout(() => {
        if (this.running) this.recognition?.start();
      }, 200);
    };

    this.recognition.onerror = (event) => {
      // Every error is surfaced — previously 'not-allowed' silently called
      // stop() with no callback, so the UI kept showing "listening" while the
      // mic session was actually dead underneath it.
      this.errorCallback?.(event.error);
      if (FATAL_ERRORS.has(event.error)) {
        this.stop();
      }
      // 'no-speech' / 'network' / 'aborted' are transient — onend's restart
      // loop already recovers from those while `running` stays true.
    };

    this.running = true;
    try {
      this.recognition.start();
    } catch {
      // Synchronous throw from the browser (e.g. called in a bad state) —
      // go through stop() so `running` and the recognition handle are
      // cleared consistently, not just the flag.
      onError?.('start-failed');
      this.stop();
    }
  }

  stop() {
    this.running = false;
    this.callback = null;
    this.errorCallback = null;
    this.activityCallback = null;
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
