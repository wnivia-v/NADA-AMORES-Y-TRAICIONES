// =============================================================================
// AWS Bedrock — via el proxy propio que despliega cada quien
//
// Bedrock exige firma SigV4, imposible desde el navegador sin exponer
// credenciales de AWS. Sigue haciendo falta un API Gateway + Lambda propio; lo
// que cambia es que ahora el servidor de NADA habla con el, no el navegador.
//
// El contrato hacia ese proxy es { model, system, messages, max_tokens }:
// instrucciones y mensaje separados, no concatenados. Ver server/src/upstreams.ts.
// =============================================================================

import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderAnswer } from '@/shared/llm/types';
import { analyzeViaProxy, hasProxy } from './proxyClient';

export const bedrockProvider: AIProvider = {
  id: 'bedrock',
  name: 'AWS Bedrock (requiere proxy propio)',
  cost: 'paid',

  isAvailable(): boolean {
    return hasProxy();
  },

  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderAnswer> {
    return analyzeViaProxy('bedrock', request, signal);
  },
};
