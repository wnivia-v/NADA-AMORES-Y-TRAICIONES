// =============================================================================
// Gemini — Firebase AI Logic (Gemini 2.0 Flash)
//
// Unico proveedor de nube que sigue llamandose desde el cliente, y a proposito:
// Firebase AI Logic esta diseñado para uso desde el navegador y se protege con
// App Check (reCAPTCHA Enterprise), no con una clave secreta que haya que
// esconder. `VITE_FIREBASE_API_KEY` es un identificador de proyecto publico, no
// una credencial — a diferencia de las de Groq o Claude, que ya se movieron al
// servidor.
//
// La separacion de roles se consigue con `systemInstruction`: las instrucciones
// van por su canal y el mensaje por el turno del usuario. Nunca se concatenan.
// =============================================================================

import { app, hasValidConfig } from '../firebaseConfig';
import type { AIProvider } from './types';
import type { AnalysisRequest, AnalysisTask, ProviderSignal } from '@/shared/llm/types';
import { systemPromptFor, renderUserContent } from '@/shared/llm/envelope';
import { parseProviderSignal } from '@/shared/llm/signalSchema';

// Un modelo por tarea: la instruccion de sistema se fija al construirlo.
const models = new Map<AnalysisTask, unknown>();

async function getModel(task: AnalysisTask): Promise<any> {
  const cached = models.get(task);
  if (cached) return cached;
  if (!hasValidConfig || !app) return null;

  try {
    const { getGenerativeModel, getAI } = await import('firebase/ai');
    const ai = getAI(app);
    const model = getGenerativeModel(ai, {
      model: 'gemini-2.0-flash',
      systemInstruction: systemPromptFor(task),
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });
    models.set(task, model);
    return model;
  } catch (e) {
    console.warn('[NADA][Gemini] Model init failed:', e);
    return null;
  }
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  name: 'Google Gemini 2.0 Flash',
  cost: 'free-tier',
  // Tier gratuito de la Gemini Developer API. Exige que el proyecto de Firebase
  // siga en el plan Spark (sin Cloud Billing vinculado). Un poco por debajo de
  // los 15 RPM publicados para que una rafaga no dispare un 429.
  limits: { rpm: 14, rpd: 1400 },

  isAvailable(): boolean {
    return hasValidConfig && app !== null;
  },

  async analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderSignal | null> {
    if (signal?.aborted) return null;

    const model = await getModel(request.task);
    if (!model) return null;

    try {
      const result = await model.generateContent(renderUserContent(request));
      if (signal?.aborted) return null;

      // Validacion cerrada: si la respuesta no encaja en el esquema, no hay
      // señal. Antes se rellenaba con verdict 'SEGURO' y riskScore 0.
      const { signal: parsed, rejection } = parseProviderSignal(result.response.text());
      if (rejection) console.warn(`[NADA][Gemini] respuesta descartada (${rejection})`);
      return parsed;
    } catch (e) {
      if (signal?.aborted) return null;
      console.warn('[NADA][Gemini] Analysis error:', e);
      return null;
    }
  },
};

/** Test helper: olvida los modelos cacheados. */
export function resetGeminiProvider() {
  models.clear();
}
