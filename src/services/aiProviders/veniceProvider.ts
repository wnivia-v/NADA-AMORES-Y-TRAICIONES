// =============================================================================
// Venice.ai Provider — free tier con modelos de privacidad primero
//
// Venice.ai ofrece modelos open-source con privacidad: no almacena conversaciones.
// API compatible con OpenAI. Requiere clave de API gratuita en venice.ai
//
// CORS: En dev usamos proxy /api/venice/* -> https://api.venice.ai/*
// En producción (Electron) se llama directamente.
// =============================================================================

import type { AIProvider, AIAnalysisResult } from './types';

const IS_DEV_BROWSER =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const VENICE_API_URL = IS_DEV_BROWSER
  ? '/api/venice/api/v1/chat/completions'
  : 'https://api.venice.ai/api/v1/chat/completions';

function getApiKey(): string {
  return import.meta.env.VITE_VENICE_API_KEY || '';
}

function getModel(): string {
  return import.meta.env.VITE_VENICE_MODEL || 'llama-3.3-70b';
}

export const veniceProvider: AIProvider = {
  id: 'venice',
  name: 'Venice.ai (Llama 3.3 70B, privacidad)',
  cost: 'free-tier',
  limits: { rpm: 20, rpd: 500 },

  isAvailable(): boolean {
    return Boolean(getApiKey());
  },

  async analyze(text: string, prompt: string, signal?: AbortSignal): Promise<AIAnalysisResult | null> {
    if (signal?.aborted) return null;

    const apiKey = getApiKey();
    if (!apiKey) return null;

    const modelsToTry = [getModel(), 'llama-3.3-70b', 'llama-3.2-3b', 'qwen-2.5-7b', 'default'];
    const uniqueModels = [...new Set(modelsToTry)];

    for (const model of uniqueModels) {
      if (signal?.aborted) return null;

      try {
        const finalPrompt = prompt.replace('{{TEXT}}', text);

        const response = await fetch(VENICE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: finalPrompt }],
            max_tokens: 1024,
            temperature: 0,
          }),
          signal,
        });

        if (signal?.aborted) return null;

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.warn(`[NADA][Venice] Model ${model} returned ${response.status}: ${errText}`);
          if (response.status === 404) {
            continue; // Try next model
          }
          return null;
        }

        const data = await response.json();
        const content: string = data.choices?.[0]?.message?.content ?? '';

        const jsonMatch = content.match(/\{[\s\S]*\}/);
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
        console.warn(`[NADA][Venice] Error with model ${model}:`, e);
      }
    }
    return null;
  },
};
