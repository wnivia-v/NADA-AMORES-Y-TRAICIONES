import type { VoiceEngine, VoiceHandlers, VoiceLanguage } from './types';
import { whisperLanguage } from './types';
import { audioConstraints } from './micMode';

// =============================================================================
// Whisper on-device engine — the offline fallback
//
// Runs entirely on the user's machine via Transformers.js (already a
// dependency, same library as the local text classifier). It exists so the
// voice shield still works when the browser cannot reach Google's speech
// backend — a VPN, corporate firewall or privacy blocker must not be able to
// switch off a fraud-protection tool.
//
// It is a FALLBACK, not the default, and the reason is measured rather than
// theoretical: a tiny quantized model on a phone's CPU is slower and less
// accurate than the cloud recognizer. It is the floor that always works.
//
// ── The accuracy lesson baked into this file ─────────────────────────────────
//
// The first version cut audio into fixed 4-second blocks. That was the main
// source of garbled output: a fixed timer slices straight through the middle
// of words, and Whisper — which is trained on whole utterances and will always
// emit *something* — confabulates plausible-sounding text to bridge the cut.
//
// This version cuts on SILENCE instead, so each transcription request gets a
// whole phrase the way it was actually spoken. Same model, dramatically better
// output, and lower perceived latency too: a short sentence is transcribed as
// soon as the speaker pauses rather than waiting out a 4-second window.
// =============================================================================

const TARGET_SAMPLE_RATE = 16_000;

/** Speech/silence decision threshold on frame RMS. */
const SPEECH_RMS = 0.008;

/**
 * Silence needed to consider an utterance finished.
 *
 * Too short and normal pauses between words split one sentence into fragments
 * (which hurts accuracy — Whisper needs context). Too long and every result
 * feels sluggish. ~700ms is comfortably past a word gap and well short of a
 * conversational turn.
 */
const SILENCE_HANG_MS = 700;

/** Utterances shorter than this are noise (a cough, a door) — not worth a pass. */
const MIN_UTTERANCE_MS = 400;

/**
 * Hard cap so someone speaking without pause still gets feedback, and so one
 * transcription request can never grow unbounded.
 */
const MAX_UTTERANCE_MS = 12_000;

/**
 * Audio kept before speech is detected, prepended to each utterance.
 *
 * Level-based detection necessarily triggers *after* sound begins, so without
 * this the attack of the first word is clipped and Whisper guesses at a
 * truncated opening — exactly where scam phrases tend to start ("mandame...",
 * "si no pagas...").
 */
const PRE_ROLL_MS = 300;

/** Beyond this, drop the oldest pending utterance rather than fall further behind. */
const MAX_PENDING_UTTERANCES = 2;

const msToSamples = (ms: number) => Math.round((ms / 1000) * TARGET_SAMPLE_RATE);

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>;

let transcriber: Transcriber | null = null;
let transcriberInit: Promise<Transcriber | null> | null = null;
let loadFailed = false;

function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadTranscriber(onStatus: (m: string) => void): Promise<Transcriber | null> {
  if (transcriber) return transcriber;
  if (transcriberInit) return transcriberInit;

  transcriberInit = (async () => {
    try {
      const { pipeline } = await import('@huggingface/transformers');

      // On a GPU the larger model is affordable and noticeably more accurate,
      // particularly for Spanish. On CPU/WASM it is not — "base" there is slow
      // enough to make a live shield useless, and a late alert protects nobody.
      const webgpu = hasWebGPU();
      const model = webgpu ? 'Xenova/whisper-base' : 'Xenova/whisper-tiny';

      onStatus(`Preparando reconocimiento local (${webgpu ? 'GPU' : 'CPU'}, primera vez descarga el modelo)...`);

      let lastPct = -1;
      const asr = await pipeline('automatic-speech-recognition', model, {
        ...(webgpu ? { device: 'webgpu' as const } : {}),
        dtype: 'q8',
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status !== 'progress' || typeof p.progress !== 'number') return;
          const pct = Math.round(p.progress);
          if (pct >= lastPct + 10) {
            lastPct = pct;
            onStatus(`Descargando modelo de voz: ${pct}%`);
          }
        },
      });

      onStatus('Reconocimiento local listo.');
      transcriber = asr as unknown as Transcriber;
      return transcriber;
    } catch (e) {
      console.warn('[NADA][whisper] Model init failed:', e);
      loadFailed = true;
      transcriberInit = null; // allow a retry on a later start()
      return null;
    }
  })();

  return transcriberInit;
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / (samples.length || 1));
}

