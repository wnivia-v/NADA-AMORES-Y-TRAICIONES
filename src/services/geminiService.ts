import { scanLocalPatterns, normalizeForMatching } from '@/utils/scamPatterns';
import { learnFromThreat } from './threatMemory';
import { checkUrlSafety } from './safeBrowsingService';
import { scamDatabase } from './scamDatabase';
import { getFusionEngine, type RiskLane } from '@/shared/risk';
import { isExplicitThreatCategory } from '@/shared/risk/config';
import type { FusionResult } from '@/shared/risk/types';
import { orchestrateAnalysis } from './aiProviders';
import { buildAnalysisRequest } from '@/shared/llm/envelope';
import { INJECTION_SIGNAL_WEIGHT } from '@/shared/llm/injectionScan';
import type { AnalysisRequest } from '@/shared/llm/types';
import type { ScamAnalysis } from '@/store/useNadaStore';

// =============================================================================
// AI Analysis Service — Multi-Provider Hybrid Pipeline
// Local regex scan -> URL check -> AI Provider(s) -> RiskScorer -> Composite
// Supports Gemini, Claude, AWS Bedrock with configurable strategies
// =============================================================================

/**
 * Analysis lanes. Cancellation is scoped per lane: starting a new analysis
 * cancels only the previous one in the SAME lane.
 *
 * A single shared controller used to live here, which meant the clipboard
 * shield, the screen OCR loop, the 15s voice loop and the UI all aborted each
 * other on entry. The loser silently degraded to a local-only verdict, so the
 * user could be shown "SEGURO" for text that was never sent to the AI.
 */
export type AnalysisScope = 'ui' | 'clipboard' | 'screen' | 'voice';

const controllers = new Map<AnalysisScope, AbortController>();

/** Thrown when an analysis was superseded by a newer one in the same lane. */
export class AnalysisAbortedError extends Error {
  readonly scope: AnalysisScope;
  constructor(scope: AnalysisScope) {
    super(`Analisis cancelado (${scope}): reemplazado por una solicitud mas reciente.`);
    this.name = 'AnalysisAbortedError';
    this.scope = scope;
  }
}

export function isAnalysisAborted(error: unknown): error is AnalysisAbortedError {
  return error instanceof AnalysisAbortedError;
}

/** Replaces the controller for a lane and returns the fresh signal. */
function beginAnalysis(scope: AnalysisScope): AbortSignal {
  controllers.get(scope)?.abort();
  const controller = new AbortController();
  controllers.set(scope, controller);
  return controller.signal;
}

function endAnalysis(scope: AnalysisScope, signal: AbortSignal) {
  // Only clear if we are still the active run for this lane.
  if (controllers.get(scope)?.signal === signal) {
    controllers.delete(scope);
  }
}

/** Cancels any in-flight analysis in a lane. Safe to call on unmount/stop. */
export function cancelAnalysis(scope: AnalysisScope) {
  controllers.get(scope)?.abort();
  controllers.delete(scope);
}

// Endurecimiento y empaquetado de la entrada.
//
// Aqui vivia sanitizeForPrompt(), una lista de frases prohibidas que se
// tachaban del mensaje antes de pegarlo dentro del prompt. Se evadia de ocho
// maneras distintas — perifrasis, acentos, otro idioma, un espacio de ancho
// cero, una "a" cirilica — porque una lista de frases no puede ganarle a quien
// escribe despues de leerla.
//
// El reemplazo no es una lista mejor: es que el mensaje ya no se pega dentro de
// las instrucciones. Va en un campo aparte, delimitado por un marcador que
// cambia en cada peticion (src/shared/llm/envelope.ts). Lo que el detector de
// inyeccion encuentra ahora se usa como SEÑAL DE RIESGO, no como censura.
function prepare(text: string, task: AnalysisRequest['task']): AnalysisRequest {
  return buildAnalysisRequest(text, task);
}

/**
 * Un mensaje que intenta manipular al analizador es, en si mismo, un indicio.
 *
 * Se suma al scorer con peso moderado y NO fija un suelo: el principio del
 * proyecto es que ninguna alerta salte por una señal aislada. Un intento de
 * inyeccion empuja, no decide.
 */
function recordInjectionAttempts(request: AnalysisRequest, scope: AnalysisScope) {
  const attempts = request.hardening.injectionAttempts;
  if (attempts.length === 0) return;
  console.warn(
    `[NADA][${scope}] intento de manipulacion del analizador:`,
    attempts.map((a) => a.id).join(', '),
  );
  getFusionEngine(scope as RiskLane).addSignal('injection-attempt', INJECTION_SIGNAL_WEIGHT);
}

// =============================================================================
// Alimentacion del motor de fusion
// =============================================================================

