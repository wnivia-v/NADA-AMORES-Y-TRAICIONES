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

import type {
  AnalysisRequest,
  HardeningReport,
  ProviderAnswer,
  ProviderSignal,
  SignalRejection,
} from '@/shared/llm/types';
import { answered, noAnswer } from '@/shared/llm/types';

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
 * Nunca convierte un fallo en "no hay riesgo": devuelve una respuesta SIN señal
 * y con el motivo puesto. El orquestador lo trata como proveedor que no
 * contesto y sigue con los demas, o cae al camino local — pero ahora el motivo
 * sobrevive hasta la vista tecnica en vez de morir en un console.warn.
 */
export async function analyzeViaProxy(
  provider: 'groq' | 'claude' | 'bedrock',
  request: AnalysisRequest,
  signal?: AbortSignal,
): Promise<ProviderAnswer> {
  const base = proxyBaseUrl();
  if (!base) return noAnswer({ transport: 'not-configured', detail: 'sin VITE_NADA_API_URL' });

  try {
    const response = await fetch(`${base}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, task: request.task, text: request.text }),
      signal,
    });

    if (!response.ok) {
      return noAnswer({ transport: 'http-error', detail: `HTTP ${response.status}` });
    }

    const data = (await response.json()) as ProxyResponse;

    // Que el modelo devuelva algo fuera de esquema es informacion util: si pasa
    // a menudo, o el prompt se rompio o alguien lo esta empujando. Por eso sube
    // en vez de quedarse en la consola.
    if (data.rejection) {
      return noAnswer({ rejection: data.rejection as SignalRejection });
    }
    if (!data.signal) {
      return noAnswer({ transport: 'http-error', detail: 'respuesta sin señal' });
    }
    return answered(data.signal);
  } catch (error) {
    if (signal?.aborted) return noAnswer({ transport: 'network', detail: 'cancelado' });
    return noAnswer({
      transport: 'network',
      detail: error instanceof Error ? error.name : 'fallo de red',
    });
  }
}
