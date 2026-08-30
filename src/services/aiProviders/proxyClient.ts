// =============================================================================
// Cliente del backend de NADA
//
// Groq, Claude y Bedrock ya no se llaman desde el navegador. Sus claves vivian
// en `import.meta.env.VITE_*`, y Vite inyecta esas variables en el bundle en
// texto plano: quien abriera `dist/assets/*.js` se llevaba la clave y la cuota.
// Ahora la peticion va al servidor de NADA, que guarda las claves en su propio
// entorno y valida la respuesta del modelo antes de devolverla.
//
// Gemini es la excepcion y sigue en el cliente: Firebase AI Logic esta diseñado
// para uso desde el navegador y se protege con App Check, no con una clave
// secreta. Meterlo en el proxy no ganaria nada.
// =============================================================================

import type { AnalysisRequest, HardeningReport, ProviderSignal } from '@/shared/llm/types';

/** URL del backend. Sin ella, los proveedores remotos quedan no disponibles. */
export function proxyBaseUrl(): string {
  return (import.meta.env.VITE_NADA_API_URL || '').replace(/\/+$/, '');
}

export function hasProxy(): boolean {
  return proxyBaseUrl().length > 0;
}

export interface ProxyResponse {
  signal: ProviderSignal | null;
  rejection?: string;
  hardening?: HardeningReport;
}

/**
 * Pide un analisis al backend.
 *
 * Devuelve null ante cualquier fallo de transporte. Un error de red no puede
 * convertirse en "no hay riesgo": el orquestador lo trata como proveedor que no
 * contesto y sigue con los demas, o cae al camino local.
 */
export async function analyzeViaProxy(
  provider: 'groq' | 'claude' | 'bedrock',
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<ProviderSignal | null> {
  const base = proxyBaseUrl();
  if (!base) return null;

  try {
    const response = await fetch(`${base}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, task: request.task, text: request.text }),
      signal,
    });

    if (!response.ok) {
      console.warn(`[NADA][proxy] ${provider}: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as ProxyResponse;
    if (data.rejection) {
      // Que el modelo devuelva algo fuera de esquema es informacion util: si
      // pasa a menudo, o el prompt se rompio o alguien lo esta empujando.
      console.warn(`[NADA][proxy] ${provider}: respuesta descartada (${data.rejection})`);
    }
    return data.signal ?? null;
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn(`[NADA][proxy] ${provider}: fallo de red`, error);
    return null;
  }
}
