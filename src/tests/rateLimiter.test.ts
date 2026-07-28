import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '@/services/aiProviders/rateLimiter';

/**
 * The limiter exists so a spent free tier never turns into a silent 429 that
 * degrades every verdict to local-only while the UI still says "protegido".
 */
describe('RateLimiter', () => {
  let now = Date.UTC(2026, 6, 23, 12, 0, 0);
  const clock = () => now;

  beforeEach(() => {
    localStorage.clear();
    now = Date.UTC(2026, 6, 23, 12, 0, 0);
  });

  const make = (key: string, rpm = 3, rpd = 5) => new RateLimiter(key, { rpm, rpd }, clock);

  it('allows requests up to the per-minute limit', () => {
    const l = make('t1');
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(false); // 4th in the same minute
  });

  it('frees allowance once the minute window slides', () => {
    const l = make('t2');
    l.tryAcquire();
    l.tryAcquire();
    l.tryAcquire();
    expect(l.canRequest()).toBe(false);

    now += 61_000;
    expect(l.canRequest()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
  });

  it('enforces the daily limit independently of the minute window', () => {
    const l = make('t3', 3, 5);

    // Spread across minutes so only the daily cap can bite.
    for (let i = 0; i < 5; i++) {
      expect(l.tryAcquire()).toBe(true);
      now += 61_000;
    }

    expect(l.canRequest()).toBe(false); // daily cap reached
  });

  it('resets the daily counter on the next UTC day', () => {
    const l = make('t4', 3, 2);
    l.tryAcquire();
    l.tryAcquire();
    expect(l.canRequest()).toBe(false);

    now += 24 * 60 * 60 * 1000; // next day
    expect(l.canRequest()).toBe(true);
  });

  it('reports how long to wait when the minute window is full', () => {
    const l = make('t5', 2, 100);
    l.tryAcquire();
    l.tryAcquire();

    const wait = l.retryAfterMs();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60_000);
  });

  it('reports 0 wait while allowance remains', () => {
    const l = make('t6');
    expect(l.retryAfterMs()).toBe(0);
  });

  /** A daily cap that resets on page reload is not a cap. */
  it('persists the daily count across instances', () => {
    const first = make('shared', 10, 3);
    first.tryAcquire();
    first.tryAcquire();

    const second = make('shared', 10, 3);
    expect(second.snapshot().dayRemaining).toBe(1);
    expect(second.tryAcquire()).toBe(true);
    expect(second.canRequest()).toBe(false);
  });

  it('exposes remaining allowance for display', () => {
    const l = make('t7', 5, 20);
    l.tryAcquire();
    l.tryAcquire();

    const snap = l.snapshot();
    expect(snap.minuteRemaining).toBe(3);
    expect(snap.dayRemaining).toBe(18);
    expect(snap.limits).toEqual({ rpm: 5, rpd: 20 });
  });

  it('reset clears all accounting', () => {
    const l = make('t8', 2, 2);
    l.tryAcquire();
    l.tryAcquire();
    expect(l.canRequest()).toBe(false);

    l.reset();
    expect(l.canRequest()).toBe(true);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('nada-quota:broken', '{not json');
    const l = make('broken');
    expect(l.canRequest()).toBe(true);
  });
});
