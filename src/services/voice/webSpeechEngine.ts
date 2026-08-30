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
 * How many restarts in a row where the recognizer never even opened the
 * microphone, before declaring it wedged.
 *
 * The counter is reset by `onaudiostart`, NOT only by a transcript, and that
 * distinction is the whole point. On mobile the browser ends a session after
 * a few seconds of quiet no matter what `continuous` says, so a user who
 * simply stops talking generates a steady stream of result-less restarts. An
 * earlier version counted those, which meant roughly a minute of silence was
 * enough to condemn a perfectly healthy engine and hand over to the slower
 * offline one — the recognizer "stopped working" for the crime of listening
 * to a quiet room.
 *
 * `onaudiostart` fires whenever audio is genuinely flowing, silent or not, so
 * what survives here is only the real failure: sessions that end within
 * milliseconds without ever reaching the microphone.
 */
const WEDGED_RESTARTS_BEFORE_GIVING_UP = 12;

/**
 * How many sessions where the user demonstrably SPOKE but no transcript ever
 * came back, before handing over to another engine.
 *
 * This is the signal that actually catches an unreachable speech backend, and
 * it exists because the two obvious signals both fail here:
 *
 *   - Waiting for a 'network' error does not work: the browser does not always
 *     emit one when the backend is unreachable.
 *   - Watching `onaudiostart` does not work either. Recognition happens on
 *     Google's servers, but the microphone and the speech detector are local,
 *     so audio flows and `onspeechstart` fires perfectly while nothing is
 *     being transcribed. Treating that as health is what let a blocked session
 *     sit there looking alive — "shows it is listening but never writes
 *     anything" — instead of falling back to the offline engine.
 *
 * Speech in, nothing out, repeatedly, is unambiguous: this engine cannot do
 * its job here, whatever the reason.
 */
const UNPRODUCTIVE_SESSIONS_BEFORE_GIVING_UP = 3;

const RESTART_DELAY_MS = 100;

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

  private wedgedRestarts = 0;
  private networkFailures = 0;
  private unproductiveSessions = 0;
  /** Did the current session ever reach the microphone? See WEDGED_RESTARTS_*. */
  private audioStartedThisSession = false;
  /** Did the user actually speak during this session? */
  private speechDetectedThisSession = false;
  /** Did this session produce any transcript at all? */
  private producedResultThisSession = false;

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
    this.wedgedRestarts = 0;
    this.networkFailures = 0;
    this.unproductiveSessions = 0;

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
    this.audioStartedThisSession = false;
    this.speechDetectedThisSession = false;
    this.producedResultThisSession = false;

    recognition.onresult = (event) => {
      // Proof the whole path works right now: mic, network, backend.
      this.producedResultThisSession = true;
      this.wedgedRestarts = 0;
      this.networkFailures = 0;
      this.unproductiveSessions = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const text = (result[0]?.transcript ?? '').trim();
        if (text) this.handlers?.onTranscript(text, result.isFinal);
      }
    };

    // Audio reaching the recognizer is enough to call the engine healthy —
    // a silent room is not a malfunction, and treating it as one is what
    // used to kill the shield after a minute of quiet.
    recognition.onaudiostart = () => {
      this.audioStartedThisSession = true;
      this.wedgedRestarts = 0;
    };

    recognition.onspeechstart = () => {
      this.speechDetectedThisSession = true;
      this.handlers?.onActivity(true);
    };
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

      // Sessions that reached the microphone are healthy no matter how quiet
      // they were; only ones that died before opening it count against the
      // engine. Mobile ends a session every few seconds of silence, so
      // counting those would condemn a working recognizer for a quiet room.
      if (!this.audioStartedThisSession) {
        this.wedgedRestarts++;
        if (this.wedgedRestarts >= WEDGED_RESTARTS_BEFORE_GIVING_UP) {
          this.fail('engine-unavailable', 'El reconocedor del navegador no llega al microfono.');
          return;
        }
      }

      // The user spoke and got nothing back. Recognition is remote while the
      // microphone and speech detector are local, so this is what a blocked
      // backend looks like from here — everything appears alive, no words
      // ever arrive. Repeated, it means this engine cannot deliver.
      if (this.speechDetectedThisSession && !this.producedResultThisSession) {
        this.unproductiveSessions++;
        if (this.unproductiveSessions >= UNPRODUCTIVE_SESSIONS_BEFORE_GIVING_UP) {
          this.fail(
            'engine-unavailable',
            'Se detecto voz pero el navegador no devolvio transcripcion (VPN, firewall o bloqueador).',
          );
          return;
        }
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
