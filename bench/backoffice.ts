// =============================================================================
// Backoffice — agrupar reportes y medir propuestas
//
// Corre FUERA DE LINEA, sobre un fichero exportado, y nunca toca produccion.
// Eso no es una limitacion: es lo que pide el §4.2. Un agente que trabaja sobre
// un export no puede afectar a ninguna llamada en curso ni a ninguna persona
// mientras piensa.
//
//   npx tsx bench/backoffice.ts clusters <reportes.json>
//   npx tsx bench/backoffice.ts evaluate <propuesta.json>
//
// El segundo comando es el que importa. Coge una propuesta —de un agente o de
// una persona, da igual—, la aplica sobre una COPIA del vocabulario, la mide
// contra el corpus entero y dice que casos mejoran y cuales empeoran, uno a uno.
// Lo que crea una falsa alarma o pierde una amenaza se rechaza SOLO y no llega
// a la persona: la atencion humana es el recurso escaso y hay que gastarla en
// las decisiones de verdad.
//
// Y despues de todo eso, no aplica nada. Aprobar es una accion humana; esto solo
// prepara la decision.
// =============================================================================

import { readFileSync } from 'node:fs';

import corpus from '../src/data/scam-corpus.json';
import { clusterReports, describeCluster, type ReportLike } from '../src/shared/backoffice/cluster';
import { parseProposal } from '../src/shared/backoffice/proposal';
import { evaluateProposal, formatEvaluation, type CorpusCase } from '../src/shared/backoffice/evaluate';
import { LEXICON_VERSION } from '../src/utils/threatLexicon';

const [command, file] = process.argv.slice(2);

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    console.error(`No se pudo leer ${path}: ${String(error)}`);
    process.exit(1);
  }
}

function showClusters(path: string): void {
  const raw = readJson(path);
  const reports = (Array.isArray(raw) ? raw : (raw as { reports?: unknown }).reports) as ReportLike[];
  if (!Array.isArray(reports)) {
    console.error('El fichero debe ser una lista de reportes, o { "reports": [...] }');
    process.exit(1);
  }

  const clusters = clusterReports(reports, { minCount: 1 });

  console.log(`\n=== ${reports.length} reporte(s) -> ${clusters.length} grupo(s) ===`);
  console.log(`Lexico actual: ${LEXICON_VERSION}\n`);

  if (clusters.length === 0) {
    console.log('Nada que revisar: ningun reporte marca un error.\n');
    return;
  }

  for (const cluster of clusters) {
    const desfasado = !cluster.lexiconVersions.includes(LEXICON_VERSION);
    console.log(describeCluster(cluster));
    if (desfasado) {
      // Importa: puede estar arreglado ya y nadie se ha enterado.
      console.log('    (ninguno es de la version actual del lexico)');
    }
    console.log('');
  }
}

function showEvaluation(path: string): void {
  const parsed = parseProposal(readJson(path));
  if (!parsed.ok) {
    // Cerrado por defecto, igual que la señal del LLM en la Fase 1: lo que no
    // encaja se rechaza entero, no se coge "la parte buena".
    const where = parsed.failure.index === null ? '' : ` (cambio ${parsed.failure.index})`;
    console.error(`\nPropuesta rechazada${where}: ${parsed.failure.reason}\n`);
    process.exit(1);
  }

  const { proposal } = parsed;
  const cases = (corpus as { cases: CorpusCase[] }).cases.filter((c) => c.text && c.label);
  const evaluation = evaluateProposal(proposal, cases);

  console.log(`\n=== ${proposal.summary} ===`);
  console.log(`Propuesta sobre el lexico ${proposal.baseLexiconVersion}; el actual es ${LEXICON_VERSION}.`);
  if (proposal.baseLexiconVersion !== LEXICON_VERSION) {
    console.log('AVISO: el lexico ha cambiado desde que se propuso. Revisa que siga teniendo sentido.');
  }
  console.log(`Motivada por ${proposal.motivatingReportIds.length} reporte(s).\n`);

  for (const change of proposal.changes) {
    console.log(`  [${change.kind}] ${change.id}`);
    console.log(`      ${change.rationale}`);
  }
  console.log('');
  console.log(formatEvaluation(evaluation));
  console.log('');

  // El codigo de salida sirve para encadenarlo en un flujo: lo rechazado no
  // sigue adelante solo.
  process.exit(evaluation.autoReject ? 1 : 0);
}

switch (command) {
  case 'clusters':
    if (!file) { console.error('Falta el fichero de reportes.'); process.exit(1); }
    showClusters(file);
    break;

  case 'evaluate':
    if (!file) { console.error('Falta el fichero de propuesta.'); process.exit(1); }
    showEvaluation(file);
    break;

  default:
    console.log('Uso:');
    console.log('  npx tsx bench/backoffice.ts clusters <reportes.json>');
    console.log('  npx tsx bench/backoffice.ts evaluate <propuesta.json>');
    process.exit(1);
}
