// =============================================================================
// Mide el motor de fusion contra el fixture de secuencias de señales.
//
// Responde a la pregunta que el brief exige poder responder: los umbrales, ¿son
// medibles? Sin esto, "ventana de 30 s" y "peso 0.85" son intuiciones con
// aspecto de ingenieria.
//
// A diferencia de bench/local-provider.mjs, que reproduce a mano las constantes
// del provider y avisa "Must mirror src/...", este banco IMPORTA el motor real.
// Un banco que duplica la implementacion mide la copia, no el codigo.
//
// Uso: npx tsx bench/fusion.ts
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FusionEngine } from '../src/shared/risk/fusionEngine';
import type { FusionConfig } from '../src/shared/risk/config';
import type { RiskBand, SignalType } from '../src/shared/risk/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface FixtureSignal {
  atMs: number;
  type: SignalType;
  value: number;
  confidence: number;
}

interface Sequence {
  id: string;
  note: string;
  category?: string;
  shouldAlert: boolean;
  expectedBand?: RiskBand;
  evaluateAtMs: number;
  signals: FixtureSignal[];
}

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/signal-sequences.json'), 'utf8'),
) as { sequences: Sequence[] };

export interface Outcome {
  id: string;
  expected: boolean;
  actual: boolean;
  score: number;
  band: RiskBand;
  confidence: number;
  bandOk: boolean;
}

/** Reproduce una secuencia en tiempo simulado. El reloj es un parametro. */
export function runSequence(sequence: Sequence, config: Partial<FusionConfig> = {}): Outcome {
  // Base arbitraria pero fija: las señales llevan timestamps absolutos, y el
  // motor solo mira diferencias.
  const t0 = 1_700_000_000_000;
  const engine = new FusionEngine(config);

  for (const signal of sequence.signals) {
    engine.add({
      type: signal.type,
      value: signal.value,
      confidence: signal.confidence,
      timestamp: t0 + signal.atMs,
    });
  }

  const result = engine.fuse(t0 + sequence.evaluateAtMs);

  return {
    id: sequence.id,
    expected: sequence.shouldAlert,
    actual: result.alert,
    score: result.score,
    band: result.band,
    confidence: result.confidence,
    bandOk: sequence.expectedBand === undefined || result.band === sequence.expectedBand,
  };
}

export interface Metrics {
  total: number;
  correct: number;
  /** Alertas que debian saltar y saltaron, sobre las que debian saltar. */
  recall: number;
  /** Casos que NO debian alertar y no alertaron, sobre los que no debian. */
  precision: number;
  /** Casos tranquilos que alertaron. Lo que el usuario vive como "grita sin motivo". */
  falseAlarms: number;
  /** Amenazas que no alertaron. Lo que el usuario vive como "no me aviso". */
  missed: number;
  bandMismatches: number;
}

export function evaluate(config: Partial<FusionConfig> = {}): { metrics: Metrics; outcomes: Outcome[] } {
  const outcomes = fixture.sequences.map((s) => runSequence(s, config));

  const shouldAlert = outcomes.filter((o) => o.expected);
  const shouldNot = outcomes.filter((o) => !o.expected);

  const missed = shouldAlert.filter((o) => !o.actual).length;
  const falseAlarms = shouldNot.filter((o) => o.actual).length;

  return {
    metrics: {
      total: outcomes.length,
      correct: outcomes.filter((o) => o.expected === o.actual).length,
      recall: shouldAlert.length ? (shouldAlert.length - missed) / shouldAlert.length : 1,
      precision: shouldNot.length ? (shouldNot.length - falseAlarms) / shouldNot.length : 1,
      falseAlarms,
      missed,
      bandMismatches: outcomes.filter((o) => !o.bandOk).length,
    },
    outcomes,
  };
}

// ── Salida ───────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main() {
  const { metrics, outcomes } = evaluate();

  console.log('\nMotor de fusion — evaluacion sobre secuencias de señales\n');
  console.log('  caso      esperado  obtenido  score  banda        conf');
  console.log('  ' + '-'.repeat(58));

  for (const o of outcomes) {
    const ok = o.expected === o.actual && o.bandOk;
    const mark = ok ? ' ' : '!';
    console.log(
      `${mark} ${o.id}  ${String(o.expected).padEnd(8)}  ${String(o.actual).padEnd(8)}  ` +
        `${String(o.score).padStart(5)}  ${o.band.padEnd(11)}  ${o.confidence.toFixed(2)}`,
    );
  }

  console.log('\n  Resultados');
  console.log('  ' + '-'.repeat(58));
  console.log(`  Aciertos              ${metrics.correct}/${metrics.total}`);
  console.log(`  Recall de amenazas    ${pct(metrics.recall)}`);
  console.log(`  Precision (silencio)  ${pct(metrics.precision)}`);
  console.log(`  Falsas alarmas        ${metrics.falseAlarms}`);
  console.log(`  Amenazas no avisadas  ${metrics.missed}`);
  console.log(`  Bandas discrepantes   ${metrics.bandMismatches}`);
  console.log('');

  if (metrics.missed > 0) {
    console.log('  ATENCION: hay amenazas sin avisar. Eso pesa mas que una falsa alarma.');
    const failures = outcomes.filter((o) => o.expected && !o.actual);
    for (const f of failures) console.log(`    ${f.id} — score ${f.score}, banda ${f.band}`);
    console.log('');
  }

  process.exitCode = metrics.correct === metrics.total && metrics.bandMismatches === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('fusion.ts')) main();
