// =============================================================================
// Rate Limiter — keeps NADA inside free-tier quotas
//
// Free tiers are the whole point of this app being usable without paying, but
// they are enforced by request count, not by good intentions. NADA's background
// shields poll on timers, so without a guard the worst case exceeds the Gemini
// free tier (~15 requests/minute) on its own: the clipboard lane plus the screen
// OCR lane can both fire repeatedly.
//
// Exceeding the quota returns HTTP 429, which the providers swallow and turn
// into `null` — and a null AI result silently degrades the verdict to
// local-only. The user would still see "protegido" while the AI layer was
// effectively switched off. That is exactly the failure mode this project
// treats as the worst one, so quota is tracked explicitly instead.
//
// Requests-per-day is persisted: a daily cap that resets on page reload is not
// a cap at all.
// =============================================================================

export interface RateLimits {
  /** Requests per rolling 60s window. */
  rpm: number;
  /** Requests per calendar day (UTC). */
  rpd: number;
}

export interface RateLimitState {
  /** Timestamps (ms) of requests inside the current minute window. */
  recent: number[];
  /** UTC day key the daily counter belongs to. */
  day: string;
  /** Requests already spent today. */
  spentToday: number;
}

const STORAGE_PREFIX = 'nada-quota:';

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

export class RateLimiter {
  private readonly key: string;
  private readonly limits: RateLimits;
  private readonly now: () => number;
  private state: RateLimitState;

  constructor(key: string, limits: RateLimits, now: () => number = Date.now) {
    this.key = key;
    this.limits = limits;
    this.now = now;
    this.state = this.load();
  }

  /** True when at least one request is available right now. */
  canRequest(): boolean {
    this.prune();
    return this.state.recent.length < this.limits.rpm && this.state.spentToday < this.limits.rpd;
  }

  /**
   * Consumes one request if available.
   * Returns false instead of throwing so callers can skip a provider cleanly.
   */
  tryAcquire(): boolean {
    if (!this.canRequest()) return false;
    const t = this.now();
    this.state.recent.push(t);
    this.state.spentToday += 1;
    this.persist();
    return true;
  }

  /** Milliseconds until the next request becomes available, 0 if available now. */
  retryAfterMs(): number {
    this.prune();

    if (this.state.spentToday >= this.limits.rpd) {
      // Next UTC midnight
      const d = new Date(this.now());
      const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      return Math.max(0, midnight - this.now());
    }

    if (this.state.recent.length >= this.limits.rpm) {
      const oldest = this.state.recent[0] ?? this.now();
      return Math.max(0, oldest + 60_000 - this.now());
    }

    return 0;
  }

  /** Remaining allowance, for display and diagnostics. */
  snapshot(): { minuteRemaining: number; dayRemaining: number; limits: RateLimits } {
    this.prune();
    return {
      minuteRemaining: Math.max(0, this.limits.rpm - this.state.recent.length),
      dayRemaining: Math.max(0, this.limits.rpd - this.state.spentToday),
      limits: this.limits,
    };
  }

  reset() {
    this.state = { recent: [], day: dayKey(this.now()), spentToday: 0 };
    this.persist();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private prune() {
    const t = this.now();
    const cutoff = t - 60_000;
    if (this.state.recent.length) {
      this.state.recent = this.state.recent.filter((ts) => ts > cutoff);
    }

    const today = dayKey(t);
    if (this.state.day !== today) {
      this.state.day = today;
      this.state.spentToday = 0;
      this.persist();
    }
  }

  private load(): RateLimitState {
    const fresh: RateLimitState = { recent: [], day: dayKey(this.now()), spentToday: 0 };
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + this.key);
      if (!raw) return fresh;
      const parsed = JSON.parse(raw) as Partial<RateLimitState>;
      return {
        recent: Array.isArray(parsed.recent) ? parsed.recent.filter((n) => typeof n === 'number') : [],
        day: typeof parsed.day === 'string' ? parsed.day : fresh.day,
        spentToday: typeof parsed.spentToday === 'number' ? parsed.spentToday : 0,
      };
    } catch {
      return fresh;
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_PREFIX + this.key, JSON.stringify(this.state));
    } catch {
      // Storage unavailable (private mode, quota) — limiter still works in memory.
    }
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

const limiters = new Map<string, RateLimiter>();

export function getRateLimiter(key: string, limits: RateLimits): RateLimiter {
  const existing = limiters.get(key);
  if (existing) return existing;
  const created = new RateLimiter(key, limits);
  limiters.set(key, created);
  return created;
}

/** Test helper: drops cached limiters so a fresh clock/limits can be used. */
export function clearRateLimiters() {
  limiters.clear();
}
