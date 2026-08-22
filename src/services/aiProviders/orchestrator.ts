// =============================================================================
// AI Provider Orchestrator
// Strategies: fallback, race, best-result, consensus
// Picks the best AI response based on configured strategy
// =============================================================================

import type {
  AIProvider,
  ProviderOrchestrationConfig,
  ProviderId,
  ProviderRequirement,
  ProviderStrategy,
} from './types';
import type { AnalysisRequest, ProviderSignal } from '@/shared/llm/types';
import type { Deliberation, DecisionReason, ProviderRun } from '@/shared/llm/deliberation';
import { findSuspicions } from '@/shared/llm/deliberation';
import { riskBand } from '@/shared/llm/signalSchema';
import { DEFAULT_PROVIDER_CONFIG } from './types';
import { getRateLimiter } from './rateLimiter';
import { localProvider } from './localProvider';
import { geminiProvider } from './geminiProvider';
import { groqProvider } from './groqProvider';
import { claudeProvider } from './claudeProvider';
import { bedrockProvider } from './bedrockProvider';

// Registry of all providers
const PROVIDERS: Record<ProviderId, AIProvider> = {
  local: localProvider,
  gemini: geminiProvider,
  groq: groqProvider,
  claude: claudeProvider,
  bedrock: bedrockProvider,
};

/**
 * True when the provider still has free-tier allowance left.
 * Providers without published limits (the local one) are always allowed.
 */
function hasQuota(provider: AIProvider): boolean {
  if (!provider.limits) return true;
  return getRateLimiter(provider.id, provider.limits).canRequest();
}

/** Spends one request from the provider's quota. False when exhausted. */
function spendQuota(provider: AIProvider): boolean {
  if (!provider.limits) return true;
  return getRateLimiter(provider.id, provider.limits).tryAcquire();
}

// Get config from localStorage or use defaults
function getConfig(): ProviderOrchestrationConfig {
  try {
    const stored = localStorage.getItem('nada-ai-config');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge provider-level config but always respect DEFAULT priorities
      // so that code changes take effect even when localStorage has old data.
      const mergedProviders = { ...DEFAULT_PROVIDER_CONFIG.providers };
      if (parsed.providers) {
        for (const id of Object.keys(mergedProviders) as Array<keyof typeof mergedProviders>) {
          if (parsed.providers[id]) {
            mergedProviders[id] = {
              ...DEFAULT_PROVIDER_CONFIG.providers[id],
              // Only inherit user-chosen enabled flag, not stale priorities
              enabled: parsed.providers[id].enabled ?? DEFAULT_PROVIDER_CONFIG.providers[id].enabled,
            };
          }
        }
      }
      return {
        ...DEFAULT_PROVIDER_CONFIG,
        ...parsed,
        providers: mergedProviders,
      };
    }
  } catch { /* use defaults */ }
  return DEFAULT_PROVIDER_CONFIG;
}

export function saveProviderConfig(config: Partial<ProviderOrchestrationConfig>) {
  const current = getConfig();
  const updated = { ...current, ...config };
  localStorage.setItem('nada-ai-config', JSON.stringify(updated));
}

export function getProviderConfig(): ProviderOrchestrationConfig {
  return getConfig();
}

/**
 * Enabled, available providers that still have quota, in priority order.
 *
 * Quota is part of availability on purpose: a provider whose free tier is spent
 * would return HTTP 429, which surfaces as a null result and silently degrades
 * the verdict to local-only. Skipping it here means the next provider actually
 * gets a chance instead.
 */
function getActiveProviders(): AIProvider[] {
  const config = getConfig();
  return Object.entries(config.providers)
    .filter(([id, cfg]) => {
      const provider = PROVIDERS[id as ProviderId];
      return cfg.enabled && provider?.isAvailable() && hasQuota(provider);
    })
    .sort(([, a], [, b]) => a.priority - b.priority)
    .map(([id]) => PROVIDERS[id as ProviderId])
    .filter((p): p is AIProvider => Boolean(p));
}

// =============================================================================
// Provider invocation
// =============================================================================

/**
 * Single place where a provider is actually called.
 *
 * Owns quota accounting and the per-provider timeout so every strategy behaves
 * identically. Never throws: a failing provider must not abort a strategy that
 * still has other providers to try.
 *
 * Devuelve un ProviderRun y no una señal suelta porque el acta necesita el
 * reloj y el motivo, no solo el resultado. Medir aqui —y no en cada estrategia—
 * es lo que hace que "gano por rapida" se pueda comprobar en vez de creer.
 */
