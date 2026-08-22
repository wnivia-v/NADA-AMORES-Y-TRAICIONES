// =============================================================================
// Barrido de parametros del motor de fusion.
//
// Para que sirve, y para que NO sirve.
//
// fusion.ts dice que el motor acierta 16/16 con los valores por defecto. Ese
// numero por si solo no vale nada: el fixture y los parametros los escribio la
// misma persona, asi que coinciden por construccion. Lo unico que demuestra es
// que el motor hace lo que se pretendia, no que lo pretendido sea lo correcto.
//
// Lo que si informa es la SENSIBILIDAD. Si el resultado aguanta igual con la
// ventana a 5 s que a 60 s, entonces la ventana no esta haciendo nada y el
// fixture es demasiado facil. Si se desmorona al mover un parametro un poco, el
// valor por defecto esta en un pico estrecho y no sobrevivira al mundo real.
//
// Lo que se busca es una meseta: un rango ancho de valores razonables donde el
// resultado se mantiene, con los bordes fallando por motivos comprensibles.
//
// Uso: npx tsx bench/fusion-sweep.ts
// =============================================================================

import { evaluate } from './fusion';
import { DEFAULT_FUSION_CONFIG } from '../src/shared/risk/config';

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function row(label: string, value: string | number, metrics: ReturnType<typeof evaluate>['metrics']) {
  const flag = metrics.missed > 0 ? ' <- amenazas sin avisar' : metrics.falseAlarms > 0 ? ' <- falsas alarmas' : '';
  console.log(
    `  ${label.padEnd(14)} ${String(value).padStart(7)}   ` +
      `${String(metrics.correct + '/' + metrics.total).padStart(6)}   ` +
      `${pct(metrics.recall).padStart(5)}   ${pct(metrics.precision).padStart(5)}   ` +
      `${String(metrics.missed).padStart(3)}   ${String(metrics.falseAlarms).padStart(3)}${flag}`,
  );
}

function header(title: string) {
  console.log(`\n${title}`);
  console.log('  parametro          valor   aciertos  recall  prec.  miss   fa');
  console.log('  ' + '-'.repeat(68));
}

console.log('\nBarrido de parametros — motor de fusion');
console.log('Se busca una meseta ancha, no un maximo.\n');

header('Ventana deslizante (el brief pide 15-30 s)');
for (const windowMs of [5_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 120_000]) {
  row('windowMs', windowMs, evaluate({ windowMs }).metrics);
}

header('Evidencia minima para contar como corroboracion');
for (const minEvidence of [0.05, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5]) {
  row('minEvidence', minEvidence, evaluate({ minEvidence }).metrics);
}

header('Decaimiento en el borde de la ventana');
for (const edgeDecay of [0.1, 0.25, 0.5, 0.75, 1.0]) {
  row('edgeDecay', edgeDecay, evaluate({ edgeDecay }).metrics);
}

header('Umbral de sospecha');
for (const suspicious of [20, 30, 40, 50, 60]) {
  row('suspicious', suspicious, evaluate({
    thresholds: { ...DEFAULT_FUSION_CONFIG.thresholds, suspicious },
  }).metrics);
}

header('Peso de la señal de inyeccion');
for (const weight of [0.2, 0.35, 0.5, 0.7, 1.0]) {
  row('injection', weight, evaluate({
    sourceWeights: { ...DEFAULT_FUSION_CONFIG.sourceWeights, 'injection-attempt': weight },
  }).metrics);
}

header('Peso del LLM');
for (const weight of [0.4, 0.6, 0.85, 1.0]) {
  row('llm-risk', weight, evaluate({
    sourceWeights: { ...DEFAULT_FUSION_CONFIG.sourceWeights, 'llm-risk': weight },
  }).metrics);
}

console.log('\nLectura: un parametro cuya fila entera acierta 16/16 no esta siendo');
console.log('medido por este fixture — hacen falta casos que lo pongan a prueba.\n');
