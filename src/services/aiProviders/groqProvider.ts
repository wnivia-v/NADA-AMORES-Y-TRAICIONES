// =============================================================================
// Groq Provider — free tier, no credit card
//
// Published free limits at time of writing: 30 requests/minute and 1000
// requests/day on the Llama 3.3 70B model. Verify at https://console.groq.com
// since these change.
//
// Same caveat as Claude: the key is read from import.meta.env, which Vite inlines
// into the client bundle. Fine for local and desktop use, not for a public
// deployment — see the `deploy` agent notes.
// =============================================================================

import type { AIProvider, AIAnalysisResult } from './types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function getApiKey(): string {
  return import.meta.env.VITE_GROQ_API_KEY || '';
}

function getModel(): string {
  return import.meta.env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile';
}

export const groqProvider: AIProvider = {
  id: 'groq',
  name: 'Groq (Llama, tier gratuito)',
  cost: 'free-tier',
  limits: { rpm: 30, rpd: 1000 },

  isAvailable(): boolean {
    return Boolean(getApiKey());
  },

  async analyze(text: string, prompt: string, signal?: AbortSignal): Promise<AIAnalysisResult | null> {
    if (signal?.aborted) return null;

    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
      const finalPrompt = prompt.replace('{{TEXT}}', text);

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: getModel(),
          messages: [{ role: 'user', content: finalPrompt }],
          max_tokens: 1024,
          temperature: 0,
          // Ask for JSON directly instead of hoping the model complies.
          response_format: { type: 'json_object' },
        }),
        signal,
      });

      if (signal?.aborted) return null;
      if (!response.ok) {
        console.warn(`[NADA][Groq] API error: ${response.status}`);
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
      console.warn('[NADA][Groq] Analysis error:', e);
      return null;
    }
  },
};
