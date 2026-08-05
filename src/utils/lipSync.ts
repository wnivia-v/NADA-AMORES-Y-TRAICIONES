// =============================================================================
// Lip-Sync Correlation — pure math, no DOM/browser APIs
// Used by visionService to turn mouth-movement + audio-energy samples into a
// real lip-sync score, replacing the previous hardcoded placeholder (0.9).
// =============================================================================

/** Root-mean-square amplitude of a time-domain audio byte buffer, 0-1. */
export function rms(byteTimeDomain: Uint8Array): number {
  if (byteTimeDomain.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < byteTimeDomain.length; i++) {
    const v = (byteTimeDomain[i]! - 128) / 128;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / byteTimeDomain.length);
}

/**
 * Pearson correlation between two equal-length series, using the last N
 * samples where N is the shorter of the two. Returns null when there are too
 * few samples or either series has ~no variance — a flat mouth or a flat
 * audio signal (e.g. nobody is talking right now) gives no evidence of sync
 * OR desync, so it must not be scored as either.
 */
export function correlate(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;

  const xsT = xs.slice(-n);
  const ysT = ys.slice(-n);
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mx = mean(xsT);
  const my = mean(ysT);

  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xsT[i]! - mx;
    const dy = ysT[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const NO_VARIANCE_EPS = 1e-6;
  if (dx2 < NO_VARIANCE_EPS || dy2 < NO_VARIANCE_EPS) return null;

  return num / Math.sqrt(dx2 * dy2);
}

export interface LipSyncEstimate {
  /** 0-1, higher = better synced. Only meaningful when `measured` is true. */
  score: number;
  /** False when there wasn't enough signal (no audio, or nothing moving/sounding) to judge. */
  measured: boolean;
}

/**
 * Maps a mouth/audio correlation coefficient to a 0-1 lip-sync score.
 * Real speech correlates mouth-opening with audio energy, but noisily — a
 * mid-range positive correlation is normal, not just a perfect one. No
 * correlation available (null) maps to a neutral score explicitly marked as
 * unmeasured, so callers don't treat "we couldn't check" as "it's fine".
 */
export function lipSyncScoreFromCorrelation(corr: number | null): LipSyncEstimate {
  if (corr === null) return { score: 0.75, measured: false };
  return { score: Math.min(1, Math.max(0, (corr + 1) / 2)), measured: true };
}
