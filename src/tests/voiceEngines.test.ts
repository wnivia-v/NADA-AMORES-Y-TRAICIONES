import { describe, it, expect } from 'vitest';
import {
  toVoiceLanguage,
  languageTag,
  whisperLanguage,
  SUPPORTED_VOICE_LANGUAGES,
} from '@/services/voice/types';
import { rms, resampleTo16k, isLikelyHallucination } from '@/services/voice/whisperEngine';

describe('voice language mapping', () => {
  it('maps the app languages to the tag each engine expects', () => {
    expect(languageTag('es')).toBe('es-ES');
    expect(languageTag('en')).toBe('en-US');
    expect(whisperLanguage('es')).toBe('spanish');
    expect(whisperLanguage('en')).toBe('english');
  });

  it('accepts a full BCP-47 tag, not just the short code', () => {
    expect(toVoiceLanguage('es-AR')).toBe('es');
    expect(toVoiceLanguage('en-GB')).toBe('en');
    expect(toVoiceLanguage('PT-br')).toBe('pt');
  });

  it('falls back to Spanish instead of throwing on anything unexpected', () => {
    // Called with whatever the store holds, so it must never be the thing
    // that takes the voice shield down.
    expect(toVoiceLanguage(undefined)).toBe('es');
    expect(toVoiceLanguage(null)).toBe('es');
    expect(toVoiceLanguage('')).toBe('es');
    expect(toVoiceLanguage('klingon')).toBe('es');
  });

  it('has a complete mapping for every supported language', () => {
    expect(SUPPORTED_VOICE_LANGUAGES.length).toBeGreaterThan(1);
    for (const lang of SUPPORTED_VOICE_LANGUAGES) {
      expect(languageTag(lang)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(whisperLanguage(lang)).toMatch(/^[a-z]+$/);
    }
  });
});

/**
 * These guard the audio path into Whisper. Both fail silently when wrong:
 * bad resampling produces confident gibberish rather than an error, and a
 * broken level check either transcribes silent rooms (where Whisper invents
 * filler text) or drops real speech.
 */
describe('whisper audio helpers', () => {
  describe('rms', () => {
    it('is zero for digital silence', () => {
      expect(rms(new Float32Array(1000))).toBe(0);
    });

    it('equals the amplitude of a constant signal', () => {
      expect(rms(new Float32Array(500).fill(0.5))).toBeCloseTo(0.5, 5);
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

    it('downsamples 48kHz (the usual hardware rate) to a third of the samples', () => {
      expect(resampleTo16k(new Float32Array(4800), 48000).length).toBe(1600);
    });

    it('preserves signal shape rather than truncating', () => {
      const input = new Float32Array(1000);
      for (let i = 0; i < input.length; i++) input[i] = i / input.length;

      const out = resampleTo16k(input, 32000);

      expect(out[0]).toBeCloseTo(0, 2);
      expect(out[out.length - 1]).toBeCloseTo(1, 1);
      for (let i = 1; i < out.length; i++) {
        expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
      }
    });

    it('keeps a constant signal constant (no amplitude drift)', () => {
      for (const v of resampleTo16k(new Float32Array(2000).fill(0.25), 44100)) {
        expect(v).toBeCloseTo(0.25, 5);
      }
    });
  });

  describe('isLikelyHallucination', () => {
    it('rejects empty and whitespace-only output', () => {
      expect(isLikelyHallucination('')).toBe(true);
      expect(isLikelyHallucination('   ')).toBe(true);
    });

    it('rejects bracketed non-speech markers', () => {
      expect(isLikelyHallucination('[Música]')).toBe(true);
      expect(isLikelyHallucination('(risas)')).toBe(true);
    });

    it('rejects the stock filler Whisper invents over near-silence', () => {
      expect(isLikelyHallucination('Gracias por ver el video')).toBe(true);
      expect(isLikelyHallucination('Subtitulos realizados por la comunidad de Amara.org')).toBe(true);
      expect(isLikelyHallucination('Thanks for watching!')).toBe(true);
    });

    it('keeps real speech, including phrases the shield exists to catch', () => {
      expect(isLikelyHallucination('mandame la plata ya')).toBe(false);
      expect(isLikelyHallucination('si no pagas voy a publicar tus fotos')).toBe(false);
      expect(isLikelyHallucination('hola, como estas')).toBe(false);
    });

    it('does not reject a sentence merely because it contains brackets', () => {
      // The marker rule must anchor to the whole string, or real speech
      // quoting something would be silently dropped.
      expect(isLikelyHallucination('dijo [textual] que te va a denunciar')).toBe(false);
    });
  });
});
