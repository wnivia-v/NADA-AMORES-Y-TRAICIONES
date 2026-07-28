import { describe, it, expect, beforeEach } from 'vitest';
import { useNadaStore } from '@/store/useNadaStore';
import type { ScamAnalysis } from '@/store/useNadaStore';

const dangerous: ScamAnalysis = {
  verdict: 'PELIGROSO',
  riskScore: 88,
  tactics: ['Fraude financiero'],
  explanation: 'Solicitud de dinero con urgencia.',
  scanSource: 'hybrid',
  recommendations: ['No envies dinero.'],
};

const safe: ScamAnalysis = {
  verdict: 'SEGURO',
  riskScore: 5,
  tactics: [],
  explanation: 'Sin indicadores.',
  scanSource: 'local',
  recommendations: [],
};

const today = () => new Date().toISOString().slice(0, 10);

function reset() {
  useNadaStore.setState({
    alerts: [],
    logs: [],
    dailyHistory: [],
    historyCount: 0,
    threatsToday: 0,
    analysisResult: null,
  });
}

describe('useNadaStore metrics', () => {
  beforeEach(reset);

  /**
   * Regression: protectionEngine.triggerThreatAlert calls onAlert AND
   * onAnalysisResult for a single detection. Both addAlert and
   * setAnalysisResult used to increment the counters, so every background
   * detection was counted twice in historyCount, threatsToday and the chart.
   */
  it('counts one background detection exactly once', () => {
    const s = useNadaStore.getState();

    // Same order protectionEngine fires them in.
    s.addAlert({
      verdict: 'PELIGROSO',
      riskScore: 88,
      description: 'Texto sospechoso detectado en portapapeles',
      detectedTactic: 'Fraude financiero',
      app: 'Portapapeles',
    });
    s.setAnalysisResult(dangerous);

    const after = useNadaStore.getState();
    expect(after.alerts).toHaveLength(1);
    expect(after.historyCount).toBe(1);
    expect(after.threatsToday).toBe(1);

    const todayRecord = after.dailyHistory.find((r) => r.date === today());
    expect(todayRecord).toEqual({ date: today(), scans: 1, threats: 1 });
  });

  it('addAlert alone does not move the counters', () => {
    useNadaStore.getState().addAlert({
      verdict: 'SOSPECHOSO',
      riskScore: 50,
      description: 'test',
      detectedTactic: null,
      app: 'Pantalla',
    });

    const after = useNadaStore.getState();
    expect(after.alerts).toHaveLength(1);
    expect(after.historyCount).toBe(0);
    expect(after.dailyHistory).toHaveLength(0);
  });

  it('counts a safe scan without counting a threat', () => {
    useNadaStore.getState().setAnalysisResult(safe);

    const after = useNadaStore.getState();
    expect(after.historyCount).toBe(1);
    expect(after.threatsToday).toBe(0);
    expect(after.dailyHistory[0]).toEqual({ date: today(), scans: 1, threats: 0 });
  });

  it('clearing the analysis result does not count as a scan', () => {
    useNadaStore.getState().setAnalysisResult(null);
    expect(useNadaStore.getState().historyCount).toBe(0);
    expect(useNadaStore.getState().dailyHistory).toHaveLength(0);
  });

  it('treats SOSPECHOSO as a threat so the counter matches the chart', () => {
    useNadaStore.getState().setAnalysisResult({ ...safe, verdict: 'SOSPECHOSO', riskScore: 55 });

    const after = useNadaStore.getState();
    expect(after.threatsToday).toBe(1);
    expect(after.dailyHistory[0]?.threats).toBe(1);
  });

  /**
   * Regression: threatsToday was persisted and only ever incremented, so
   * "Amenazas hoy" kept displaying threats from previous days.
   */
  it('derives threatsToday from today only, ignoring older days', () => {
    useNadaStore.setState({
      dailyHistory: [{ date: '2020-01-01', scans: 9, threats: 9 }],
      threatsToday: 9,
      historyCount: 9,
    });

    useNadaStore.getState().setAnalysisResult(safe);

    const after = useNadaStore.getState();
    expect(after.threatsToday).toBe(0); // yesterday's 9 must not leak into today
    expect(after.historyCount).toBe(10); // all-time counter keeps accumulating
  });

  /**
   * Regression: recordDailyScan spread the array but mutated the record object
   * in place, rewriting the previous state snapshot.
   */
  it('does not mutate the previous dailyHistory records', () => {
    useNadaStore.getState().setAnalysisResult(safe);

    const before = useNadaStore.getState().dailyHistory;
    const beforeRecord = before[0];
    const snapshot = { ...beforeRecord! };

    useNadaStore.getState().setAnalysisResult(safe);

    expect(beforeRecord).toEqual(snapshot); // untouched
    expect(useNadaStore.getState().dailyHistory).not.toBe(before);
    expect(useNadaStore.getState().dailyHistory[0]?.scans).toBe(2);
  });

  it('accumulates repeated scans into the same day', () => {
    const s = useNadaStore.getState();
    s.setAnalysisResult(safe);
    s.setAnalysisResult(dangerous);
    s.setAnalysisResult(dangerous);

    const after = useNadaStore.getState();
    expect(after.historyCount).toBe(3);
    expect(after.threatsToday).toBe(2);
    expect(after.dailyHistory).toHaveLength(1);
    expect(after.dailyHistory[0]).toEqual({ date: today(), scans: 3, threats: 2 });
  });

  it('caps the alert history at 100 entries, newest first', () => {
    const s = useNadaStore.getState();
    for (let i = 0; i < 105; i++) {
      s.addAlert({
        verdict: 'SOSPECHOSO',
        riskScore: 50,
        description: `alerta ${i}`,
        detectedTactic: null,
        app: 'Portapapeles',
      });
    }

    const alerts = useNadaStore.getState().alerts;
    expect(alerts).toHaveLength(100);
    expect(alerts[0]?.description).toBe('alerta 104');
  });
});