/**
 * Vuelca en el motor lo que ve la capa local.
 *
 * `explicit-threat` es una señal aparte y no un sinonimo de `local-patterns`:
 * es la unica que puede disparar una alerta sin corroboracion, y por eso solo
 * se emite para las categorias de la lista cerrada. Ver EXPLICIT_THREAT_CATEGORIES.
 */
function feedLocalSignals(
  scope: AnalysisScope,
  localResult: ReturnType<typeof scanLocalPatterns>,
  unsafeUrls: number,
) {
  const engine = getFusionEngine(scope as RiskLane);

  if (localResult.riskScore > 0) {
    // Los patrones son deterministas: cuando coinciden, coinciden.
    engine.addSignal('local-patterns', localResult.riskScore, 1);

    if (localResult.categories.some(isExplicitThreatCategory)) {
      engine.addSignal('explicit-threat', localResult.riskScore, 1);
    }
  }

  if (unsafeUrls > 0) {
    engine.addSignal('unsafe-urls', Math.min(100, unsafeUrls * 40), 1);
  }

  return engine;
}

/**
 * Convierte el resultado del motor en lo que ve el usuario.
 *
 * Aqui murio el apaño del suelo local — `Math.max(blended, localResult.riskScore)`.
 * Existia porque promediar hundia un hallazgo de 80 puntos hasta "0/100, no se
 * detectaron patrones" cuando el modelo decia que no era fraude; pasó dos veces
 * con mensajes que nombraban un delito y la direccion de la victima.
 *
 * El motor lo arregla de raiz en vez de parchearlo: la evidencia se acumula, no
 * se promedia, asi que una señal alta no puede bajar porque llegue otra baja.
 * Un modelo que diga "esto no es fraude" ya no resta — como mucho, no suma.
 */
function composeResult(
  fusion: FusionResult,
  parts: {
    localResult: ReturnType<typeof scanLocalPatterns>;
    aiTactics?: string[];
    aiExplanation?: string;
    aiRecommendations?: string[];
    scanSource: ScamAnalysis['scanSource'];
  },
): ScamAnalysis {
  const { localResult, aiTactics = [], aiExplanation, aiRecommendations, scanSource } = parts;
  const tactics = [...new Set([...aiTactics, ...localResult.tactics])];

  // Que explicacion enseñar la decide quien sostuvo el resultado. Si mandaron
  // los patrones, la frase tranquilizadora del modelo debajo de una insignia
  // roja se contradiria con ella misma.
  const drivenByLocal =
    fusion.drivers[0]?.type === 'local-patterns' || fusion.drivers[0]?.type === 'explicit-threat';

  const explanation = drivenByLocal && localResult.tactics.length > 0
    ? `Se detectaron patrones explicitos de riesgo: ${localResult.tactics.join(', ')}.`
    : aiExplanation || (tactics.length > 0
        ? `Detectados ${tactics.length} indicadores de riesgo mediante analisis local.`
        : 'No se detectaron patrones de fraude conocidos.');

  const recommendations = drivenByLocal
    ? [
        'No respondas ni sigas las instrucciones del mensaje.',
        'No compartas datos personales, fotos ni dinero.',
        'Guarda capturas y consultalo con alguien de confianza o denuncialo.',
      ]
    : aiRecommendations ?? (fusion.band === 'SEGURO'
        ? ['El mensaje parece seguro, pero mantente alerta.']
        : ['No compartas datos personales.', 'No hagas clic en links sospechosos.', 'Verifica la identidad del remitente.']);

  return {
    verdict: fusion.band,
    riskScore: fusion.score,
    tactics,
    explanation,
    scanSource,
    recommendations,
    alert: fusion.alert,
    corroborated: fusion.corroborated,
    confidence: fusion.confidence,
  };
}

// Extract URLs from text
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  return text.match(urlRegex) ?? [];
}

// =============================================================================
// Main Export: analyzeText (multi-provider, cancellable)
// =============================================================================

export async function analyzeText(text: string, scope: AnalysisScope = 'ui'): Promise<ScamAnalysis> {
  const signal = beginAnalysis(scope);
  try {
    return await runTextAnalysis(text, scope, signal);
  } finally {
    endAnalysis(scope, signal);
  }
}

