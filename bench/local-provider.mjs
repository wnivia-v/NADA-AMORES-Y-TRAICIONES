// =============================================================================
// Measures the local (on-device) provider against the labeled corpus.
//
// This answers the only question that matters about the free, keyless path:
// does it actually catch scams, or is it decoration?
//
// Method: leave-one-out. Each case is classified using every OTHER case as the
// reference corpus, so a case is never matched against itself. That is the
// honest way to evaluate a nearest-neighbour classifier — evaluating with the
// case still in the corpus would report ~100% and mean nothing.
//
// Usage: node bench/local-provider.mjs
// First run downloads ~120MB of model weights, then caches them.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Must mirror src/services/aiProviders/localProvider.ts
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const K = 7;
const MIN_SIMILARITY = 0.45;
const TEMPERATURE = 0.1;
const MIN_CONFIDENCE = 0.6;
const SCORE_FOR = { SEGURO: 10, SOSPECHOSO: 55, PELIGROSO: 88 };

const corpus = JSON.parse(readFileSync(resolve(ROOT, 'src/data/scam-corpus.json'), 'utf8'));
const cases = corpus.cases.filter((c) => c.text && c.label);

console.log(`Corpus: ${cases.length} cases`);
console.log(`Model:  ${MODEL_ID}\nLoading (first run downloads weights)...\n`);

const { pipeline } = await import('@huggingface/transformers');
const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });

const embed = async (text) => {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return out.data;
};

const t0 = Date.now();
const vectors = [];
for (const c of cases) vectors.push(await embed(c.text));
const embedMs = Date.now() - t0;

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
  return dot;
}

// ── Leave-one-out evaluation ─────────────────────────────────────────────────
const predictions = [];
const latencies = [];

for (let i = 0; i < cases.length; i++) {
  const started = Date.now();

  const neighbours = cases
    .map((c, j) => ({ case: c, similarity: j === i ? -1 : cosine(vectors[i], vectors[j]) }))
    .filter((n) => n.similarity >= 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, K);

  latencies.push(Date.now() - started);

  const best = neighbours[0];
  if (!best || best.similarity < MIN_SIMILARITY) {
    predictions.push({ case: cases[i], predicted: null, similarity: best?.similarity ?? 0, reason: 'similarity' });
    continue;
  }

  // Softmax-sharpened per-class vote (mirrors the shipped classifier).
  const weights = new Map();
  let total = 0;
  for (const n of neighbours) {
    const w = Math.exp((n.similarity - best.similarity) / TEMPERATURE);
    weights.set(n.case.label, (weights.get(n.case.label) ?? 0) + w);
    total += w;
  }

  let verdict = 'SEGURO';
  let winning = -1;
  for (const [label, w] of weights) {
    if (w > winning) {
      winning = w;
      verdict = label;
    }
  }
  const confidence = total > 0 ? winning / total : 0;

  if (confidence < MIN_CONFIDENCE) {
    predictions.push({
      case: cases[i],
      predicted: null,
      similarity: best.similarity,
      nearest: best.case,
      reason: 'confidence',
      confidence,
    });
    continue;
  }

  predictions.push({
    case: cases[i],
    predicted: verdict,
    score: SCORE_FOR[verdict],
    confidence,
    similarity: best.similarity,
    nearest: best.case,
  });
}

// ── Metrics ──────────────────────────────────────────────────────────────────
const LABELS = ['SEGURO', 'SOSPECHOSO', 'PELIGROSO'];
const isThreat = (v) => v === 'SOSPECHOSO' || v === 'PELIGROSO';

const declined = predictions.filter((p) => p.predicted === null);
const answered = predictions.filter((p) => p.predicted !== null);

const exact = answered.filter((p) => p.predicted === p.case.label).length;

// The metric that matters most: a dangerous message called safe.
const severeMisses = answered.filter((p) => p.case.label === 'PELIGROSO' && p.predicted === 'SEGURO');
const threatRecallDen = answered.filter((p) => isThreat(p.case.label));
const threatRecallNum = threatRecallDen.filter((p) => isThreat(p.predicted));
const falseAlarmDen = answered.filter((p) => p.case.label === 'SEGURO');
const falseAlarms = falseAlarmDen.filter((p) => isThreat(p.predicted));

const pct = (n, d) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);

console.log('=== Confusion matrix (rows = expected, cols = predicted) ===\n');
console.log(['expected'.padEnd(12), ...LABELS.map((l) => l.padStart(11)), 'declined'.padStart(10)].join(''));
for (const expected of LABELS) {
  const row = predictions.filter((p) => p.case.label === expected);
  const cells = LABELS.map((pred) => String(row.filter((p) => p.predicted === pred).length).padStart(11));
  const dec = String(row.filter((p) => p.predicted === null).length).padStart(10);
  console.log([expected.padEnd(12), ...cells, dec].join(''));
}

console.log('\n=== Headline ===\n');
console.log(`Answered                 ${answered.length}/${predictions.length} (declined ${declined.length}, below similarity floor)`);
console.log(`Exact-label accuracy     ${pct(exact, answered.length)}`);
console.log(`Threat recall            ${pct(threatRecallNum.length, threatRecallDen.length)}  <- flags a real threat as a threat`);
console.log(`False-alarm rate         ${pct(falseAlarms.length, falseAlarmDen.length)}  <- safe text wrongly flagged`);
console.log(`SEVERE misses            ${severeMisses.length}  <- PELIGROSO called SEGURO`);

const sorted = [...latencies].sort((a, b) => a - b);
console.log(`\nEmbedding of ${cases.length} cases: ${embedMs}ms total (${Math.round(embedMs / cases.length)}ms/case)`);
console.log(`Classification p50: ${sorted[Math.floor(sorted.length * 0.5)]}ms, p95: ${sorted[Math.floor(sorted.length * 0.95)]}ms`);

if (severeMisses.length) {
  console.log('\n=== SEVERE misses (fix these first) ===');
  for (const m of severeMisses) {
    console.log(`\n[${m.case.id}] ${m.case.category}  score=${m.score}`);
    console.log(`  text:    ${m.case.text.slice(0, 110)}`);
    console.log(`  nearest: [${m.nearest.label}] ${m.nearest.category} (${(m.similarity * 100).toFixed(0)}%)`);
  }
}

if (falseAlarms.length) {
  console.log('\n=== False alarms ===');
  for (const f of falseAlarms) {
    console.log(`\n[${f.case.id}] predicted ${f.predicted} score=${f.score}`);
    console.log(`  text:    ${f.case.text.slice(0, 110)}`);
    console.log(`  nearest: [${f.nearest.label}] ${f.nearest.category} (${(f.similarity * 100).toFixed(0)}%)`);
  }
}

if (declined.length) {
  console.log('\n=== Declined (falls through to regex / cloud) ===');
  for (const d of declined) {
    const why = d.reason === 'similarity' ? 'no similar case' : 'split vote';
    console.log(`  [${d.case.id}] ${d.case.label.padEnd(10)} ${why.padEnd(15)} best=${(d.similarity * 100).toFixed(0)}% :: ${d.case.text.slice(0, 60)}`);
  }
}

console.log(`\nCaveat: ${cases.length} cases is a signal, not proof. Grow the corpus with real reports.`);