async function callProvider(
  provider: AIProvider,
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<ProviderRun> {
  const base = { id: provider.id, name: provider.name };

  if (signal?.aborted) {
    return { ...base, outcome: 'not-reached', ms: null, signal: null, detail: 'analisis cancelado' };
  }

  // Claim the request before spending it. Between getActiveProviders() and here
  // a parallel strategy may have consumed the last slot.
  if (!spendQuota(provider)) {
    return { ...base, outcome: 'no-quota', ms: null, signal: null, detail: 'tier gratuito agotado' };
  }

  const { timeoutMs } = getConfig();
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);
  const combinedSignal = signal
    ? combineAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  const started = now();
  try {
    const answer = await provider.analyze(request, combinedSignal);
    const ms = Math.round(now() - started);

    if (answer.signal) return { ...base, outcome: 'answered', ms, signal: answer.signal };
    if (timedOut) {
      return { ...base, outcome: 'timeout', ms, signal: null, detail: `sin respuesta en ${timeoutMs} ms` };
    }
    if (answer.rejection) {
      return { ...base, outcome: 'rejected', ms, signal: null, rejection: answer.rejection, detail: answer.detail };
    }
    if (answer.transport) {
      return { ...base, outcome: 'failed', ms, signal: null, transport: answer.transport, detail: answer.detail };
    }
    // Sin señal, sin rechazo y sin fallo: se abstuvo a proposito.
    return { ...base, outcome: 'abstained', ms, signal: null, detail: answer.detail };
  } catch (e) {
    const ms = Math.round(now() - started);
    if (timedOut) {
      return { ...base, outcome: 'timeout', ms, signal: null, detail: `sin respuesta en ${timeoutMs} ms` };
    }
    return {
      ...base,
      outcome: 'failed',
      ms,
      signal: null,
      detail: e instanceof Error ? e.name : 'excepcion sin tipo',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Reloj monotono cuando lo hay: Date.now() salta si el sistema ajusta la hora. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Los que contestaron con señal valida, en el orden en que se lanzaron. */
function answeredRuns(runs: ProviderRun[]): ProviderRun[] {
  return runs.filter((r) => r.outcome === 'answered' && r.signal);
}

/** Calls every provider in parallel and keeps every run, contestara o no. */
function callAll(
  providers: AIProvider[],
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<ProviderRun[]> {
  return Promise.all(providers.map((p) => callProvider(p, request, signal)));
}

/**
 * Los que ni se llamaron, para que el acta los enseñe igual.
 *
 * Un panel que solo muestra a quien participo no deja ver la razon mas comun de
 * que "solo opinara una IA": que las otras estaban apagadas o sin configurar.
 */
function idleRuns(active: AIProvider[]): ProviderRun[] {
  const config = getConfig();
  const activeIds = new Set(active.map((p) => p.id));
  const out: ProviderRun[] = [];

  for (const [id, provider] of Object.entries(PROVIDERS) as Array<[ProviderId, AIProvider]>) {
    if (activeIds.has(id)) continue;
    const enabled = config.providers[id]?.enabled ?? false;
    const base = { id, name: provider.name, ms: null, signal: null };

    if (!enabled) {
      out.push({ ...base, outcome: 'disabled', detail: 'apagado en ajustes' });
    } else if (!provider.isAvailable()) {
      out.push({ ...base, outcome: 'unavailable', detail: 'habilitado pero sin configurar' });
    } else {
      out.push({ ...base, outcome: 'no-quota', detail: 'tier gratuito agotado' });
    }
  }
  return out;
}

// =============================================================================
// Strategies
//
// Todas devuelven el acta completa. La estrategia elige al ganador; el acta
// explica por que, y esa explicacion es una union cerrada y no una frase, para
// que se pueda comprobar dato a dato.
// =============================================================================

interface StrategyOutcome {
  runs: ProviderRun[];
  winner: ProviderRun | null;
  reason: DecisionReason;
}

// Fallback: try providers in priority order, return first success
async function strategyFallback(
  providers: AIProvider[],
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  const runs: ProviderRun[] = [];
  const skipped: string[] = [];

  for (const provider of providers) {
    if (signal?.aborted) break;
    const run = await callProvider(provider, request, signal);
    runs.push(run);
    if (run.outcome === 'answered') {
      // Los de detras nunca se llamaron: la cadena se corto aqui, y eso se dice.
      for (const rest of providers.slice(providers.indexOf(provider) + 1)) {
        runs.push({
          id: rest.id,
          name: rest.name,
          outcome: 'not-reached',
          ms: null,
          signal: null,
          detail: `la cadena se corto en ${run.name}`,
        });
      }
      return { runs, winner: run, reason: { kind: 'first-available', skipped } };
    }
    skipped.push(provider.id);
  }

  return { runs, winner: null, reason: { kind: 'silence' } };
}

/**
 * Race: gana quien conteste ANTES. De verdad, esta vez.
 *
 * Lo que habia aqui hacia Promise.allSettled —esperar a TODOS— y despues
 * recorria el array devolviendo el primero no nulo. Como el array viene
 * ordenado por prioridad, el ganador era el de mayor prioridad, no el mas
 * rapido: la semantica de `fallback` pagando la latencia del proveedor mas
 * lento. Peor que las dos cosas, y era la estrategia por defecto.
 *
 * Ahora la decision se cierra en cuanto una respuesta valida llega. Los demas
 * quedan en el acta como 'still-running', que no es una averia: es la prueba de
 * que la carrera existio.
 */
function strategyRace(
  providers: AIProvider[],
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  return new Promise((resolve) => {
    const runs = new Map<ProviderId, ProviderRun>();
    let settled = false;
    let pending = providers.length;

    const finishWithSilence = () => {
      resolve({
        runs: providers.map((p) => runs.get(p.id)!).filter(Boolean),
        winner: null,
        reason: { kind: 'silence' },
      });
    };

    for (const provider of providers) {
      void callProvider(provider, request, signal).then((run) => {
        pending -= 1;
        if (settled) {
          // Llego tarde: la decision ya estaba tomada. Se guarda igualmente por
          // si alguien mira el acta despues, pero no cambia el resultado.
          runs.set(provider.id, run);
          return;
        }
        runs.set(provider.id, run);

        if (run.outcome === 'answered') {
          settled = true;
          const stillRunning = providers
            .filter((p) => !runs.has(p.id))
            .map((p) => p.id);
          for (const id of stillRunning) {
            const late = providers.find((p) => p.id === id)!;
            runs.set(id, {
              id,
              name: late.name,
              outcome: 'still-running',
              ms: null,
              signal: null,
              detail: `seguia pensando cuando ${run.name} contesto en ${run.ms} ms`,
            });
          }
          resolve({
            runs: providers.map((p) => runs.get(p.id)!).filter(Boolean),
            winner: run,
            reason: { kind: 'fastest', ms: run.ms ?? 0, stillRunning },
          });
          return;
        }

        if (pending === 0) {
          settled = true;
          finishWithSilence();
        }
      });
    }

    if (providers.length === 0) {
      settled = true;
      finishWithSilence();
    }
  });
}

// Best-result: fire all, wait for all, return the one with highest confidence
async function strategyBestResult(
  providers: AIProvider[],
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  const runs = await callAll(providers, request, signal);
  const valid = answeredRuns(runs);
  if (valid.length === 0) return { runs, winner: null, reason: { kind: 'silence' } };
  if (valid.length === 1) return { runs, winner: valid[0]!, reason: { kind: 'sole-answer' } };

  // Pick the result with highest riskScore (most cautious) — protects the user
  // If all are SEGURO, pick lowest riskScore (most confident it's safe)
  const allSafe = valid.every((r) => riskBand(r.signal!.value) === 'SEGURO');
  const sorted = [...valid].sort((a, b) =>
    allSafe ? a.signal!.value - b.signal!.value : b.signal!.value - a.signal!.value,
  );

  return {
    runs,
    winner: sorted[0]!,
    reason: allSafe
      ? { kind: 'most-confident-safe', among: valid.length }
      : { kind: 'most-cautious', among: valid.length },
  };
}

// Consensus: fire all, if majority agree on verdict, use that; otherwise use most cautious
async function strategyConsensus(
  providers: AIProvider[],
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  const runs = await callAll(providers, request, signal);
  const valid = answeredRuns(runs);

  if (valid.length === 0) return { runs, winner: null, reason: { kind: 'silence' } };
  if (valid.length === 1) return { runs, winner: valid[0]!, reason: { kind: 'sole-answer' } };

  const verdictCounts: Record<string, number> = {};
  for (const run of valid) {
    const band = riskBand(run.signal!.value);
    verdictCounts[band] = (verdictCounts[band] ?? 0) + 1;
  }

  const threshold = Math.ceil(valid.length * getConfig().consensusThreshold);
  let consensusVerdict: string | null = null;
  for (const [verdict, count] of Object.entries(verdictCounts)) {
    if (count >= threshold) {
      consensusVerdict = verdict;
      break;
    }
  }

  if (consensusVerdict) {
    const agreeing = valid.filter((r) => riskBand(r.signal!.value) === consensusVerdict);
    const dissenting = valid.filter((r) => riskBand(r.signal!.value) !== consensusVerdict);
    const sorted = [...agreeing].sort((a, b) => a.signal!.value - b.signal!.value);
    const median = sorted[Math.floor(sorted.length / 2)]!;

    return {
      runs,
      winner: median,
      reason: {
        kind: 'consensus',
        band: consensusVerdict,
        agreeing: agreeing.map((r) => r.id),
        dissenting: dissenting.map((r) => r.id),
        threshold,
      },
    };
  }

  // No consensus: return most cautious (highest risk) to protect user
  const sorted = [...valid].sort((a, b) => b.signal!.value - a.signal!.value);
  return {
    runs,
    winner: sorted[0]!,
    reason: {
      kind: 'no-consensus',
      bands: [...new Set(valid.map((r) => riskBand(r.signal!.value)))],
    },
  };
}

// =============================================================================
// Main orchestration entry point
// =============================================================================

export interface OrchestrationResult {
  result: ProviderSignal | null;
  providerId: ProviderId | null;
  /** El acta. Se levanta siempre; mirarla o no es cosa de quien llama. */
  deliberation: Deliberation;
}

export async function orchestrateAnalysis(
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<OrchestrationResult> {
  const config = getConfig();
  const providers = getActiveProviders();
  const started = now();

  // Con uno solo no hay nada que carrear ni consensuar, sea cual sea la
  // estrategia elegida: se le pregunta y ya.
  const outcome =
    providers.length === 0
      ? { runs: [], winner: null, reason: { kind: 'silence' } as DecisionReason }
      : providers.length === 1
        ? await strategyFallback(providers, request, signal)
        : await runStrategy(config.strategy, providers, request, signal);

  const runs = [...outcome.runs, ...idleRuns(providers)];
  const injectionIds = request.hardening.injectionAttempts.map((a) => a.id);

  return {
    result: outcome.winner?.signal ?? null,
    providerId: (outcome.winner?.id as ProviderId | undefined) ?? null,
    deliberation: {
      strategy: providers.length === 1 ? 'fallback' : config.strategy,
      runs,
      winner: (outcome.winner?.id as ProviderId | undefined) ?? null,
      reason:
        providers.length === 1 && outcome.winner
          ? { kind: 'sole-answer' }
          : outcome.reason,
      injectionIds,
      suspicions: findSuspicions(runs, injectionIds.length > 0),
      totalMs: Math.round(now() - started),
    },
  };
}

function runStrategy(
  strategy: ProviderStrategy,
  providers: AIProvider[],
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  switch (strategy) {
    case 'race':
      return strategyRace(providers, request, signal);
    case 'best-result':
      return strategyBestResult(providers, request, signal);
    case 'consensus':
      return strategyConsensus(providers, request, signal);
    case 'fallback':
    default:
      return strategyFallback(providers, request, signal);
  }
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  available: boolean;
  enabled: boolean;
  cost: AIProvider['cost'];
  /** Remaining free-tier allowance, null when the provider has no quota. */
  quota: { minuteRemaining: number; dayRemaining: number } | null;
  /** Que le falta, cuando no esta disponible. null si lo esta. */
  missing: ProviderRequirement | null;
}

// Get list of all providers with their availability, cost and remaining quota
export function getProvidersStatus(): ProviderStatus[] {
  const config = getConfig();
  return Object.entries(PROVIDERS).map(([id, provider]) => {
    const snapshot = provider.limits
      ? getRateLimiter(provider.id, provider.limits).snapshot()
      : null;
    const disponible = provider.isAvailable();

    return {
      id: id as ProviderId,
      name: provider.name,
      available: disponible,
      enabled: config.providers[id as ProviderId]?.enabled ?? false,
      cost: provider.cost,
      missing: disponible ? null : provider.requires,
      quota: snapshot
        ? { minuteRemaining: snapshot.minuteRemaining, dayRemaining: snapshot.dayRemaining }
        : null,
    };
  });
}

/**
 * True when at least one enabled provider can serve a request right now.
 * Used by the UI to tell the user whether AI analysis is actually working.
 */
export function hasWorkingProvider(): boolean {
  return getActiveProviders().length > 0;
}

// =============================================================================
// Utilities
// =============================================================================

function combineAbortSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
  const controller = new AbortController();

  const abort = () => controller.abort();

  if (signal1.aborted || signal2.aborted) {
    controller.abort();
    return controller.signal;
  }

  signal1.addEventListener('abort', abort, { once: true });
  signal2.addEventListener('abort', abort, { once: true });

  return controller.signal;
}
