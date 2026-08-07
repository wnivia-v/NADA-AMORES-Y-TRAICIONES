import { describe, it, expect } from 'vitest';
import { rms, resampleTo16k } from '@/services/localSpeechService';

/**
 * These two functions guard the audio path feeding Whisper. Both fail
 * silently when wrong: bad resampling produces confident gibberish
 * transcriptions rather than an error, and a broken RMS either transcribes
 * every silent room (wasting seconds of CPU on hallucinated filler text) or
 * skips real speech entirely.
 */
describe('rms', () => {
  it('is zero for digital silence', () => {
    expect(rms(new Float32Array(1000))).toBe(0);
  });

  it('is the amplitude for a constant signal', () => {
    const signal = new Float32Array(500).fill(0.5);
    expect(rms(signal)).toBeCloseTo(0.5, 5);
  });

  it('rises with signal level', () => {
    const quiet = new Float32Array(500).fill(0.01);
    const loud = new Float32Array(500).fill(0.4);
    expect(rms(loud)).toBeGreaterThan(rms(quiet));
  });

  it('does not divide by zero on an empty buffer', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('resampleTo16k', () => {
  it('returns the input untouched when already at 16kHz', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleTo16k(input, 16000)).toBe(input);
  });

  it('halves the sample count when downsampling from 32kHz', () => {
    const input = new Float32Array(3200);
    expect(resampleTo16k(input, 32000).length).toBe(1600);
  });

  it('downsamples 48kHz (the common hardware rate) to a third of the samples', () => {
    const input = new Float32Array(4800);
    expect(resampleTo16k(input, 48000).length).toBe(1600);
  });

  it('preserves signal shape rather than just truncating', () => {
    // A ramp resampled to half rate should still be a ramp over the same
    // value range — truncation or index bugs would flatten or clip it.
    const input = new Float32Array(1000);
    for (let i = 0; i < input.length; i++) input[i] = i / input.length;

    const out = resampleTo16k(input, 32000);

    expect(out[0]).toBeCloseTo(0, 2);
    expect(out[out.length - 1]).toBeCloseTo(1, 1);
    // Monotonically increasing, like the source.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
    }
  });

  it('keeps a constant signal constant (no amplitude drift)', () => {
    const input = new Float32Array(2000).fill(0.25);
    const out = resampleTo16k(input, 44100);
    for (const v of out) expect(v).toBeCloseTo(0.25, 5);
  });
});
