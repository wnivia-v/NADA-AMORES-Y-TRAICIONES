import { scanLocalPatterns, normalizeForMatching, feedDictionaryLearning } from '@/utils/scamPatterns';
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
import { scanDictionary } from '@/utils/threatDictionary';
import type { ScamAnalysis } from '@/store/useNadaStore';
import { feedbackService } from './feedbackService';
import { LEXICON_VERSION } from '@/utils/threatLexicon';
import type { AnalysisSurface, DecisionTrace, ShownVerdict } from '@/shared/feedback/types';

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

/**
 * De donde vino el texto, para el reporte de feedback.
 *
 * No es lo mismo que el carril: 'ui' es un carril, pero el texto que llega por
 * ahi puede haberlo escrito la usuaria o haberlo sacado el OCR de una captura.
 * Un falso positivo causado por basura del OCR es un fallo distinto de uno
 * causado por una entrada del lexico, y mezclarlos ensucia el corpus.
 */
const SURFACE_BY_SCOPE: Record<AnalysisScope, AnalysisSurface> = {
  ui: 'text',
  clipboard: 'clipboard',
  screen: 'screen',
  voice: 'voice',
};

/** Contexto comun a todo reporte: contra que version se produjo el analisis. */
function reportContext() {
  return {
    // La region efectiva la fija el escaner; aqui se registra la configurada.
    region: (globalThis.navigator?.language ?? 'es').split('-')[1]?.toLowerCase() ?? '*',
    language: (globalThis.navigator?.language ?? 'es').split('-')[0] ?? 'es',
    appVersion: import.meta.env.VITE_APP_VERSION || '0.0.0',
    lexiconVersion: LEXICON_VERSION,
  };
}

function shownFrom(result: ScamAnalysis): ShownVerdict {
  return {
    band: result.verdict,
    riskScore: result.riskScore,
    alerted: result.alert ?? false,
    corroborated: result.corroborated ?? false,
    scanSource: result.scanSource,
  };
}

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

/**
 * Guarda todo lo que se sabe de este analisis y devuelve el resultado con su id.
 *
 * Tiene que ocurrir AQUI, en el momento del analisis. El rastro de la decision
 * —que entradas del lexico coincidieron, que amortiguadores retiraron peso, que
 * sostuvo la fusion— vive dentro del motor y del escaner, y a la interfaz solo
 * le llega el veredicto. Si no se captura ahora, cuando alguien pulse "no
 * acerto" ya no habra nada que contarle a un agente salvo el texto y la
 * puntuacion, que es justo lo que no basta para arreglar nada.
 */
function withDraft(
  result: ScamAnalysis,
  parts: { surface: AnalysisSurface; text: string; trace: DecisionTrace },
): ScamAnalysis {
  const analysisId = feedbackService.registerDraft({
    surface: parts.surface,
    shown: shownFrom(result),
    trace: parts.trace,
    content: parts.text,
    context: reportContext(),
  });

  return { ...result, analysisId };
}

/** El rastro que deja un analisis completo. */
function traceOf(
  fusion: FusionResult,
  localResult: ReturnType<typeof scanLocalPatterns>,
  request: AnalysisRequest | null,
  llmScore: number | null,
): DecisionTrace {
  return {
    drivers: fusion.drivers.map((d) => ({ type: d.type, evidence: Math.round(d.evidence * 1000) / 1000 })),
    lexiconIds: localResult.matches.map((m) => m.id),
    combos: localResult.combos,
    dampened: localResult.dampened,
    localScore: localResult.riskScore,
    llmScore,
    injectionHits: request?.hardening.injectionAttempts.map((a) => a.id) ?? [],
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

export async function analyzeText(
  text: string,
  scope: AnalysisScope = 'ui',
  /**
   * De donde salio el texto, si no se deduce del carril.
   *
   * Lo usa el analizador de imagenes: su texto llega por el carril 'ui' pero lo
   * ha sacado el OCR, y un falso positivo provocado por basura de
   * reconocimiento no es el mismo fallo que uno provocado por el lexico.
   */
  surface?: AnalysisSurface,
): Promise<ScamAnalysis> {
  const signal = beginAnalysis(scope);
  try {
    return await runTextAnalysis(text, scope, signal, surface ?? SURFACE_BY_SCOPE[scope]);
  } finally {
    endAnalysis(scope, signal);
  }
}

async function runTextAnalysis(
  text: string,
  scope: AnalysisScope,
  signal: AbortSignal,
  surface: AnalysisSurface,
): Promise<ScamAnalysis> {
  // Step 0: Check local scam database (instant, no tokens)
  const dbLookup = await scamDatabase.lookup(text);
  if (dbLookup.found && dbLookup.record) {
    getFusionEngine(scope as RiskLane).addSignal('scam-db', dbLookup.record.riskScore, 1);
    const hit: ScamAnalysis = {
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

    // Tambien se puede opinar sobre esto, y conviene: un acierto guardado en la
    // BD local que resulta ser un falso positivo lo seguira siendo cada vez que
    // aparezca el mismo texto, sin volver a analizarse. Es el fallo que mas se
    // repite si nadie lo corrige.
    return withDraft(hit, {
      surface,
      text,
      trace: {
        drivers: [{ type: 'scam-db', evidence: dbLookup.record.riskScore / 100 }],
        lexiconIds: [],
        combos: [],
        dampened: [],
        localScore: dbLookup.record.riskScore,
        llmScore: null,
        injectionHits: [],
      },
    });
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

    if (result.verdict === 'PELIGROSO') {
      const dictScan = scanDictionary(text);
      if (dictScan.categories.length > 0) {
        feedDictionaryLearning(normalizeForMatching(text), dictScan.categories);
      }
    }

    return withDraft(result, {
      surface,
      text,
      trace: traceOf(fusion, localResult, request, aiResult.value),
    });
  }

  // Sin IA: el motor fusiona lo que haya. Un resultado local honesto vale mas
  // que uno inventado.
  const fallbackFusion = engine.fuse();
  const fallback = composeResult(fallbackFusion, { localResult, scanSource: 'local' });

  if (fallback.verdict !== 'SEGURO') {
    scamDatabase.store(text, fallback.verdict, fallback.riskScore, fallback.tactics, 'local').catch(() => {});
  }

  return withDraft(fallback, {
    surface,
    text,
    trace: traceOf(fallbackFusion, localResult, request, null),
  });
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
