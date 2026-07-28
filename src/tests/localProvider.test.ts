import { describe, it, expect } from 'vitest';
import { classifyFromNeighbours } from '@/services/aiProviders/localProvider';
import { localProvider } from '@/services/aiProviders/localProvider';

type Verdict = 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';

const n = (label: Verdict, similarity: number, category = 'test') => ({
  case: { id: `${label}-${similarity}`, label, category, text: 'x' },
  similarity,
});

/**
 * The local provider is the layer that works with no key, no account and no
 * network. Its contract is: answer confidently or decline. Declining is a
 * feature — the orchestrator then falls through to the regex layer or a cloud
 * provider, which is far better than emitting a confident wrong verdict.
 *
 * Measured behaviour on the labeled corpus (leave-one-out, bench/local-provider.mjs):
 * 87.5% exact accuracy, 100% threat recall, 0% false alarms, 0 severe misses,
 * answering 16 of 33 cases.
 */
describe('localProvider.classifyFromNeighbours', () => {
  it('declines when there are no neighbours', () => {
    expect(classifyFromNeighbours([])).toBeNull();
  });

  it('declines when nothing is similar enough', () => {
    // Below the 0.45 similarity floor: not really about the same thing.
    expect(classifyFromNeighbours([n('PELIGROSO', 0.3), n('PELIGROSO', 0.2)])).toBeNull();
  });

  it('declines on a split neighbourhood instead of picking a side', () => {
    // Near-identical similarities across opposing labels -> no clear winner.
    const result = classifyFromNeighbours([
      n('PELIGROSO', 0.62),
      n('SEGURO', 0.62),
      n('SEGURO', 0.61),
      n('PELIGROSO', 0.61),
    ]);
    expect(result).toBeNull();
  });

  it('classifies a clear dangerous neighbourhood', () => {
    const result = classifyFromNeighbours([
      n('PELIGROSO', 0.9, 'romance-dinero'),
      n('PELIGROSO', 0.85, 'romance-dinero'),
      n('PELIGROSO', 0.8, 'emergencia-falsa'),
    ]);

    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('PELIGROSO');
    expect(result!.riskScore).toBeGreaterThanOrEqual(70);
    expect(result!.tactics).toContain('romance-dinero');
  });

  it('classifies a clear safe neighbourhood', () => {
    const result = classifyFromNeighbours([
      n('SEGURO', 0.9),
      n('SEGURO', 0.88),
      n('SEGURO', 0.85),
    ]);

    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('SEGURO');
    expect(result!.riskScore).toBeLessThan(40);
  });

  it('never attaches threat tactics to a safe verdict', () => {
    const result = classifyFromNeighbours([
      n('SEGURO', 0.9),
      n('SEGURO', 0.88),
      n('PELIGROSO', 0.5, 'sextorsion'),
    ]);

    expect(result!.verdict).toBe('SEGURO');
    expect(result!.tactics).toEqual([]);
  });

  it('lets a much closer match outweigh several weaker ones', () => {
    // Sharpened weighting is the whole point: a 0.92 match must dominate a
    // cluster of 0.5s. Averaging label scores instead produced a 63% false
    // alarm rate because everything drifted to the middle of the corpus.
    const result = classifyFromNeighbours([
      n('PELIGROSO', 0.92, 'phishing-bancario'),
      n('SEGURO', 0.5),
      n('SEGURO', 0.49),
      n('SEGURO', 0.48),
    ]);

    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('PELIGROSO');
  });

  it('only considers the K nearest neighbours', () => {
    // 1 strong dangerous match plus 20 weak safe ones. The tail beyond K must
    // not be able to outvote the neighbourhood.
    const neighbours = [
      n('PELIGROSO', 0.95, 'sextorsion'),
      ...Array.from({ length: 20 }, (_, i) => n('SEGURO', 0.5 - i * 0.001)),
    ];

    const result = classifyFromNeighbours(neighbours);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('PELIGROSO');
  });

  it('always returns actionable recommendations when it answers', () => {
    const dangerous = classifyFromNeighbours([n('PELIGROSO', 0.9), n('PELIGROSO', 0.88)]);
    expect(dangerous!.recommendations.length).toBeGreaterThan(0);

    const safe = classifyFromNeighbours([n('SEGURO', 0.9), n('SEGURO', 0.88)]);
    expect(safe!.recommendations.length).toBeGreaterThan(0);
  });

  it('explains itself in plain language, naming the matched category', () => {
    const result = classifyFromNeighbours([
      n('PELIGROSO', 0.9, 'suplantacion-familiar'),
      n('PELIGROSO', 0.88, 'suplantacion-familiar'),
    ]);

    expect(result!.explanation).toContain('suplantacion-familiar');
    expect(result!.explanation).not.toMatch(/cosine|embedding|softmax|vector/i);
  });
});

describe('localProvider metadata', () => {
  it('declares itself free and on-device', () => {
    expect(localProvider.id).toBe('local');
    expect(localProvider.cost).toBe('free-local');
  });

  it('has no request quota, because nothing leaves the machine', () => {
    expect(localProvider.limits).toBeUndefined();
  });

  it('is available without any API key configured', () => {
    expect(localProvider.isAvailable()).toBe(true);
  });
});
