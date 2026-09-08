// =============================================================================
// Anthropic Claude — de pago
import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderAnswer } from '@/shared/llm/types';
import { analyzeViaProxy, hasProxy } from './proxyClient';

export const claudeProvider: AIProvider = {
  id: 'claude',
  name: 'Anthropic Claude Sonnet 5 (de pago)',
  cost: 'paid',

  requires: 'backend',

  isAvailable(): boolean {
    return hasProxy();
  },

  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderAnswer> {
    return analyzeViaProxy('claude', request, signal);
  },
};
