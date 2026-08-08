// =============================================================================
// Voice recognition — shared contract
//
// One interface, several engines behind it. The rest of the app (really just
// protectionEngine.ts) never learns which engine is running: it gets
// transcript text, speech activity, status messages and fatal errors, and
// that is all.
//
// The contract exists so engines can be swapped and chained. An engine that
// cannot work here says so once, fatally, and the orchestrator moves to the
// next one — instead of the old behaviour where a dead engine kept the UI
// showing "listening" forever.
// =============================================================================

export type VoiceEngineId = 'web-speech' | 'whisper-local' | 'android-native';

/**
 * Fatal reasons only. Anything an engine can recover from on its own (a pause
 * in speech, one dropped network round-trip) must never surface here — the
 * shield would stop for something that fixes itself a second later.
 */
export type VoiceErrorCode =
  /** The user or the OS refused microphone access. No engine can fix this. */
  | 'not-allowed'
  /** No usable input device. Also engine-independent. */
  | 'no-microphone'
  /**
   * This engine cannot work in this environment — unsupported API, model
   * failed to load, recognition backend unreachable. Engine-specific, so the
   * orchestrator responds by trying the next engine rather than giving up.
   */
  | 'engine-unavailable'
  | 'unknown';

/** True when the failure is about the machine/user, not about this engine. */
export function isEngineIndependentFailure(code: VoiceErrorCode): boolean {
  return code === 'not-allowed' || code === 'no-microphone';
}

export interface VoiceHandlers {
  /**
   * `isFinal: false` marks text the engine may still revise. It is shown
   * live so the panel proves it is listening, but it is never treated as a
   * settled transcript.
   */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Real speech detected right now — drives the "we can hear you" indicator. */
  onActivity: (speaking: boolean) => void;
  /** Human-readable progress (model download, engine switch) for the console panel. */
  onStatus: (message: string) => void;
  /** Terminal for THIS engine. The orchestrator decides what happens next. */
  onFatal: (code: VoiceErrorCode, detail?: string) => void;
}

export interface VoiceEngine {
  readonly id: VoiceEngineId;
  /** Shown to the user, so they know which engine produced a transcript. */
  readonly label: string;
  /** Cheap, synchronous pre-check. False means "do not even try me here". */
  isAvailable(): boolean;
  start(lang: VoiceLanguage, handlers: VoiceHandlers): Promise<void>;
  stop(): void;
}

// ── Languages ────────────────────────────────────────────────────────────────
//
// Kept as a table rather than scattered string literals so adding a language
// is one line here, not a hunt through three engines that each want the code
// in a different format.

export type VoiceLanguage = 'es' | 'en' | 'pt' | 'fr' | 'it' | 'de';

interface LanguageSpec {
  /** BCP-47, what the Web Speech API and Android's SpeechRecognizer expect. */
  tag: string;
  /** Whisper wants the English name of the language, not a tag. */
  whisper: string;
  label: string;
}

const LANGUAGES: Record<VoiceLanguage, LanguageSpec> = {
  es: { tag: 'es-ES', whisper: 'spanish', label: 'Espanol' },
  en: { tag: 'en-US', whisper: 'english', label: 'English' },
  pt: { tag: 'pt-BR', whisper: 'portuguese', label: 'Portugues' },
  fr: { tag: 'fr-FR', whisper: 'french', label: 'Francais' },
  it: { tag: 'it-IT', whisper: 'italian', label: 'Italiano' },
  de: { tag: 'de-DE', whisper: 'german', label: 'Deutsch' },
};

const FALLBACK: VoiceLanguage = 'es';

/** Accepts anything (including the app's narrower `Language`) and never throws. */
export function toVoiceLanguage(value: string | null | undefined): VoiceLanguage {
  const key = (value ?? '').slice(0, 2).toLowerCase();
  return key in LANGUAGES ? (key as VoiceLanguage) : FALLBACK;
}

export function languageTag(lang: VoiceLanguage): string {
  return LANGUAGES[lang].tag;
}

export function whisperLanguage(lang: VoiceLanguage): string {
  return LANGUAGES[lang].whisper;
}

export function languageLabel(lang: VoiceLanguage): string {
  return LANGUAGES[lang].label;
}

export const SUPPORTED_VOICE_LANGUAGES = Object.keys(LANGUAGES) as VoiceLanguage[];
