// =============================================================================
// Falsos positivos por region.
//
// La Fase 3 pide poder calibrar por region, y calibrar sin desglosar no se
// puede: una tasa global del 5% de falsas alarmas puede ser 0% en peninsular y
// 20% en rioplatense, y el promedio esconde justo el problema que hay que
// arreglar.
//
// Mide dos cosas distintas:
//
//   1. Con la region declarada — como se comporta para un usuario de alli.
//   2. Con region '*' — que pasa cuando no sabemos de donde es el usuario, que
//      es el caso por defecto hoy. Aqui los amortiguadores regionales NO se
//      aplican, asi que un modismo local puede alarmar. Ese numero es el coste
//      real de no preguntar la region.
//
// Uso: npx tsx bench/lexicon-regions.ts
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanLocalPatterns } from '../src/utils/scamPatterns';
import type { Region } from '../src/utils/threatLexicon';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RegionalCase {
  id: string;
  region: Region;
  label: 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';
  kind: 'amenaza' | 'modismo' | 'broma';
  text: string;
  note?: string;
}

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/regional-cases.json'), 'utf8'),
) as { cases: RegionalCase[]; reviewStatus: string };

const band = (score: number) => (score >= 70 ? 'PELIGROSO' : score >= 40 ? 'SOSPECHOSO' : 'SEGURO');
const isThreat = (label: string) => label !== 'SEGURO';

interface Row {
  region: string;
  safeCases: number;
  falseAlarms: number;
  threatCases: number;
  missed: number;
}

function evaluate(useDeclaredRegion: boolean): Row[] {
  const byRegion = new Map<string, RegionalCase[]>();
  for (const c of fixture.cases) {
    const key = c.region;
    byRegion.set(key, [...(byRegion.get(key) ?? []), c]);
  }

  const rows: Row[] = [];
  for (const [region, cases] of [...byRegion.entries()].sort()) {
    let safeCases = 0;
    let falseAlarms = 0;
    let threatCases = 0;
    let missed = 0;

    for (const c of cases) {
      const result = scanLocalPatterns(c.text, {
        region: useDeclaredRegion ? c.region : '*',
      });
      const predicted = band(result.riskScore);

      if (isThreat(c.label)) {
        threatCases += 1;
        if (!isThreat(predicted)) missed += 1;
      } else {
        safeCases += 1;
        if (isThreat(predicted)) falseAlarms += 1;
      }
    }

    rows.push({ region, safeCases, falseAlarms, threatCases, missed });
  }
  return rows;
}

function printTable(title: string, rows: Row[]) {
  console.log(`\n${title}`);
  console.log('  region  casos-ok  falsas-alarmas   amenazas  no-vistas');
  console.log('  ' + '-'.repeat(54));
  for (const r of rows) {
    const fa = r.safeCases ? `${((r.falseAlarms / r.safeCases) * 100).toFixed(0)}%` : '-';
    const flag = r.falseAlarms > 0 ? '  <- revisar' : r.missed > 0 ? '  <- AMENAZA SIN VER' : '';
    console.log(
      `  ${r.region.padEnd(6)}  ${String(r.safeCases).padStart(8)}  ` +
        `${String(r.falseAlarms).padStart(3)} (${fa.padStart(4)})   ` +
        `${String(r.threatCases).padStart(8)}  ${String(r.missed).padStart(9)}${flag}`,
    );
  }
}

console.log('\nFalsos positivos por region');
console.log(`Estado del fixture: ${fixture.reviewStatus}.`);

printTable('Con la region del usuario declarada', evaluate(true));
printTable("Sin region declarada (region '*', el caso por defecto hoy)", evaluate(false));

const declared = evaluate(true);
const generic = evaluate(false);
const faDeclared = declared.reduce((n, r) => n + r.falseAlarms, 0);
const faGeneric = generic.reduce((n, r) => n + r.falseAlarms, 0);
const missDeclared = declared.reduce((n, r) => n + r.missed, 0);

console.log('\n  Lectura');
console.log('  ' + '-'.repeat(54));
console.log(`  Falsas alarmas con region declarada:  ${faDeclared}`);
console.log(`  Falsas alarmas sin region:            ${faGeneric}`);
console.log(
  faGeneric > faDeclared
    ? `  Coste de no preguntar la region:      ${faGeneric - faDeclared} falsa(s) alarma(s)`
    : '  Preguntar la region no cambia nada con este fixture.',
);
console.log(`  Amenazas no vistas:                   ${missDeclared}`);
console.log('');

// Una amenaza sin ver invalida el resultado; una falsa alarma solo lo empeora.
process.exitCode = missDeclared > 0 ? 1 : 0;
