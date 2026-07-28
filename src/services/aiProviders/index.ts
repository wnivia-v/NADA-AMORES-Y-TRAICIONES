// =============================================================================
// AI Providers — Public API
// =============================================================================

export {
  orchestrateAnalysis,
  getProvidersStatus,
  hasWorkingProvider,
  saveProviderConfig,
  getProviderConfig,
} from './orchestrator';
export type { ProviderStatus } from './orchestrator';
export { localProvider } from './localProvider';
export { geminiProvider } from './geminiProvider';
export { groqProvider } from './groqProvider';
export { claudeProvider } from './claudeProvider';
export { bedrockProvider } from './bedrockProvider';
export { getRateLimiter, clearRateLimiters, RateLimiter } from './rateLimiter';
export type { RateLimits } from './rateLimiter';
export type {
  AIProvider,
  AIAnalysisResult,
  ProviderOrchestrationConfig,
  ProviderId,
  ProviderStrategy,
  ProviderCost,
} from './types';
export { DEFAULT_PROVIDER_CONFIG } from './types';
