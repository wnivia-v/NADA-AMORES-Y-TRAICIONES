import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable AI provider: resolves after a delay so we can interleave calls.
let aiDelayMs = 60;
const aiResult: unknown = {
  type: 'llm-risk',
  value: 10,
  confidence: 0.9,
  timestamp: Date.now(),
  tactics: [],
  explanation: 'ok',
  recommendations: [],
};

vi.mock('@/services/aiProviders', () => ({
  orchestrateAnalysis: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, aiDelayMs));
    return { result: aiResult, providerId: 'gemini' };
  }),
}));

vi.mock('@/services/safeBrowsingService', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true, threats: [] }),
}));

vi.mock('@/services/scamDatabase', () => ({
  scamDatabase: {
    lookup: vi.fn().mockResolvedValue({ found: false }),
    store: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  analyzeText,
  analyzeVoiceFragment,
  cancelAnalysis,
  isAnalysisAborted,
  AnalysisAbortedError,
} from '@/services/geminiService';
import { clearAllLanes } from '@/shared/risk';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/**
 * Regression suite for the shared-AbortController bug.
 *
 * One module-level controller used to be aborted by every caller on entry, so
 * the clipboard shield, the screen OCR loop, the 15s voice loop and the UI all
 * cancelled each other. Worse, the cancelled run returned a local-only verdict
 * instead of failing, so a user could be shown "SEGURO" for text that was
 * never actually sent to the AI.
 */
describe('analysis scoping', () => {
  beforeEach(() => {
    aiDelayMs = 60;
    clearAllLanes();
    (['ui', 'clipboard', 'screen', 'voice'] as const).forEach(cancelAnalysis);
  });

  it('lets different lanes run concurrently without cancelling each other', async () => {
    const clipboard = analyzeText('texto del portapapeles para analizar', 'clipboard');
    const screen = analyzeText('texto capturado de la pantalla', 'screen');
    const ui = analyzeText('texto pegado por la usuaria', 'ui');

    const results = await Promise.all([clipboard, screen, ui]);

    // All three completed, and all three reached the AI (hybrid), meaning none
    // was downgraded to a local-only verdict by a sibling lane.
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.scanSource).toBe('hybrid');
    }
  });

  it('cancels only the previous run in the same lane', async () => {
    const first = analyzeText('primer texto sospechoso del portapapeles', 'clipboard');
    await tick();
    const second = analyzeText('segundo texto sospechoso del portapapeles', 'clipboard');

    await expect(first).rejects.toBeInstanceOf(AnalysisAbortedError);
    await expect(second).resolves.toMatchObject({ scanSource: 'hybrid' });
  });

  it('reports a superseded run as aborted rather than as a safe verdict', async () => {
    const first = analyzeText('mensaje que sera reemplazado', 'ui');
    await tick();
    void analyzeText('mensaje mas reciente', 'ui').catch(() => undefined);

    const error = await first.catch((e) => e);

    expect(isAnalysisAborted(error)).toBe(true);
    expect((error as AnalysisAbortedError).scope).toBe('ui');
    // Critically, it is NOT a resolved analysis object.
    expect(error).not.toHaveProperty('verdict');
  });

  it('isAnalysisAborted distinguishes real failures from cancellations', () => {
    expect(isAnalysisAborted(new AnalysisAbortedError('screen'))).toBe(true);
    expect(isAnalysisAborted(new Error('network down'))).toBe(false);
    expect(isAnalysisAborted(null)).toBe(false);
  });

  it('cancelAnalysis aborts in-flight work in a lane', async () => {
    const pending = analyzeText('analisis que sera cancelado por stop()', 'screen');
    await tick();
    cancelAnalysis('screen');

    await expect(pending).rejects.toBeInstanceOf(AnalysisAbortedError);
  });

  it('cancelling one lane leaves the others running', async () => {
    const clipboard = analyzeText('texto del portapapeles', 'clipboard');
    const voice = analyzeVoiceFragment('fragmento corto de la llamada', 'voice');
    await tick();

    cancelAnalysis('clipboard');

    await expect(clipboard).rejects.toBeInstanceOf(AnalysisAbortedError);
    await expect(voice).resolves.toMatchObject({ scanSource: 'hybrid' });
  });

  it('routes long transcripts through the text pipeline under the same lane', async () => {
    const long = 'hola '.repeat(60); // >= 200 chars
    const first = analyzeVoiceFragment(long, 'voice');
    await tick();
    const second = analyzeVoiceFragment('fragmento nuevo', 'voice');

    // The long transcript delegates to analyzeText but must keep the voice lane,
    // so a newer voice fragment still supersedes it.
    await expect(first).rejects.toBeInstanceOf(AnalysisAbortedError);
    await expect(second).resolves.toBeDefined();
  });
});
