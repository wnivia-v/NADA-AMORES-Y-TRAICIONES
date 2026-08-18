import { scanLocalPatterns, normalizeForMatching } from '@/utils/scamPatterns';
import { learnFromThreat } from './threatMemory';
import { checkUrlSafety } from './safeBrowsingService';
import { scamDatabase } from './scamDatabase';
import { riskScorer } from '@/utils/riskScorer';
import { orchestrateAnalysis } from './aiProviders';
import { buildAnalysisRequest } from '@/shared/llm/envelope';
import { INJECTION_SIGNAL_WEIGHT } from '@/shared/llm/injectionScan';
import { riskBand } from '@/shared/llm/signalSchema';
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
function recordInjectionAttempts(request: AnalysisRequest, label: string) {
  const attempts = request.hardening.injectionAttempts;
  if (attempts.length === 0) return;
  console.warn(
    `[NADA][${label}] intento de manipulacion del analizador:`,
    attempts.map((a) => a.id).join(', '),
  );
  riskScorer.addSignal('injection-attempt', INJECTION_SIGNAL_WEIGHT, 1.5);
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
    riskScorer.addSignal('scam-db-cache', dbLookup.record.riskScore, 2.5);
    return {
      verdict: dbLookup.record.verdict,
      riskScore: dbLookup.record.riskScore,
      tactics: dbLookup.record.tactics,
      explanation: `Coincidencia encontrada en base de datos local (fuente: ${dbLookup.record.source}).`,
      scanSource: 'local',
      recommendations: ['Este contenido ya fue identificado como peligroso anteriormente.', 'No interactues con el remitente.'],
    };
  }

  // Step 1: Local pattern scan (instant)
  const localResult = scanLocalPatterns(text);

  if (localResult.riskScore > 0) {
    riskScorer.addSignal('local-patterns', localResult.riskScore, 1.2);
  }

  // Step 2: URL safety check
  const urls = extractUrls(text);
  let unsafeUrls = 0;
  if (urls.length > 0) {
    const checks = await Promise.all(urls.map((u) => checkUrlSafety(u)));
    unsafeUrls = checks.filter((r) => !r.safe).length;
    if (unsafeUrls > 0) {
      riskScorer.addSignal('unsafe-urls', unsafeUrls * 40, 1.5);
    }
  }

  // A superseded run must not return a degraded verdict — the caller would
  // display a local-only "SEGURO" as if the AI had cleared the text.
  if (signal.aborted) throw new AnalysisAbortedError(scope);

  // Step 3: AI Provider orchestration (local, Gemini, y los remotos via proxy)
  const request = prepare(text, 'text');
  recordInjectionAttempts(request, scope);
  const { result: aiResult, providerId } = await orchestrateAnalysis(request, signal);

  if (signal.aborted) throw new AnalysisAbortedError(scope);

  // Step 4: Merge results (hybrid scoring) + riskScorer composite
  if (aiResult) {
    const sourceLabel = providerId ?? 'ai';
    riskScorer.addSignal(`${sourceLabel}-ai`, aiResult.value, 2.0);

    // Boost AI score with local signals
    const localBoost = localResult.riskScore * 0.3;
    const urlBoost = unsafeUrls * 15;
    const aiComposite = Math.min(100, Math.round(aiResult.value + localBoost + urlBoost));

    // Blend with riskScorer composite (includes historical signals)
    const historicalComposite = riskScorer.getCompositeScore();
    const blended = Math.round(aiComposite * 0.8 + historicalComposite * 0.2);

    // The AI may RAISE the score but never bury a local finding.
    //
    // The regex layer only fires on explicit, hand-authored patterns, so a
    // high local score means the text literally contains a death threat,
    // a fake police accusation, a demand for card numbers. A model prompted
    // with "is this a scam?" will happily return SEGURO for a stream of
    // insults or a threat to show up at someone's house — it is not
    // financial fraud, so it does not fit the question. Averaging then sank a
    // 80-point local hit to a "0/100 — no se detectaron patrones" verdict on
    // messages naming a crime and the victim's address. Real reports, twice.
    const finalScore = Math.min(100, Math.max(blended, localResult.riskScore));
    const localOverrode = localResult.riskScore > blended;

    const mergedTactics = [...new Set([...aiResult.tactics, ...localResult.tactics])];

    // La banda sale de la puntuacion fusionada, con umbrales compartidos entre
    // cliente y servidor. El modelo ya no devuelve etiqueta que copiar.
    const verdict: ScamAnalysis['verdict'] = riskBand(finalScore);

    // Store in scam database for future instant lookups
    if (verdict !== 'SEGURO') {
      scamDatabase.store(text, verdict, finalScore, mergedTactics, sourceLabel).catch(() => {});
    }
    // Remember the phrasing so the next message built from this script is
    // caught offline and instantly, even if the AI is unreachable then.
    learnFromThreat(normalizeForMatching(text), verdict);

    return {
      verdict,
      riskScore: finalScore,
      tactics: mergedTactics,
      // When the local layer set the score, the AI's own words contradict the
      // verdict ("parece un mensaje normal" next to PELIGROSO). Say what
      // actually drove it instead of showing the user a reassuring sentence
      // above a red badge.
      explanation: localOverrode
        ? `Se detectaron patrones explicitos de riesgo: ${localResult.tactics.join(', ')}.`
        : aiResult.explanation,
      scanSource: 'hybrid',
      recommendations: localOverrode
        ? [
            'No respondas ni sigas las instrucciones del mensaje.',
            'No compartas datos personales, fotos ni dinero.',
            'Guarda capturas y consultalo con alguien de confianza o denuncialo.',
          ]
        : aiResult.recommendations,
    };
  }

  // Fallback: local-only result
  const fallback = buildFallbackResult(localResult, unsafeUrls);

  // Store in scam DB if dangerous (local-only detection)
  if (fallback.verdict !== 'SEGURO') {
    scamDatabase.store(text, fallback.verdict, fallback.riskScore, fallback.tactics, 'local').catch(() => {});
  }

  return fallback;
}

