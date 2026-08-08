import type { VoiceEngine, VoiceHandlers, VoiceLanguage } from './types';
import { languageTag } from './types';

// =============================================================================
// Web Speech API engine — the primary engine on browsers and Electron
//
// Why primary: it is fast, accurate, multilingual and free, and it is what
// this project used originally when voice recognition worked well. Nothing
// running on-device comes close on a phone.
//
// Its one real weakness: it does not recognize anything locally. Chrome
// streams the microphone to Google's servers, so a VPN, corporate firewall,
// guest network or privacy blocker takes the whole engine down with a
// 'network' error. That is not a reason to avoid it — it is a reason to
// detect that case FAST and hand over to the offline engine, which is exactly
// what NETWORK_FAILURES_BEFORE_GIVING_UP does below.
// =============================================================================

interface RecognitionResultItem { transcript: string; confidence: number }
interface RecognitionResult { isFinal: boolean; [index: number]: RecognitionResultItem | undefined }
interface RecognitionResultList { length: number; [index: number]: RecognitionResult | undefined }
interface RecognitionEvent { resultIndex: number; results: RecognitionResultList }
interface RecognitionErrorEvent { error: string }

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

/**
 * How many consecutive 'network' errors before declaring this engine unusable.
 *
 * Deliberately small. A blocked network never un-blocks itself mid-session, so
 * retrying is just dead air for the user — previously ~27 seconds of it before
 * anything was reported. Three strikes is roughly 3-5s: long enough to ride
 * out one flaky round-trip, short enough that the offline engine takes over
 * before anyone concludes the app is broken.
 */
const NETWORK_FAILURES_BEFORE_GIVING_UP = 3;

/**
 * How many restarts with ZERO results in between before giving up.
 *
 * Any real result resets this, so an hour-long conversation full of natural
 * pauses never approaches it. Hitting it means the recognizer is looping
 * without ever producing a word — a wedged session, not a quiet room.
 */
const EMPTY_RESTARTS_BEFORE_GIVING_UP = 12;

const RESTART_DELAY_MS = 250;

function getSpeechRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export class WebSpeechEngine implements VoiceEngine {
  readonly id = 'web-speech' as const;
  readonly label = 'Reconocimiento del navegador';

  private recognition: Recognition | null = null;
  private handlers: VoiceHandlers | null = null;
  private lang: VoiceLanguage = 'es';
  private running = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  private emptyRestarts = 0;
  private networkFailures = 0;

  isAvailable(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  async start(lang: VoiceLanguage, handlers: VoiceHandlers): Promise<void> {
    if (this.running) return;

    if (!this.isAvailable()) {
      handlers.onFatal('engine-unavailable', 'Web Speech API no disponible');
      return;
    }

    this.handlers = handlers;
    this.lang = lang;
    this.running = true;
    this.emptyRestarts = 0;
    this.networkFailures = 0;

    this.launch();
  }

  /**
   * Builds a FRESH recognizer every time.
   *
   * Calling start() again on an instance that already ended is the flaky path
   * in Chrome: the object can reach a state where start() resolves but the
   * session dies within a few hundred ms, indefinitely, without ever firing an
   * error. A new object per attempt costs nothing and sidesteps it.
   */
  private launch(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || !this.running) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageTag(this.lang);
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      // Proof the whole path works right now: mic, network, backend. Both
      // give-up counters reset, so healthy long sessions never age out.
      this.emptyRestarts = 0;
      this.networkFailures = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const text = (result[0]?.transcript ?? '').trim();
        if (text) this.handlers?.onTranscript(text, result.isFinal);
      }
    };

    recognition.onspeechstart = () => this.handlers?.onActivity(true);
    recognition.onspeechend = () => this.handlers?.onActivity(false);

    recognition.onerror = (event) => {
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          this.fail('not-allowed');
          return;

        case 'audio-capture':
          this.fail('no-microphone');
          return;

        case 'network':
          this.networkFailures++;
          if (this.networkFailures >= NETWORK_FAILURES_BEFORE_GIVING_UP) {
            this.fail(
              'engine-unavailable',
              'El navegador no puede alcanzar el servicio de reconocimiento (VPN, firewall o bloqueador).',
            );
          }
          return;

        default:
          // 'no-speech', 'aborted' and friends are ordinary. onend restarts.
          return;
      }
    };

    recognition.onend = () => {
      if (!this.running) return;

      this.emptyRestarts++;
      if (this.emptyRestarts >= EMPTY_RESTARTS_BEFORE_GIVING_UP) {
        this.fail('engine-unavailable', 'El reconocedor del navegador no produce resultados.');
        return;
      }

      this.restartTimer = setTimeout(() => {
        if (this.running) this.launch();
      }, RESTART_DELAY_MS);
    };

    this.recognition = recognition;

    try {
      recognition.start();
    } catch {
      this.fail('engine-unavailable', 'No se pudo iniciar el reconocedor del navegador.');
    }
  }

  private fail(code: Parameters<VoiceHandlers['onFatal']>[0], detail?: string): void {
    const handlers = this.handlers;
    this.stop();
    handlers?.onFatal(code, detail);
  }

  stop(): void {
    this.running = false;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.recognition) {
      // Clear onend first, or abort() triggers the restart path on the way out.
      this.recognition.onend = null;
      this.recognition.onerror = null;
      this.recognition.onresult = null;
      try { this.recognition.abort(); } catch { /* already gone */ }
      this.recognition = null;
    }

    this.handlers?.onActivity(false);
    this.handlers = null;
  }
}
