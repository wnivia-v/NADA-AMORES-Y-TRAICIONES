// =============================================================================
// Groq — tier gratuito, sin tarjeta de credito
//
// Limites publicados al escribir esto: 30 peticiones/minuto y 1000/dia en
// Llama 3.3 70B. Verificar en https://console.groq.com, que cambian.
//
// La clave ya no vive aqui: se lee en el servidor (GROQ_API_KEY). Este archivo
// solo decide si el proveedor esta disponible y delega en el proxy.
// =============================================================================

import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderAnswer } from '@/shared/llm/types';
import { analyzeViaProxy, hasProxy } from './proxyClient';

export const groqProvider: AIProvider = {
  id: 'groq',
  name: 'Groq (Llama, tier gratuito)',
  cost: 'free-tier',
  limits: { rpm: 30, rpd: 1000 },

  isAvailable(): boolean {
    return hasProxy();
  },

  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderAnswer> {
    return analyzeViaProxy('groq', request, signal);
  },
};
