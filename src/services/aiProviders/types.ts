// =============================================================================
// AI Provider Abstraction Layer — Types & Interfaces
//
// NADA is designed to work with no paid account and no API key at all. The
// provider list is ordered accordingly: `local` runs on the user's own machine,
// then the free-tier cloud providers, and only then anything that needs billing.
// =============================================================================

import type { RateLimits } from './rateLimiter';

export interface AIAnalysisResult {
  verdict: 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';
  riskScore: number;
  tactics: string[];
  explanation: string;
  recommendations: string[];
}

export interface AIProviderConfig {
  enabled: boolean;
  priority: number; // Lower = higher priority (1 = first choice)
  apiKey?: string;
  region?: string;
  model?: string;
}

export type ProviderStrategy = 'fallback' | 'race' | 'best-result' | 'consensus';

export type ProviderId = 'local' | 'gemini' | 'groq' | 'claude' | 'bedrock';

/** How a provider is paid for. Surfaced in the UI so the cost is never a surprise. */
export type ProviderCost = 'free-local' | 'free-tier' | 'paid';

export interface AIProvider {
  id: ProviderId;
  name: string;
  /** Where the analysis runs and what it costs the user. */
  cost: ProviderCost;
  /** Published quota for the free tier, used to avoid 429s. Omit if unlimited. */
  limits?: RateLimits;
  isAvailable(): boolean;
  analyze(text: string, prompt: string, signal?: AbortSignal): Promise<AIAnalysisResult | null>;
}

export interface ProviderOrchestrationConfig {
  strategy: ProviderStrategy;
  providers: Record<ProviderId, AIProviderConfig>;
  timeoutMs: number; // Max time to wait for any single provider
  consensusThreshold: number; // For consensus strategy: how many must agree (0-1)
}

/**
 * Defaults assume a user who has configured nothing.
 *
 * `local` is enabled and first because it needs no key, no account and no
 * network, and because it keeps a fraud victim's messages on their own device.
 * `gemini` is second: its free tier needs no credit card, but it does require a
 * Firebase project. `bedrock` is last and off — it cannot work without a proxy
 * the user has to deploy themselves.
 */
export const DEFAULT_PROVIDER_CONFIG: ProviderOrchestrationConfig = {
  strategy: 'fallback',
  providers: {
    local: { enabled: true, priority: 1 },  // Primero: siempre disponible, sin red, sin clave
    groq: { enabled: true, priority: 2 },   // Segundo: gratis, rápido, si hay API key
    gemini: { enabled: true, priority: 3 }, // Tercero: Firebase AI
    claude: { enabled: false, priority: 4 },
    bedrock: { enabled: false, priority: 5 },
  },
  timeoutMs: 8000, // Reducido de 15s a 8s para evitar que se quede colgado
  consensusThreshold: 0.66,
};
