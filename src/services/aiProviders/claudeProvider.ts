// =============================================================================
// Anthropic Claude — de pago
import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderSignal } from '@/shared/llm/types';
import { analyzeViaProxy, hasProxy } from './proxyClient';

export const claudeProvider: AIProvider = {
  id: 'claude',
  name: 'Anthropic Claude Sonnet 5 (de pago)',
  cost: 'paid',

  isAvailable(): boolean {
    return hasProxy();
  },

  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderSignal | null> {
    return analyzeViaProxy('claude', request, signal);
  },
};
