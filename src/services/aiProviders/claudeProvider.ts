// =============================================================================
// Claude Provider — Anthropic API (Claude Sonnet 5 / Haiku 4.5)
// Direct REST API call (no SDK needed for browser)
// =============================================================================

import type { AIProvider, AIAnalysisResult } from './types';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

function getApiKey(): string {
  return import.meta.env.VITE_CLAUDE_API_KEY || '';
}

function getModel(): string {
  return import.meta.env.VITE_CLAUDE_MODEL || 'claude-sonnet-5';
}

export const claudeProvider: AIProvider = {
  id: 'claude',
  name: 'Anthropic Claude Sonnet 5 (de pago)',
  cost: 'paid',

  isAvailable(): boolean {
    return Boolean(getApiKey());
  },

  async analyze(text: string, prompt: string, signal?: AbortSignal): Promise<AIAnalysisResult | null> {
    if (signal?.aborted) return null;

    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
      const finalPrompt = prompt.replace('{{TEXT}}', text);

      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: finalPrompt,
            },
          ],
        }),
        signal,
      });

      if (signal?.aborted) return null;
      if (!response.ok) {
        console.warn(`[NADA][Claude] API error: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const content = data.content?.[0]?.text ?? '';

      // Extract JSON from response
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
      console.warn('[NADA][Claude] Analysis error:', e);
      return null;
    }
  },
};