function buildFallbackResult(localResult: ReturnType<typeof scanLocalPatterns>, unsafeUrls: number): ScamAnalysis {
  const urlAdjusted = Math.min(100, localResult.riskScore + unsafeUrls * 20);
  const verdict: ScamAnalysis['verdict'] = riskBand(urlAdjusted);

  return {
    verdict,
    riskScore: urlAdjusted,
    tactics: localResult.tactics,
    explanation: localResult.tactics.length > 0
      ? `Detectados ${localResult.tactics.length} patrones sospechosos mediante analisis local.`
      : 'No se detectaron patrones de fraude conocidos.',
    scanSource: 'local',
    recommendations: verdict === 'SEGURO'
      ? ['El mensaje parece seguro, pero mantente alerta.']
      : ['No compartas datos personales.', 'No hagas clic en links sospechosos.', 'Verifica la identidad del remitente.'],
  };
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
    if (localResult.riskScore > 0) {
      riskScorer.addSignal('voice-local', localResult.riskScore, 1.0);
    }

    if (signal.aborted) throw new AnalysisAbortedError(scope);

    const request = prepare(transcript, 'voice');
    recordInjectionAttempts(request, scope);
    const { result: aiResult } = await orchestrateAnalysis(request, signal);

    if (signal.aborted) throw new AnalysisAbortedError(scope);

    if (aiResult) {
      riskScorer.addSignal('voice-ai', aiResult.value, 1.5);
      const blended = Math.round(aiResult.value * 0.7 + localResult.riskScore * 0.3);
      // Same floor as the text pipeline: an explicit threat heard mid-call
      // must not be averaged away by a model that only sees "not fraud".
      const compositeScore = Math.min(100, Math.max(blended, localResult.riskScore));
      const localOverrode = localResult.riskScore > blended;

      const verdict: ScamAnalysis['verdict'] = riskBand(compositeScore);

      return {
        verdict,
        riskScore: compositeScore,
        tactics: [...new Set([...aiResult.tactics, ...localResult.tactics])],
        explanation: localOverrode
          ? `Se detectaron patrones explicitos de riesgo: ${localResult.tactics.join(', ')}.`
          : (aiResult.explanation || 'Analisis de fragmento de voz.'),
        scanSource: 'hybrid',
        recommendations: aiResult.recommendations ?? ['Mantente alerta durante la conversacion.'],
      };
    }

    return buildFallbackResult(localResult, 0);
  }
}