/**
 * Linear resample to 16kHz.
 *
 * AudioContext is asked for 16kHz, but browsers may hand back the hardware
 * rate instead (Safari does). Feeding Whisper the wrong rate does not throw —
 * it transcribes confident nonsense, which is far worse than a visible error.
 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const lower = Math.floor(src);
    const upper = Math.min(lower + 1, input.length - 1);
    const w = src - lower;
    out[i] = (input[lower] ?? 0) * (1 - w) + (input[upper] ?? 0) * w;
  }
  return out;
}

/**
 * Whisper emits bracketed markers for non-speech audio ("[Música]", "(risas)")
 * and, on near-silence, stock filler it was trained on. Neither is something
 * the user said, and surfacing them as transcript would both mislead the user
 * and feed noise into fraud analysis.
 */
const NON_SPEECH = /^[[(][^\])]*[\])]$/;
const KNOWN_HALLUCINATIONS = [
  'gracias por ver el video',
  'gracias por ver el vídeo',
  'subtitulos realizados por la comunidad de amara.org',
  'subtítulos realizados por la comunidad de amara.org',
  'thanks for watching',
  'thank you for watching',
];

export function isLikelyHallucination(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!¡?¿]+$/g, '');
  if (!clean) return true;
  if (NON_SPEECH.test(clean)) return true;
  return KNOWN_HALLUCINATIONS.includes(clean);
}

export class WhisperEngine implements VoiceEngine {
  readonly id = 'whisper-local' as const;
  readonly label = 'Reconocimiento local (sin internet)';

  private handlers: VoiceHandlers | null = null;
  private lang: VoiceLanguage = 'es';
  private running = false;

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  // Utterance assembly
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private utterance: Float32Array[] = [];
  private utteranceSamples = 0;
  private speaking = false;
  private silenceSamples = 0;

  private pending: Float32Array[] = [];
  private draining = false;

  isAvailable(): boolean {
    return (
      !loadFailed &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window !== 'undefined' &&
      !!(window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext)
    );
  }

