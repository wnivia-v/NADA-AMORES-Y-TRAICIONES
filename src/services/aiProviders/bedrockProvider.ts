// =============================================================================
// AWS Bedrock Provider — Via proxy/gateway endpoint
// Supports Claude on Bedrock, Titan, or any Bedrock model
// Requires a backend proxy (API Gateway + Lambda) since Bedrock uses AWS Sig v4
// =============================================================================

import type { AIProvider, AIAnalysisResult } from './types';

function getEndpoint(): string {
  return import.meta.env.VITE_BEDROCK_ENDPOINT || '';
}

function getApiKey(): string {
  // API key for the proxy gateway (not raw AWS credentials)
  return import.meta.env.VITE_BEDROCK_API_KEY || '';
}

function getModel(): string {
  return import.meta.env.VITE_BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0';
}

export const bedrockProvider: AIProvider = {
  id: 'bedrock',
  name: 'AWS Bedrock (requiere proxy propio)',
  cost: 'paid',

  isAvailable(): boolean {
    return Boolean(getEndpoint() && getApiKey());
  },

  async analyze(text: string, prompt: string, signal?: AbortSignal): Promise<AIAnalysisResult | null> {
    if (signal?.aborted) return null;

    const endpoint = getEndpoint();
    const apiKey = getApiKey();
    if (!endpoint || !apiKey) return null;

    try {
      const finalPrompt = prompt.replace('{{TEXT}}', text);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          model: getModel(),
          prompt: finalPrompt,
          max_tokens: 1024,
        }),
        signal,
      });

      if (signal?.aborted) return null;
      if (!response.ok) {
        console.warn(`[NADA][Bedrock] API error: ${response.status}`);
        return null;
      }

      const data = await response.json();

      // The proxy should normalize the response, but we handle common formats
      const content = data.content ?? data.completion ?? data.body ?? '';
      const textContent = typeof content === 'string' ? content : content?.[0]?.text ?? JSON.stringify(content);

      // Extract JSON from response
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        verdict: parsed.verdict ?? 'SEGURO',
        riskScore: Math.min(100, Math.max(0, parsed.riskScore ?? 0)),
        tactics: parsed.tactics ?? [],
        explanation: parsed.explanation ?? '',
        recommendations: parsed.recommendations ?? [],
      };
    } catch (e) {
      if (signal?.aborted) return null;
      console.warn('[NADA][Bedrock] Analysis error:', e);
      return null;
    }
  },
};
