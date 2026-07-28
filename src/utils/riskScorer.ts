// =============================================================================
// Risk Scorer — Time-Decay Weighted Real-Time Signal Aggregator
// Combines multiple detection signals into a single risk score
// =============================================================================

interface RiskSignal {
  source: string;
  score: number; // 0-100
  timestamp: number;
  weight: number;
}

class RiskScorer {
  private signals: RiskSignal[] = [];
  private readonly DECAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  addSignal(source: string, score: number, weight = 1) {
    this.signals.push({
      source,
      score: Math.min(100, Math.max(0, score)),
      timestamp: Date.now(),
      weight,
    });
    this.cleanup();
  }

  getCompositeScore(): number {
    if (this.signals.length === 0) return 0;

    const now = Date.now();
    let weightedSum = 0;
    let totalWeight = 0;

    for (const signal of this.signals) {
      const age = now - signal.timestamp;
      // Exponential decay: newer signals count more
      const decay = Math.exp(-age / this.DECAY_WINDOW_MS);
      const effectiveWeight = signal.weight * decay;
      weightedSum += signal.score * effectiveWeight;
      totalWeight += effectiveWeight;
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  getSignalsBySource(source: string): RiskSignal[] {
    return this.signals.filter((s) => s.source === source);
  }

  clear() {
    this.signals = [];
  }

  private cleanup() {
    const cutoff = Date.now() - this.DECAY_WINDOW_MS * 2;
    this.signals = this.signals.filter((s) => s.timestamp > cutoff);
  }
}

export const riskScorer = new RiskScorer();
