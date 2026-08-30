// =============================================================================
// AI Provider Orchestrator
// Strategies: fallback, race, best-result, consensus
// Picks the best AI response based on configured strategy
// =============================================================================

import type { AIProvider, ProviderOrchestrationConfig, ProviderId } from './types';
import type { AnalysisRequest, ProviderSignal } from '@/shared/llm/types';
import { riskBand } from '@/shared/llm/signalSchema';
import { DEFAULT_PROVIDER_CONFIG } from './types';
import { getRateLimiter } from './rateLimiter';
import { localProvider } from './localProvider';
import { geminiProvider } from './geminiProvider';
import { groqProvider } from './groqProvider';
import { claudeProvider } from './claudeProvider';
import { bedrockProvider } from './bedrockProvider';
import { veniceProvider } from './veniceProvider';

// Registry of all providers
const PROVIDERS: Record<ProviderId, AIProvider> = {
  local: localProvider,
  gemini: geminiProvider,
  groq: groqProvider,
  claude: claudeProvider,
  bedrock: bedrockProvider,
  venice: veniceProvider,
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

type ProviderSuccess = { result: ProviderSignal; providerId: ProviderId };
type ProviderOutcome = ProviderSuccess | null;

/**
 * Single place where a provider is actually called.
 *
 * Owns quota accounting and the per-provider timeout so every strategy behaves
 * identically. Never throws: a failing provider must not abort a strategy that
 * still has other providers to try.
 */
async function callProvider(
  provider: AIProvider,
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<ProviderOutcome> {
  if (signal?.aborted) return null;

  // Claim the request before spending it. Between getActiveProviders() and here
  // a parallel strategy may have consumed the last slot.
  if (!spendQuota(provider)) return null;

  const { timeoutMs } = getConfig();
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal
    ? combineAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    const result = await provider.analyze(request, combinedSignal);
    return result ? { result, providerId: provider.id } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Calls every provider in parallel and keeps only the successful answers. */
async function callAll(
  providers: AIProvider[],
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<ProviderSuccess[]> {
  const settled = await Promise.allSettled(
    providers.map((p) => callProvider(p, request, signal)),
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<ProviderSuccess> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

// =============================================================================
// Strategies
// =============================================================================

// Fallback: try providers in priority order, return first success
async function strategyFallback(
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<{ result: ProviderSignal | null; providerId: ProviderId | null }> {
  for (const provider of getActiveProviders()) {
    if (signal?.aborted) break;
    const outcome = await callProvider(provider, request, signal);
    if (outcome) return outcome;
  }

  return { result: null, providerId: null };
}

// Race: fire all providers simultaneously, return fastest valid response
async function strategyRace(
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<{ result: ProviderSignal | null; providerId: ProviderId | null }> {
  const providers = getActiveProviders();
  if (providers.length === 0) return { result: null, providerId: null };

  const results = await Promise.allSettled(
    providers.map((p) => callProvider(p, request, signal)),
  );

  // Return the first non-null result
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      return r.value;
    }
  }

  return { result: null, providerId: null };
}

// Best-result: fire all, wait for all, return the one with highest confidence
async function strategyBestResult(
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<{ result: ProviderSignal | null; providerId: ProviderId | null }> {
  const providers = getActiveProviders();
  if (providers.length === 0) return { result: null, providerId: null };

  const validResults = await callAll(providers, request, signal);
  if (validResults.length === 0) return { result: null, providerId: null };

  // Pick the result with highest riskScore (most cautious) — protects the user
  // If all are SEGURO, pick lowest riskScore (most confident it's safe)
  const allSafe = validResults.every((r) => riskBand(r.result.value) === 'SEGURO');

  if (allSafe) {
    // Most confident "safe" = lowest score
    validResults.sort((a, b) => a.result.value - b.result.value);
  } else {
    // Most cautious = highest score (protect the user)
    validResults.sort((a, b) => b.result.value - a.result.value);
  }

  return validResults[0] ?? { result: null, providerId: null };
}

// Consensus: fire all, if majority agree on verdict, use that; otherwise use most cautious
async function strategyConsensus(
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<{ result: ProviderSignal | null; providerId: ProviderId | null }> {
  const providers = getActiveProviders();
  if (providers.length === 0) return { result: null, providerId: null };
  if (providers.length === 1) return strategyFallback(request, signal);

  const validResults = await callAll(providers, request, signal);

  if (validResults.length === 0) return { result: null, providerId: null };
  if (validResults.length === 1) return validResults[0] ?? { result: null, providerId: null };

  // Count verdicts
  const verdictCounts: Record<string, number> = {};
  for (const { result } of validResults) {
    const band = riskBand(result.value);
    verdictCounts[band] = (verdictCounts[band] ?? 0) + 1;
  }

  // Check if any verdict reaches consensus threshold
  const threshold = Math.ceil(validResults.length * getConfig().consensusThreshold);
  let consensusVerdict: string | null = null;
  for (const [verdict, count] of Object.entries(verdictCounts)) {
    if (count >= threshold) {
      consensusVerdict = verdict;
      break;
    }
  }

  if (consensusVerdict) {
    // Return the result from consensus group with median risk score
    const consensusResults = validResults.filter((r) => riskBand(r.result.value) === consensusVerdict);
    consensusResults.sort((a, b) => a.result.value - b.result.value);
    const medianIdx = Math.floor(consensusResults.length / 2);
    return consensusResults[medianIdx] ?? { result: null, providerId: null };
  }

  // No consensus: return most cautious (highest risk) to protect user
  validResults.sort((a, b) => b.result.value - a.result.value);
  return validResults[0] ?? { result: null, providerId: null };
}

// =============================================================================
// Main orchestration entry point
// =============================================================================

// =============================================================================
// Orchestration with real-time per-provider progress callbacks
// =============================================================================

export type ProviderProgressStatus = 'pending' | 'thinking' | 'done' | 'error' | 'disabled' | 'no-key';

export interface ProviderProgressEvent {
  providerId: ProviderId;
  providerName: string;
  status: ProviderProgressStatus;
  result: AIAnalysisResult | null;
  durationMs: number | null;
  error?: string;
}

export type ProviderProgressCallback = (event: ProviderProgressEvent) => void;

/**
 * Fires all enabled+available providers simultaneously and streams progress
 * events as each one resolves. Returns the final orchestrated result.
 *
 * This is the entry point for the AI Console Panel so each sub-panel can
 * animate independently as providers respond.
 */
export async function orchestrateAnalysisWithProgress(
  text: string,
  prompt: string,
  onProgress: ProviderProgressCallback,
  signal?: AbortSignal,
): Promise<{ result: AIAnalysisResult | null; providerId: ProviderId | null }> {
  const config = getConfig();

  // Emit initial state: all providers with their status
  for (const [id, provider] of Object.entries(PROVIDERS) as [ProviderId, AIProvider][]) {
    const cfg = config.providers[id];
    if (!cfg?.enabled) {
      onProgress({
        providerId: id,
        providerName: provider.name,
        status: 'disabled',
        result: null,
        durationMs: null,
      });
      continue;
    }
    if (!provider.isAvailable()) {
      onProgress({
        providerId: id,
        providerName: provider.name,
        status: 'no-key',
        result: null,
        durationMs: null,
      });
      continue;
    }
    if (!hasQuota(provider)) {
      onProgress({
        providerId: id,
        providerName: provider.name,
        status: 'error',
        result: null,
        durationMs: null,
        error: 'Cuota agotada',
      });
      continue;
    }
    // Mark as thinking
    onProgress({
      providerId: id,
      providerName: provider.name,
      status: 'thinking',
      result: null,
      durationMs: null,
    });
  }

  const activeProviders = getActiveProviders();

  // Fire all active providers and stream results as they resolve
  const promises = activeProviders.map(async (provider) => {
    const start = Date.now();
    const outcome = await callProvider(provider, text, prompt, signal);
    const durationMs = Date.now() - start;

    onProgress({
      providerId: provider.id,
      providerName: provider.name,
      status: outcome ? 'done' : 'error',
      result: outcome?.result ?? null,
      durationMs,
      error: outcome ? undefined : 'Sin respuesta o timeout',
    });

    return outcome;
  });

  const outcomes = (await Promise.allSettled(promises))
    .filter((r): r is PromiseFulfilledResult<ProviderOutcome> => r.status === 'fulfilled')
    .map((r) => r.value);

  // Apply the configured strategy to the collected results
  const validResults: ProviderSuccess[] = outcomes.filter(
    (o): o is ProviderSuccess => o !== null,
  );

  if (validResults.length === 0) return { result: null, providerId: null };

  switch (config.strategy) {
    case 'best-result': {
      const allSafe = validResults.every((r) => r.result.verdict === 'SEGURO');
      validResults.sort((a, b) =>
        allSafe
          ? a.result.riskScore - b.result.riskScore
          : b.result.riskScore - a.result.riskScore,
      );
      return validResults[0] ?? { result: null, providerId: null };
    }
    case 'consensus': {
      const verdictCounts: Record<string, number> = {};
      for (const { result } of validResults) {
        verdictCounts[result.verdict] = (verdictCounts[result.verdict] ?? 0) + 1;
      }
      const threshold = Math.ceil(validResults.length * config.consensusThreshold);
      let consensusVerdict: string | null = null;
      for (const [verdict, count] of Object.entries(verdictCounts)) {
        if (count >= threshold) { consensusVerdict = verdict; break; }
      }
      if (consensusVerdict) {
        const group = validResults.filter((r) => r.result.verdict === consensusVerdict);
        group.sort((a, b) => a.result.riskScore - b.result.riskScore);
        return group[Math.floor(group.length / 2)] ?? { result: null, providerId: null };
      }
      validResults.sort((a, b) => b.result.riskScore - a.result.riskScore);
      return validResults[0] ?? { result: null, providerId: null };
    }
    case 'race':
    case 'fallback':
    default:
      // Return the first successful result (already ordered by priority via getActiveProviders)
      return validResults[0] ?? { result: null, providerId: null };
  }
}

export async function orchestrateAnalysis(
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<{ result: ProviderSignal | null; providerId: ProviderId | null }> {
  const config = getConfig();

  switch (config.strategy) {
    case 'race':
      return strategyRace(request, signal);
    case 'best-result':
      return strategyBestResult(request, signal);
    case 'consensus':
      return strategyConsensus(request, signal);
    case 'fallback':
    default:
      return strategyFallback(request, signal);
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
}

// Get list of all providers with their availability, cost and remaining quota
export function getProvidersStatus(): ProviderStatus[] {
  const config = getConfig();
  return Object.entries(PROVIDERS).map(([id, provider]) => {
    const snapshot = provider.limits
      ? getRateLimiter(provider.id, provider.limits).snapshot()
      : null;

    return {
      id: id as ProviderId,
      name: provider.name,
      available: provider.isAvailable(),
      enabled: config.providers[id as ProviderId]?.enabled ?? false,
      cost: provider.cost,
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
