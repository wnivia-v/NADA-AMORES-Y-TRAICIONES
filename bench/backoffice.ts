// =============================================================================
// Backoffice — agrupar reportes y medir propuestas
//
// Corre FUERA DE LINEA, sobre un fichero exportado, y nunca toca produccion.
// Eso no es una limitacion: es lo que pide el §4.2. Un agente que trabaja sobre
// un export no puede afectar a ninguna llamada en curso ni a ninguna persona
// mientras piensa.
//
//   npx tsx bench/backoffice.ts clusters <reportes.json>
//   npx tsx bench/backoffice.ts propose  <reportes.json> [proveedor]
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
import { proposeChanges } from '../src/shared/backoffice/agent';
import { LEXICON_VERSION } from '../src/utils/threatLexicon';
import { callUpstreamChat } from '../server/src/upstreams';
import { configuredUpstreams, type UpstreamId } from '../server/src/config';

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

/**
 * Pide una propuesta a un agente y la mide en el acto.
 *
 * Sin proveedor configurado NO falla en silencio ni finge: imprime el prompt
 * exacto para que una persona lo pegue donde quiera y traiga el JSON de vuelta.
 * Es lo mismo que hace el agente, solo que a mano — y sirve para revisar que se
 * le esta pidiendo antes de dejarle hacerlo solo.
 */
async function proposeFromReports(path: string, provider?: string): Promise<void> {
  const raw = readJson(path);
  const reports = (Array.isArray(raw) ? raw : (raw as { reports?: unknown }).reports) as ReportLike[];
  if (!Array.isArray(reports)) {
    console.error('El fichero debe ser una lista de reportes, o { "reports": [...] }');
    process.exit(1);
  }

  const clusters = clusterReports(reports, { minCount: 1 });
  if (clusters.length === 0) {
    console.log('\nNada que proponer: ningun reporte marca un error.\n');
    return;
  }

  const available = configuredUpstreams();
  const chosen = (provider as UpstreamId | undefined) ?? available[0];

  if (!chosen || !available.includes(chosen)) {
    const { buildAgentRequest } = await import('../src/shared/backoffice/agentPrompt');
    const request = buildAgentRequest(clusters, LEXICON_VERSION);

    console.log('\n=== Sin proveedor configurado. Este es el prompt exacto ===');
    console.log('\n--- turno system ---\n');
    console.log(request.system);
    console.log('\n--- turno user ---\n');
    console.log(request.user);
    warnAboutSuspicious(request.suspiciousSamples);
    console.log('\nGuarda el JSON que devuelva y pasalo por `evaluate`.\n');
    return;
  }

  console.log(`\n=== Pidiendo una propuesta a ${chosen} sobre ${clusters.length} grupo(s) ===\n`);

  const outcome = await proposeChanges(clusters, LEXICON_VERSION, async (turns) => {
    const response = await callUpstreamChat(chosen, { ...turns, maxTokens: 2048 });
    return response?.text ?? null;
  });

  warnAboutSuspicious(outcome.request.suspiciousSamples);

  if (!outcome.ok) {
    // Cerrado por defecto: lo que no encaja se rechaza entero.
    console.error(`\nRECHAZADA: ${outcome.reason}\n`);
    if (outcome.raw) console.error(`Devolvio:\n${outcome.raw.slice(0, 800)}\n`);
    process.exit(1);
  }

  const { proposal } = outcome;
  console.log(`Propuesta: ${proposal.summary}`);
  if (proposal.changes.length === 0) {
    // Que un agente diga "aqui no hace falta tocar nada" es una respuesta
    // legitima y de las mas valiosas: proponer de mas es peor que no proponer.
    console.log('\nEl agente no propone ningun cambio.\n');
    return;
  }

  for (const change of proposal.changes) {
    console.log(`\n  [${change.kind}] ${change.id}`);
    console.log(`      ${change.rationale}`);
    if ('pattern' in change) console.log(`      patron: ${change.pattern}`);
  }

  const cases = (corpus as { cases: CorpusCase[] }).cases.filter((c) => c.text && c.label);
  const evaluation = evaluateProposal(proposal, cases);
  console.log('');
  console.log(formatEvaluation(evaluation));
  console.log('\nNADA SE HA APLICADO. Aprobar es una accion humana.\n');

  process.exit(evaluation.autoReject ? 1 : 0);
}

/**
 * Avisa de las muestras que intentan manipular al agente.
 *
 * El aislamiento del prompt ya las neutraliza, pero la persona que revisa tiene
 * que saberlo: un grupo cuyas muestras dan ordenes probablemente no describe un
 * fallo de deteccion, sino un ataque contra este mismo proceso.
 */
function warnAboutSuspicious(suspicious: { clusterId: string; hits: string[] }[]): void {
  if (suspicious.length === 0) return;
  console.log('\n  AVISO — muestras que intentan dar instrucciones:');
  for (const s of suspicious) {
    console.log(`    ${s.clusterId}: ${s.hits.join(', ')}`);
  }
  console.log('    Estos reportes pueden ser un intento de envenenar el lexico,');
  console.log('    no un fallo de deteccion. Miralos con eso en mente.');
}

switch (command) {
  case 'clusters':
    if (!file) { console.error('Falta el fichero de reportes.'); process.exit(1); }
    showClusters(file);
    break;

  case 'propose':
    if (!file) { console.error('Falta el fichero de reportes.'); process.exit(1); }
    void proposeFromReports(file, process.argv[4]);
    break;

  case 'evaluate':
    if (!file) { console.error('Falta el fichero de propuesta.'); process.exit(1); }
    showEvaluation(file);
    break;

  default:
    console.log('Uso:');
    console.log('  npx tsx bench/backoffice.ts clusters <reportes.json>');
    console.log('  npx tsx bench/backoffice.ts propose  <reportes.json> [groq|claude|bedrock]');
    console.log('  npx tsx bench/backoffice.ts evaluate <propuesta.json>');
    process.exit(1);
}
