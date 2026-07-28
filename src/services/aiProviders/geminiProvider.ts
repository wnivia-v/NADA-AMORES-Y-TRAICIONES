// =============================================================================
// Gemini Provider — Firebase AI (Gemini 2.0 Flash)
// =============================================================================

import { app, hasValidConfig } from '../firebaseConfig';
import type { AIProvider, AIAnalysisResult } from './types';

let geminiModel: any = null;

async function getModel() {
  if (geminiModel) return geminiModel;
  if (!hasValidConfig || !app) return null;

  try {
    const { getGenerativeModel, getAI } = await import('firebase/ai');
    const ai = getAI(app);
    geminiModel = getGenerativeModel(ai, { model: 'gemini-2.0-flash' });
    return geminiModel;
  } catch (e) {
    console.warn('[NADA][Gemini] Model init failed:', e);
    return null;
  }
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  name: 'Google Gemini 2.0 Flash',
  cost: 'free-tier',
  // Gemini Developer API free tier. It requires the Firebase project to stay on
  // the no-cost Spark plan (i.e. NOT linked to Cloud Billing). Kept slightly
  // under the published 15 RPM so a burst does not trip a 429.
  limits: { rpm: 14, rpd: 1400 },

  isAvailable(): boolean {
    return hasValidConfig && app !== null;
  },

  async analyze(text: string, prompt: string, signal?: AbortSignal): Promise<AIAnalysisResult | null> {
    if (signal?.aborted) return null;

    const model = await getModel();
    if (!model) return null;

    try {
      const finalPrompt = prompt.replace('{{TEXT}}', text);
      const result = await model.generateContent(finalPrompt);

      if (signal?.aborted) return null;

      const response = result.response.text();

      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
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
      console.warn('[NADA][Gemini] Analysis error:', e);
      return null;
    }
  },
};