async function runTextAnalysis(text: string, scope: AnalysisScope, signal: AbortSignal): Promise<ScamAnalysis> {
  // Step 0: Check local scam database (instant, no tokens)
  const dbLookup = await scamDatabase.lookup(text);
  if (dbLookup.found && dbLookup.record) {
    getFusionEngine(scope as RiskLane).addSignal('scam-db', dbLookup.record.riskScore, 1);
    return {
      verdict: dbLookup.record.verdict,
      riskScore: dbLookup.record.riskScore,
      tactics: dbLookup.record.tactics,
      explanation: `Coincidencia encontrada en base de datos local (fuente: ${dbLookup.record.source}).`,
      scanSource: 'local',
      recommendations: ['Este contenido ya fue identificado como peligroso anteriormente.', 'No interactues con el remitente.'],
      // No pasa por la regla de corroboracion a proposito: no es una sospecha
      // nueva, es un veredicto que ya se decidio sobre este mismo texto. La BD
      // solo almacena amenazas, asi que llegar aqui ya implica que hay que avisar.
      alert: true,
      corroborated: true,
      confidence: 1,
    };
  }

  // Step 1: Local pattern scan (instant)
  const localResult = scanLocalPatterns(text);

  // Step 2: URL safety check
  const urls = extractUrls(text);
  let unsafeUrls = 0;
  if (urls.length > 0) {
    const checks = await Promise.all(urls.map((u) => checkUrlSafety(u)));
    unsafeUrls = checks.filter((r) => !r.safe).length;
  }

  const engine = feedLocalSignals(scope, localResult, unsafeUrls);

  // A superseded run must not return a degraded verdict — the caller would
  // display a local-only "SEGURO" as if the AI had cleared the text.
  if (signal.aborted) throw new AnalysisAbortedError(scope);

  // Step 3: AI Provider orchestration (local, Gemini, y los remotos via proxy)
  const request = prepare(text, 'text');
  recordInjectionAttempts(request, scope);
  const { result: aiResult, providerId } = await orchestrateAnalysis(request, signal);

  if (signal.aborted) throw new AnalysisAbortedError(scope);

  // Step 4: fusion — la decision la toma el motor, no el modelo ni un promedio
  if (aiResult) {
    const sourceLabel = providerId ?? 'ai';
    engine.addSignal('llm-risk', aiResult.value, aiResult.confidence);

    const fusion = engine.fuse();
    const result = composeResult(fusion, {
      localResult,
      aiTactics: aiResult.tactics,
      aiExplanation: aiResult.explanation,
      aiRecommendations: aiResult.recommendations,
      scanSource: 'hybrid',
    });

    if (result.verdict !== 'SEGURO') {
      scamDatabase.store(text, result.verdict, result.riskScore, result.tactics, sourceLabel).catch(() => {});
    }
    // Remember the phrasing so the next message built from this script is
    // caught offline and instantly, even if the AI is unreachable then.
    learnFromThreat(normalizeForMatching(text), result.verdict);

    return result;
  }

  // Sin IA: el motor fusiona lo que haya. Un resultado local honesto vale mas
  // que uno inventado.
  const fallback = composeResult(engine.fuse(), { localResult, scanSource: 'local' });

  if (fallback.verdict !== 'SEGURO') {
    scamDatabase.store(text, fallback.verdict, fallback.riskScore, fallback.tactics, 'local').catch(() => {});
  }

  return fallback;
}

// =============================================================================
// Voice fragment analysis — uses dedicated voice prompt for partial transcripts
// =============================================================================

export async function analyzeVoiceFragment(
  transcript: string,
  scope: AnalysisScope = 'voice',
): Promise<ScamAnalysis> {
  // Long transcripts go through the full text pipeline (which scopes itself).
  if (transcript.length >= 200) {
    return analyzeText(transcript, scope);
  }

  const signal = beginAnalysis(scope);
  try {
    return await runVoiceFragmentAnalysis(transcript, scope, signal);
  } finally {
    endAnalysis(scope, signal);
  }
}

async function runVoiceFragmentAnalysis(
  transcript: string,
  scope: AnalysisScope,
  signal: AbortSignal,
): Promise<ScamAnalysis> {
  {
    const localResult = scanLocalPatterns(transcript);
    const engine = feedLocalSignals(scope, localResult, 0);

    if (signal.aborted) throw new AnalysisAbortedError(scope);

    const request = prepare(transcript, 'voice');
    recordInjectionAttempts(request, scope);
    const { result: aiResult } = await orchestrateAnalysis(request, signal);

    if (signal.aborted) throw new AnalysisAbortedError(scope);

    if (aiResult) {
      engine.addSignal('llm-risk', aiResult.value, aiResult.confidence);

      return composeResult(engine.fuse(), {
        localResult,
        aiTactics: aiResult.tactics,
        aiExplanation: aiResult.explanation || 'Analisis de fragmento de voz.',
        aiRecommendations: aiResult.recommendations ?? ['Mantente alerta durante la conversacion.'],
        scanSource: 'hybrid',
      });
    }

    return composeResult(engine.fuse(), { localResult, scanSource: 'local' });
  }
}
