// =============================================================================
// Configuracion del servidor
//
// Lo importante de este archivo es lo que NO lleva prefijo VITE_.
//
// Vite inyecta toda variable `VITE_*` en el bundle del cliente con `define`, en
// texto plano. Es decir que `VITE_GROQ_API_KEY` y `VITE_CLAUDE_API_KEY` estaban
// dentro de `dist/assets/*.js` y cualquiera que abriese la app podia extraerlas
// y gastar la cuota ajena. Aqui las claves se leen de `process.env` en el
// proceso del servidor y no cruzan nunca hacia el navegador.
// =============================================================================

export type UpstreamId = 'groq' | 'claude' | 'bedrock';

export interface UpstreamConfig {
  apiKey: string;
  model: string;
  endpoint?: string;
}

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export function upstreamConfig(id: UpstreamId): UpstreamConfig | null {
  switch (id) {
    case 'groq': {
      const apiKey = env('GROQ_API_KEY');
      if (!apiKey) return null;
      return { apiKey, model: env('GROQ_MODEL', 'llama-3.3-70b-versatile') };
    }
    case 'claude': {
      const apiKey = env('CLAUDE_API_KEY');
      if (!apiKey) return null;
      return { apiKey, model: env('CLAUDE_MODEL', 'claude-sonnet-4-20250514') };
    }
    case 'bedrock': {
      const apiKey = env('BEDROCK_API_KEY');
      const endpoint = env('BEDROCK_ENDPOINT');
      if (!apiKey || !endpoint) return null;
      return { apiKey, endpoint, model: env('BEDROCK_MODEL', 'anthropic.claude-3-haiku-20240307-v1:0') };
    }
    default:
      return null;
  }
}

export function configuredUpstreams(): UpstreamId[] {
  return (['groq', 'claude', 'bedrock'] as UpstreamId[]).filter((id) => upstreamConfig(id) !== null);
}

export const PORT = Number(env('PORT', '8787'));

/**
 * Origenes permitidos, separados por coma.
 *
 * Por defecto solo el servidor de desarrollo de Vite. En Electron las peticiones
 * salen sin cabecera Origin (o con `file://`), que se acepta explicitamente mas
 * abajo: la app de escritorio no tiene un origen web que declarar.
 */
export const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** Tiempo maximo que se espera a un proveedor antes de rendirse. */
export const UPSTREAM_TIMEOUT_MS = Number(env('UPSTREAM_TIMEOUT_MS', '15000'));

/**
 * URL publica donde la app atiende el enlace de verificacion.
 *
 * El servidor no sabe por que dominio se le llega, asi que esto es
 * configuracion de despliegue como el resto de las direcciones.
 */
export const VERIFY_URL_BASE = env('VERIFY_URL_BASE', 'http://localhost:5173/verificar');
