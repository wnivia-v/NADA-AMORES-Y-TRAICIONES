// Groq — tier gratuito, sin tarjeta de credito
import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderAnswer } from '@/shared/llm/types';
import { analyzeViaProxy, hasProxy } from './proxyClient';

export const groqProvider: AIProvider = {
  id: 'groq',
  name: 'Groq (Llama 3.3 70B, gratis)',
  cost: 'free-tier',
  limits: { rpm: 30, rpd: 1000 },

  requires: 'backend',

  isAvailable(): boolean {
    return hasProxy();
  },

  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderAnswer> {
    return analyzeViaProxy('groq', request, signal);
  },
};