  async start(lang: VoiceLanguage, handlers: VoiceHandlers): Promise<void> {
    if (this.running) return;

    this.handlers = handlers;
    this.lang = lang;
    this.running = true;
    this.resetBuffers();

    // Load the model BEFORE opening the mic: lighting up the browser's
    // recording indicator for a session that can never transcribe a word is
    // both useless and alarming.
    const asr = await loadTranscriber((m) => handlers.onStatus(m));
    if (!asr) {
      this.running = false;
      handlers.onFatal('engine-unavailable', 'No se pudo cargar el modelo de voz local.');
      return;
    }
    if (!this.running) return; // stopped while loading

    try {
      // Las restricciones salen de micMode.ts: pedirlas procesadas abre el
      // microfono en modo comunicacion y Android pausa lo que este sonando.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(),
      });
    } catch (e) {
      this.running = false;
      const name = (e as { name?: string })?.name;
      handlers.onFatal(name === 'NotAllowedError' ? 'not-allowed' : 'no-microphone');
      return;
    }

    if (!this.running) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      return;
    }

    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
      this.source = this.audioCtx.createMediaStreamSource(this.stream);

      // ScriptProcessorNode is deprecated in favour of AudioWorklet, but it is
      // still implemented everywhere and needs no separate module URL (which
      // would have to satisfy this app's CSP). It only copies samples out —
      // no DSP on the audio thread — so the modern API would buy nothing here.
      this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (e) => this.onAudio(e);
      this.source.connect(this.processor);
      // The graph must terminate for data to flow. The node outputs nothing,
      // so this does not echo the microphone back to the speakers.
      this.processor.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('[NADA][whisper] Audio graph failed:', e);
      const h = this.handlers;
      this.stop();
      h?.onFatal('no-microphone', 'No se pudo abrir el audio del microfono.');
    }
  }

  private resetBuffers(): void {
    this.preRoll = [];
    this.preRollSamples = 0;
    this.utterance = [];
    this.utteranceSamples = 0;
    this.speaking = false;
    this.silenceSamples = 0;
    this.pending = [];
  }

  private onAudio(event: AudioProcessingEvent): void {
    if (!this.running) return;

    const input = event.inputBuffer.getChannelData(0);
    const sampleRate = event.inputBuffer.sampleRate;
    // The audio thread reuses this buffer, so it must be copied, not referenced.
    const frame = new Float32Array(input);
    const isSpeech = rms(frame) > SPEECH_RMS;

    if (!this.speaking) {
      // Idle: keep a short rolling pre-roll so the first word is not clipped.
      this.preRoll.push(frame);
      this.preRollSamples += frame.length;
      const limit = msToSamples(PRE_ROLL_MS);
      while (this.preRollSamples > limit && this.preRoll.length > 1) {
        this.preRollSamples -= this.preRoll.shift()?.length ?? 0;
      }

      if (isSpeech) {
        this.speaking = true;
        this.silenceSamples = 0;
        this.utterance = [...this.preRoll, frame];
        this.utteranceSamples = this.preRollSamples + frame.length;
        this.preRoll = [];
        this.preRollSamples = 0;
        this.handlers?.onActivity(true);
      }
      return;
    }

    // Speaking: accumulate, and track how long it has been quiet.
    this.utterance.push(frame);
    this.utteranceSamples += frame.length;
    this.silenceSamples = isSpeech ? 0 : this.silenceSamples + frame.length;

    const endedByPause = this.silenceSamples >= msToSamples(SILENCE_HANG_MS);
    const endedByLength = this.utteranceSamples >= msToSamples(MAX_UTTERANCE_MS);

    if (endedByPause || endedByLength) {
      this.closeUtterance(sampleRate, endedByLength);
    }
  }

  private closeUtterance(sampleRate: number, keepSpeaking: boolean): void {
    const samples = this.utteranceSamples;
    const parts = this.utterance;

    this.utterance = [];
    this.utteranceSamples = 0;
    this.silenceSamples = 0;
    this.speaking = keepSpeaking;
    if (!keepSpeaking) this.handlers?.onActivity(false);

    if (samples < msToSamples(MIN_UTTERANCE_MS)) return;

    const merged = new Float32Array(samples);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }

    this.pending.push(resampleTo16k(merged, sampleRate));
    // A machine that cannot keep up should lose the OLDEST audio: the newest
    // utterance is the one the user is waiting on, and an ever-growing backlog
    // would report threats minutes after they were spoken.
    while (this.pending.length > MAX_PENDING_UTTERANCES) this.pending.shift();

    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.running && this.pending.length > 0) {
        const audio = this.pending.shift();
        if (!audio || !transcriber) continue;

        try {
          const result = await transcriber(audio, {
            language: whisperLanguage(this.lang),
            task: 'transcribe',
          });
          if (!this.running) return;

          const text = (result?.text ?? '').trim();
          if (text && !isLikelyHallucination(text)) {
            this.handlers?.onTranscript(text, true);
          }
        } catch (e) {
          console.warn('[NADA][whisper] Transcription failed:', e);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  stop(): void {
    this.running = false;

    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    this.source?.disconnect();
    this.source = null;

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    this.resetBuffers();
    this.handlers?.onActivity(false);
    this.handlers = null;
  }
}
