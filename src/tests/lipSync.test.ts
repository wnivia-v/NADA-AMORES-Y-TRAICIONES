import { describe, it, expect } from 'vitest';
import { rms, correlate, lipSyncScoreFromCorrelation } from '@/utils/lipSync';

describe('rms', () => {
  it('returns 0 for silence (all samples at the 128 midpoint)', () => {
    expect(rms(new Uint8Array(64).fill(128))).toBe(0);
  });

  it('returns ~1 for a full-scale square wave', () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 255 : 0;
    expect(rms(buf)).toBeGreaterThan(0.95);
  });

  it('handles an empty buffer without dividing by zero', () => {
    expect(rms(new Uint8Array(0))).toBe(0);
  });
});

describe('correlate', () => {
  it('returns null with fewer than 5 samples', () => {
    expect(correlate([1, 2, 3], [1, 2, 3])).toBeNull();
  });

  it('returns null when one series is flat (no variance to judge)', () => {
    expect(correlate([1, 1, 1, 1, 1, 1], [1, 5, 2, 8, 3, 9])).toBeNull();
  });

  it('returns close to 1 for perfectly correlated series', () => {
    const corr = correlate([1, 2, 3, 4, 5, 6], [10, 20, 30, 40, 50, 60]);
    expect(corr).not.toBeNull();
    expect(corr!).toBeGreaterThan(0.99);
  });

  it('returns close to -1 for perfectly anti-correlated series', () => {
    const corr = correlate([1, 2, 3, 4, 5, 6], [60, 50, 40, 30, 20, 10]);
    expect(corr).not.toBeNull();
    expect(corr!).toBeLessThan(-0.99);
  });

  it('uses only the last N samples when series differ in length', () => {
    const xs = [1, 1, 1, 1, 1, 2, 4, 6, 8, 10];
    const ys = [9, 9, 9, 20, 40, 60, 80, 100];
    // Should not throw and should return a value in [-1, 1]
    const corr = correlate(xs, ys);
    expect(corr).not.toBeNull();
    expect(corr!).toBeGreaterThanOrEqual(-1);
    expect(corr!).toBeLessThanOrEqual(1);
  });
});

describe('lipSyncScoreFromCorrelation', () => {
  it('marks null correlation as unmeasured with a neutral score', () => {
    const result = lipSyncScoreFromCorrelation(null);
    expect(result.measured).toBe(false);
    expect(result.score).toBe(0.75);
  });

  it('maps perfect correlation (1) to a score of 1', () => {
    const result = lipSyncScoreFromCorrelation(1);
    expect(result.measured).toBe(true);
    expect(result.score).toBe(1);
  });

  it('maps zero correlation to a score of 0.5', () => {
    const result = lipSyncScoreFromCorrelation(0);
    expect(result.measured).toBe(true);
    expect(result.score).toBe(0.5);
  });

  it('maps perfect anti-correlation (-1) to a score of 0', () => {
    const result = lipSyncScoreFromCorrelation(-1);
    expect(result.measured).toBe(true);
    expect(result.score).toBe(0);
  });
});
