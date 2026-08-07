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
  /** Fires when the recognizer actually begins receiving audio from the mic. */
  onaudiostart: (() => void) | null;
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
  private lang = 'es-ES';
  private restartCount = 0;
  private maxRestarts = 50;
  /**
   * Whether the recognizer ever reported receiving audio during this session.
   *
   * This is the signal that separates the two failure modes that otherwise
   * look identical from the outside (silent restart loop, no error event):
   * the recognizer never getting audio at all vs. getting audio that never
   * resolves into words. Only the first one is a microphone/routing problem.
   */
  private audioStartedEver = false;

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
    this.lang = lang;
    this.restartCount = 0;
    this.audioStartedEver = false;
    this.running = true;

    this.launchRecognition();
  }

  /**
   * Builds a FRESH recognizer and starts it.
   *
   * Reusing one instance across restarts (calling start() again on the same
   * object after onend) is the documented-flaky path in Chrome: the instance
   * can land in a state where start() resolves but the session ends within a
   * few hundred milliseconds, forever, with no error event ever firing. That
   * produces exactly the symptom seen here — ~50 restarts in ~27s, silent.
   * A new instance per attempt costs nothing and avoids that state entirely.
   */
  private launchRecognition() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechAPI() as SpeechRecognitionLike;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.lang;

    recognition.onresult = (event) => {
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

    recognition.onaudiostart = () => { this.audioStartedEver = true; };
    recognition.onspeechstart = () => this.activityCallback?.(true);
    recognition.onspeechend = () => this.activityCallback?.(false);

    recognition.onend = () => {
      if (!this.running) return;

      if (this.restartCount >= this.maxRestarts) {
        // Many consecutive restarts with not a single result in between means
        // something is actually broken — not just a normal pause in
        // conversation, which the onresult reset above already protects
        // against. Doing nothing here used to leave `running` true forever
        // with a dead recognizer underneath: the UI kept showing "listening"
        // while nothing was, or could ever again be, captured.
        //
        // Which of the two codes is reported matters for the user: one points
        // at their microphone, the other at the browser's speech backend.
        // Reporting the mic one in both cases sends them to fix a device that
        // was never the problem.
        this.errorCallback?.(this.audioStartedEver ? 'speech-service-unavailable' : 'mic-unresponsive');
        this.stop();
        return;
      }

      this.restartCount++;
      // Gentle backoff: an instant-death loop should not hammer the speech
      // backend 5x/second, but a normal conversational pause must resume
      // fast. Ramps 250ms -> 1s only while restarts keep failing, and
      // onresult resets restartCount, so healthy sessions stay at 250ms.
      const delay = Math.min(250 + this.restartCount * 15, 1000);
      setTimeout(() => {
        if (this.running) this.launchRecognition();
      }, delay);
    };

    recognition.onerror = (event) => {
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

    this.recognition = recognition;

    try {
      recognition.start();
    } catch {
      // Synchronous throw from the browser (e.g. called in a bad state) —
      // go through stop() so `running` and the recognition handle are
      // cleared consistently, not just the flag.
      this.errorCallback?.('start-failed');
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
