import { describe, it, expect, beforeEach, vi } from 'vitest';
import { riskScorer } from '@/utils/riskScorer';

describe('RiskScorer', () => {
  beforeEach(() => {
    riskScorer.clear();
  });

  it('returns 0 when no signals exist', () => {
    expect(riskScorer.getCompositeScore()).toBe(0);
  });

  it('returns the score of a single signal', () => {
    riskScorer.addSignal('test', 75);
    const score = riskScorer.getCompositeScore();
    // Should be close to 75 (with minimal decay since it just happened)
    expect(score).toBeGreaterThanOrEqual(70);
    expect(score).toBeLessThanOrEqual(80);
  });

  it('combines multiple signals with weighted average', () => {
    riskScorer.addSignal('local', 60, 1);
    riskScorer.addSignal('ai', 80, 2);
    const score = riskScorer.getCompositeScore();
    // AI has double weight, so should be closer to 80 than 60
    expect(score).toBeGreaterThan(70);
  });

  it('caps score at 100', () => {
    riskScorer.addSignal('a', 100, 5);
    riskScorer.addSignal('b', 100, 5);
    expect(riskScorer.getCompositeScore()).toBeLessThanOrEqual(100);
  });

  it('newer signals contribute more than older ones', () => {
    // Add an old signal by manipulating time
    vi.useFakeTimers();
    const now = Date.now();

    vi.setSystemTime(now - 4 * 60 * 1000); // 4 minutes ago
    riskScorer.addSignal('old', 90, 1);

    vi.setSystemTime(now); // now
    riskScorer.addSignal('new', 30, 1);

    const score = riskScorer.getCompositeScore();
    // The new signal (30) should dominate because old signal decayed
    expect(score).toBeLessThan(60);

    vi.useRealTimers();
  });

  it('getSignalsBySource filters correctly', () => {
    riskScorer.addSignal('local', 50);
    riskScorer.addSignal('ai', 70);
    riskScorer.addSignal('local', 60);

    const localSignals = riskScorer.getSignalsBySource('local');
    expect(localSignals).toHaveLength(2);
  });

  it('clear removes all signals', () => {
    riskScorer.addSignal('test', 80);
    riskScorer.addSignal('test2', 90);
    riskScorer.clear();
    expect(riskScorer.getCompositeScore()).toBe(0);
  });
});
