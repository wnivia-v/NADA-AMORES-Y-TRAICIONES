// =============================================================================
// Local Speech Recognition — Whisper on-device via Transformers.js
//
// Why this exists:
//
// The Web Speech API (speechService.ts) does NOT recognize speech locally. It
// streams the microphone to Google's servers and waits for a transcript back.
// That makes the whole voice shield dependent on reaching those servers, and
// when anything blocks that path — a VPN, a corporate firewall, an ad/privacy
// blocker, a restrictive guest network — the recognizer fails with a 'network'
// error and the shield is simply dead. That is not a hypothetical: it is the
// failure that motivated this file.
//
// A fraud-protection tool that stops protecting on a locked-down network is
// not protecting anyone. This engine removes that dependency entirely: audio
// is transcribed on the user's own machine, so it works offline, cannot be
// blocked, and — same argument as localProvider.ts — never ships a victim's
// conversation to a third party.
//
// Honest trade-offs, because they are real:
//   - First run downloads the model (~40MB), then it is cached by the browser.
//   - It transcribes in chunks of a few seconds, not word-by-word as you speak,
//     so text appears in bursts rather than continuously.
//   - A tiny model is less accurate than Google's cloud model, especially on
//     noisy audio. It is a floor that always works, not a strict upgrade.
// =============================================================================

type TranscriptCallback = (text: string, isFinal: boolean) => void;
type ErrorCallback = (error: string) => void;
type SpeechActivityCallback = (active: boolean) => void;
/** Progress/status text (model download, warm-up) for the console panel. */
type StatusCallback = (message: string) => void;

// Multilingual. "tiny" over "base" on purpose: this drives a LIVE shield, and
// an alert that arrives late is worth less than one that is slightly better
// worded. tiny transcribes several times faster on CPU/WASM.
const MODEL_ID = 'Xenova/whisper-tiny';

// Whisper expects 16kHz mono float32.
const TARGET_SAMPLE_RATE = 16000;

// How much audio to accumulate before transcribing. Shorter = lower latency
// but worse accuracy (Whisper needs context) and more CPU churn.
const CHUNK_SECONDS = 4;
const CHUNK_SAMPLES = CHUNK_SECONDS * TARGET_SAMPLE_RATE;

// Below this RMS the chunk is treated as silence and skipped entirely — no
// point spending seconds of CPU transcribing a quiet room, and Whisper is
// prone to hallucinating filler text ("Gracias por ver el video") on silence.
const SILENCE_RMS = 0.006;

// Cap on buffered audio, so a slow machine that cannot keep up drops old
// audio instead of growing the buffer without bound.
const MAX_BUFFERED_SAMPLES = CHUNK_SAMPLES * 3;

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>;

let transcriber: Transcriber | null = null;
let transcriberInit: Promise<Transcriber | null> | null = null;

async function getTranscriber(onStatus?: StatusCallback): Promise<Transcriber | null> {
  if (transcriber) return transcriber;
  if (transcriberInit) return transcriberInit;

  transcriberInit = (async () => {
    try {
      onStatus?.('Preparando reconocimiento de voz local (la primera vez descarga ~40MB)...');
      // Lazy import keeps onnxruntime out of the initial bundle, same as localProvider.
      const { pipeline } = await import('@huggingface/transformers');
      let lastPct = -1;
      const asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'q8',
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status !== 'progress' || typeof p.progress !== 'number') return;
          const pct = Math.round(p.progress);
          // Only report every 10% — the raw callback fires constantly.
          if (pct >= lastPct + 10) {
            lastPct = pct;
            onStatus?.(`Descargando modelo de voz local: ${pct}%`);
          }
        },
      });
      onStatus?.('Reconocimiento de voz local listo.');
      transcriber = asr as unknown as Transcriber;
      return transcriber;
    } catch (e) {
      console.warn('[NADA][local-speech] Model init failed:', e);
      transcriberInit = null; // allow a retry on the next start()
      return null;
    }
  })();

  return transcriberInit;
}

/** Exported for testing. */
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
 * AudioContext is asked for a 16kHz rate up front, but browsers are allowed to
 * ignore that and hand back the hardware rate (Safari does). Feeding Whisper
 * audio at the wrong rate does not error — it silently transcribes gibberish,
 * which is a far worse failure than a visible one.
 *
 * Exported for testing precisely because of that: a bug here has no symptom
 * other than bad transcriptions.
 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const lower = Math.floor(srcIndex);
    const upper = Math.min(lower + 1, input.length - 1);
    const weight = srcIndex - lower;
    out[i] = (input[lower] ?? 0) * (1 - weight) + (input[upper] ?? 0) * weight;
  }
  return out;
}

