// =============================================================================
// Venice.ai Provider — free tier con modelos de privacidad primero
//
// Venice.ai ofrece modelos open-source con privacidad: no almacena conversaciones.
// API compatible con OpenAI. Requiere clave de API gratuita en venice.ai
//
// La clave vive ahora en el servidor (VENICE_API_KEY, sin prefijo VITE_), igual
// que Groq, Claude y Bedrock. Antes se inyectaba en el bundle del cliente con
// VITE_VENICE_API_KEY y cualquiera que abriera dist/assets/*.js se la llevaba.
// =============================================================================

import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderSignal } from '@/shared/llm/types';
import { analyzeViaProxy, hasProxy } from './proxyClient';

export const veniceProvider: AIProvider = {
  id: 'venice',
  name: 'Venice.ai (Llama 3.3 70B, privacidad)',
  cost: 'free-tier',
  limits: { rpm: 20, rpd: 500 },

  isAvailable(): boolean {
    return hasProxy();
  },

  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderSignal | null> {
    return analyzeViaProxy('venice', request, signal);
  },
};
