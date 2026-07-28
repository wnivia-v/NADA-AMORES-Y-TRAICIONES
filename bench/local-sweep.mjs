// =============================================================================
// Parameter sweep for the local provider's classifier.
//
// The first measurement showed 62.5% false alarms: every wrong answer landed in
// the 41-55 score band, just above the SOSPECHOSO threshold. That is the
// signature of averaging — a similarity-weighted mean of label scores pulls
// every input toward the mean of the corpus, and this corpus leans toward
// threats (15 PELIGROSO / 8 SOSPECHOSO / 10 SEGURO).
//
// This sweep compares aggregation strategies and thresholds on the same
// leave-one-out split so the choice is made on evidence, not intuition.
//
// Usage: node bench/local-sweep.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const SCORE_FOR = { SEGURO: 10, SOSPECHOSO: 55, PELIGROSO: 88 };

const corpus = JSON.parse(readFileSync(resolve(ROOT, 'src/data/scam-corpus.json'), 'utf8'));
const cases = corpus.cases.filter((c) => c.text && c.label);

const { pipeline } = await import('@huggingface/transformers');
const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
const embed = async (t) => (await extractor(t, { pooling: 'mean', normalize: true })).data;

const vectors = [];
for (const c of cases) vectors.push(await embed(c.text));

const cosine = (a, b) => {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += a[i] * b[i];
  return d;
};

// Precompute the neighbour list for every case once.
const neighbourLists = cases.map((_, i) =>
  cases
    .map((c, j) => ({ label: c.label, similarity: j === i ? -1 : cosine(vectors[i], vectors[j]) }))
    .filter((n) => n.similarity >= 0)
    .sort((a, b) => b.similarity - a.similarity),
);

const verdictForScore = (s) => (s >= 70 ? 'PELIGROSO' : s >= 40 ? 'SOSPECHOSO' : 'SEGURO');
const isThreat = (v) => v === 'SOSPECHOSO' || v === 'PELIGROSO';

/** Similarity-weighted mean of label scores (the original approach). */
function aggWeightedMean(neighbours) {
  let w = 0;
  let s = 0;
  for (const n of neighbours) {
    const weight = Math.max(0, n.similarity);
    w += weight;
    s += SCORE_FOR[n.label] * weight;
  }
  return { verdict: verdictForScore(w ? s / w : 0), confidence: 1 };
}

/**
 * Softmax-sharpened per-class vote. Temperature controls how much the nearest
 * neighbour dominates; argmax picks a class instead of blending toward the mean.
 */
function aggSoftmaxVote(neighbours, temperature) {
  const top = neighbours[0].similarity;
  const weights = {};
  let total = 0;
  for (const n of neighbours) {
    const w = Math.exp((n.similarity - top) / temperature);
    weights[n.label] = (weights[n.label] ?? 0) + w;
    total += w;
  }
  let bestLabel = 'SEGURO';
  let bestWeight = -1;
  for (const [label, w] of Object.entries(weights)) {
    if (w > bestWeight) {
      bestWeight = w;
      bestLabel = label;
    }
  }
  return { verdict: bestLabel, confidence: total ? bestWeight / total : 0 };
}

function evaluate({ agg, temperature, minSim, k, minConfidence }) {
  let answered = 0;
  let exact = 0;
  let declined = 0;
  let threatDen = 0;
  let threatNum = 0;
  let safeDen = 0;
  let falseAlarm = 0;
  let severe = 0;

  for (let i = 0; i < cases.length; i++) {
    const expected = cases[i].label;
    const neighbours = neighbourLists[i].slice(0, k);
    const best = neighbours[0];

    if (!best || best.similarity < minSim) {
      declined++;
      continue;
    }

    const { verdict, confidence } =
      agg === 'mean' ? aggWeightedMean(neighbours) : aggSoftmaxVote(neighbours, temperature);

    if (confidence < minConfidence) {
      declined++;
      continue;
    }

    answered++;
    if (verdict === expected) exact++;
    if (isThreat(expected)) {
      threatDen++;
      if (isThreat(verdict)) threatNum++;
    }
    if (expected === 'SEGURO') {
      safeDen++;
      if (isThreat(verdict)) falseAlarm++;
    }
    if (expected === 'PELIGROSO' && verdict === 'SEGURO') severe++;
  }

  return {
    answered,
    declined,
    exact: answered ? exact / answered : 0,
    threatRecall: threatDen ? threatNum / threatDen : 0,
    falseAlarm: safeDen ? falseAlarm / safeDen : 0,
    severe,
  };
}

const configs = [];
for (const minSim of [0.45, 0.5, 0.55, 0.6, 0.65]) {
  for (const k of [3, 5, 7]) {
    configs.push({ agg: 'mean', temperature: 0, minSim, k, minConfidence: 0 });
    for (const temperature of [0.02, 0.05, 0.1]) {
      for (const minConfidence of [0, 0.5, 0.6]) {
        configs.push({ agg: 'softmax', temperature, minSim, k, minConfidence });
      }
    }
  }
}

const rows = configs.map((c) => ({ ...c, ...evaluate(c) }));

const pct = (v) => `${(v * 100).toFixed(0)}%`;
const fmt = (r) =>
  [
    r.agg === 'mean' ? 'mean    ' : `soft T=${r.temperature.toFixed(2)}`,
    `sim>=${r.minSim.toFixed(2)}`,
    `k=${r.k}`,
    `conf>=${r.minConfidence.toFixed(1)}`,
    `ans=${String(r.answered).padStart(2)}`,
    `exact=${pct(r.exact).padStart(4)}`,
    `recall=${pct(r.threatRecall).padStart(4)}`,
    `falseAlarm=${pct(r.falseAlarm).padStart(4)}`,
    `severe=${r.severe}`,
  ].join('  ');

// Rank: no severe misses first, then low false alarms, then high recall.
const viable = rows
  .filter((r) => r.severe === 0 && r.answered >= 10)
  .sort((a, b) => a.falseAlarm - b.falseAlarm || b.threatRecall - a.threatRecall || b.exact - a.exact);

console.log('=== Top configs with ZERO severe misses (PELIGROSO never called SEGURO) ===\n');
for (const r of viable.slice(0, 12)) console.log(fmt(r));

console.log('\n=== Best exact accuracy overall ===\n');
for (const r of [...rows].sort((a, b) => b.exact - a.exact).slice(0, 8)) console.log(fmt(r));

console.log('\n=== Current shipped config for reference ===\n');
console.log(fmt({ ...rows.find((r) => r.agg === 'mean' && r.minSim === 0.45 && r.k === 5) }));