class LocalSpeechService {
  private running = false;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  private buffer: Float32Array[] = [];
  private bufferedSamples = 0;
  private transcribing = false;
  private speaking = false;

  private callback: TranscriptCallback | null = null;
  private activityCallback: SpeechActivityCallback | null = null;
  private statusCallback: StatusCallback | null = null;
  private lang = 'es-ES';

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(
    callback: TranscriptCallback,
    lang = 'es-ES',
    onError?: ErrorCallback,
    onActivity?: SpeechActivityCallback,
    onStatus?: StatusCallback,
  ) {
    if (this.running) return;

    if (!this.isSupported()) {
      onError?.('not-supported');
      return;
    }

    this.callback = callback;
    this.activityCallback = onActivity ?? null;
    this.statusCallback = onStatus ?? null;
    this.lang = lang;
    this.running = true;
    this.buffer = [];
    this.bufferedSamples = 0;
    this.speaking = false;

    // Model first: asking for the mic and then failing to load the model would
    // light up the browser's recording indicator for a session that can never
    // produce a word.
    const asr = await getTranscriber((m) => this.statusCallback?.(m));
    if (!asr) {
      this.running = false;
      onError?.('model-load-failed');
      return;
    }
    if (!this.running) return; // stopped while the model was loading

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      this.running = false;
      const name = (e as { name?: string })?.name;
      onError?.(name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture');
      return;
    }
    if (!this.running) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE });
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);

      // ScriptProcessorNode is deprecated in favour of AudioWorklet, but it is
      // still implemented everywhere and needs no separate module URL (which
      // would have to satisfy this app's CSP). All it does here is copy raw
      // samples out — no DSP on the audio thread — so the modern alternative
      // would buy nothing today.
      this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => this.onAudio(event);

      this.sourceNode.connect(this.processor);
      // Must terminate somewhere for the graph to pull data. Destination is
      // safe: the node emits nothing, so this does not echo the mic.
      this.processor.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('[NADA][local-speech] Audio graph failed:', e);
      this.stop();
      onError?.('audio-capture');
    }
  }

  private onAudio(event: AudioProcessingEvent) {
    if (!this.running) return;

    const input = event.inputBuffer.getChannelData(0);
    const level = rms(input);

    // Drive the "we can hear you now" indicator off real audio level, so it
    // stays truthful rather than optimistic while a chunk is being processed.
    const nowSpeaking = level > SILENCE_RMS;
    if (nowSpeaking !== this.speaking) {
      this.speaking = nowSpeaking;
      this.activityCallback?.(nowSpeaking);
    }

    // Copy: the event buffer is reused by the audio thread.
    this.buffer.push(new Float32Array(input));
    this.bufferedSamples += input.length;

    while (this.bufferedSamples > MAX_BUFFERED_SAMPLES && this.buffer.length > 1) {
      const dropped = this.buffer.shift();
      this.bufferedSamples -= dropped?.length ?? 0;
    }

    if (this.bufferedSamples >= CHUNK_SAMPLES && !this.transcribing) {
      void this.flushChunk(event.inputBuffer.sampleRate);
    }
  }

  private async flushChunk(sampleRate: number) {
    if (this.transcribing || !this.running) return;
    this.transcribing = true;

    try {
      const chunk = new Float32Array(this.bufferedSamples);
      let offset = 0;
      for (const part of this.buffer) {
        chunk.set(part, offset);
        offset += part.length;
      }
      this.buffer = [];
      this.bufferedSamples = 0;

      if (rms(chunk) < SILENCE_RMS) return; // silence — skip, see SILENCE_RMS

      const audio = resampleTo16k(chunk, sampleRate);
      const asr = transcriber;
      if (!asr || !this.running) return;

      const result = await asr(audio, {
        language: this.lang.startsWith('en') ? 'english' : 'spanish',
        task: 'transcribe',
      });

      if (!this.running) return;
      const text = (result?.text ?? '').trim();
      // Whisper emits bracketed non-speech markers like "[Música]" on
      // ambiguous audio — never surface those as things the user said.
      if (text && !/^[[(].*[\])]$/.test(text)) {
        this.callback?.(text, true);
      }
    } catch (e) {
      console.warn('[NADA][local-speech] Transcription failed:', e);
    } finally {
      this.transcribing = false;
    }
  }

  stop() {
    this.running = false;

    this.processor?.disconnect();
    this.sourceNode?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor = null;
    this.sourceNode = null;

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    this.buffer = [];
    this.bufferedSamples = 0;
    this.transcribing = false;

    this.activityCallback?.(false);
    this.callback = null;
    this.activityCallback = null;
    this.statusCallback = null;
  }

  isRunning() {
    return this.running;
  }
}

export const localSpeechService = new LocalSpeechService();
