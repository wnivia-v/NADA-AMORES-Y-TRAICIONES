// =============================================================================
// Anthropic Claude — de pago
//
// Antes esto llamaba a api.anthropic.com desde el navegador con
// `anthropic-dangerous-direct-browser-access` y la clave inyectada en el bundle.
// El README ya advertia de que no se desplegara asi; ahora simplemente no se
// puede: la clave vive en el servidor (CLAUDE_API_KEY) y el navegador no la ve.
// =============================================================================

import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderSignal } from '@/shared/llm/types';
import { analyzeViaProxy, hasProxy } from './proxyClient';

export const claudeProvider: AIProvider = {
  id: 'claude',
  name: 'Anthropic Claude (de pago)',
  cost: 'paid',

  isAvailable(): boolean {
    return hasProxy();
  },

  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderSignal | null> {
    return analyzeViaProxy('claude', request, signal);
  },
};
