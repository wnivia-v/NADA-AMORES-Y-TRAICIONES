import { scanLocalPatterns } from '../src/utils/scamPatterns';
import corpus from '../src/data/scam-corpus.json';

interface Case { id: string; label: string; text: string; category: string; note?: string }
const cases = (corpus.cases as Case[]).filter(c => c.text && c.label);

const verdict = (s: number) => s >= 70 ? 'PELIGROSO' : s >= 40 ? 'SOSPECHOSO' : 'SEGURO';
const isThreat = (v: string) => v !== 'SEGURO';

let exact = 0, severe = 0, falseAlarm = 0, safeDen = 0, threatDen = 0, threatNum = 0;
const details: string[] = [];

for (const c of cases) {
  const r = scanLocalPatterns(c.text);
  const predicted = verdict(r.riskScore);
  if (predicted === c.label) exact++;
  if (c.label === 'PELIGROSO' && predicted === 'SEGURO') { severe++; details.push(`[SEVERE] ${c.id}: score=${r.riskScore} expected PELIGROSO`); }
  if (c.label === 'SEGURO') { safeDen++; if (isThreat(predicted)) { falseAlarm++; details.push(`[FALSE ALARM] ${c.id}: score=${r.riskScore} tactics=${r.tactics.join(', ')}`); } }
  if (isThreat(c.label)) { threatDen++; if (isThreat(predicted)) threatNum++; }
}

console.log(`=== Regex layer on full corpus (${cases.length} cases) ===`);
console.log(`Exact accuracy:   ${(exact/cases.length*100).toFixed(1)}%`);
console.log(`Threat recall:    ${(threatNum/threatDen*100).toFixed(1)}%`);
console.log(`False alarm rate: ${(falseAlarm/safeDen*100).toFixed(1)}%`);
console.log(`Severe misses:    ${severe}`);

// Key regression cases
const edge001 = cases.find(c => c.id === 'edge-001');
if (edge001) {
  const r = scanLocalPatterns(edge001.text);
  console.log(`\n[edge-001] "envies sin acento": score=${r.riskScore} tactics=[${r.tactics.join(', ')}]`);
}
const edge002 = cases.find(c => c.id === 'edge-002');
if (edge002) {
  const r = scanLocalPatterns(edge002.text);
  console.log(`[edge-002] "vocabulario regional": score=${r.riskScore} tactics=[${r.tactics.join(', ')}]`);
}

if (details.length) {
  console.log('\n=== Issues ===');
  for (const d of details) console.log(d);
}
