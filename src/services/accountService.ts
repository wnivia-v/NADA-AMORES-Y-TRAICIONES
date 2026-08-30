// =============================================================================
// Cuenta: registro, sesion y supresion, desde el cliente
//
// El token de sesion vive en localStorage y viaja en `Authorization: Bearer`.
//
// Merece una nota, porque hay una eleccion detras. Una cookie HttpOnly seria
// mas resistente a que un script robe el token, pero la app y el API estan en
// origenes distintos, asi que exigiria SameSite=None y traeria consigo el
// problema de CSRF — el navegador mandaria la cookie sola en cualquier peticion
// que alguien provocara. Una cabecera que el navegador nunca manda por su
// cuenta no lo tiene.
//
// El intercambio real es: se cambia "robo del token si hay XSS" por "no hay
// CSRF". Vale la pena porque contra el XSS ya hay una CSP estricta, y porque un
// XSS en esta app tendria acceso a cosas peores que el token.
// =============================================================================

import { proxyBaseUrl, hasProxy } from './aiProviders/proxyClient';

const TOKEN_KEY = 'nada-session';

export interface AccountInfo {
  id: string;
  email: string;
  verified: boolean;
}

export type AuthResult =
  | { ok: true; account: AccountInfo }
  | { ok: false; error: string };

export type SimpleResult = { ok: true } | { ok: false; error: string };

function readToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    /* modo privado: la sesion durara lo que dure la pestaña */
  }
}

export function sessionToken(): string | null {
  return readToken();
}

export function isSignedIn(): boolean {
  return readToken() !== null;
}

/** Cabeceras de una peticion autenticada, o null si no hay sesion. */
export function authHeaders(): Record<string, string> | null {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

async function post(path: string, body: unknown, auth = false): Promise<Response | null> {
  if (!hasProxy()) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) Object.assign(headers, authHeaders() ?? {});
    return await fetch(`${proxyBaseUrl()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

async function errorFrom(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function register(email: string, password: string, region: string): Promise<SimpleResult> {
  const response = await post('/v1/accounts', { email, password, region });
  if (!response) return { ok: false, error: 'sin conexion con el servidor' };
  if (!response.ok) return { ok: false, error: await errorFrom(response, 'no se pudo registrar') };
  return { ok: true };
}

export async function verifyEmail(token: string): Promise<SimpleResult> {
  const response = await post('/v1/accounts/verify', { token });
  if (!response) return { ok: false, error: 'sin conexion con el servidor' };
  if (!response.ok) return { ok: false, error: await errorFrom(response, 'token invalido') };
  return { ok: true };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const response = await post('/v1/sessions', { email, password });
  if (!response) return { ok: false, error: 'sin conexion con el servidor' };
  if (!response.ok) return { ok: false, error: await errorFrom(response, 'no se pudo entrar') };

  const body = (await response.json()) as { token?: unknown; account?: unknown };
  if (typeof body.token !== 'string' || typeof body.account !== 'object' || body.account === null) {
    return { ok: false, error: 'respuesta inesperada del servidor' };
  }

  writeToken(body.token);
  return { ok: true, account: body.account as AccountInfo };
}

/**
 * Sale de la sesion.
 *
 * El token local se borra SIEMPRE, aunque el servidor no conteste: si no, un
 * fallo de red dejaria a alguien dentro de una sesion que creia haber cerrado,
 * y eso importa mucho en un dispositivo compartido.
 */
export async function signOut(): Promise<void> {
  const headers = authHeaders();
  writeToken(null);

  if (!hasProxy() || !headers) return;
  try {
    await fetch(`${proxyBaseUrl()}/v1/sessions`, { method: 'DELETE', headers });
  } catch {
    /* la sesion caducara sola en el servidor */
  }
}

/** Borra la cuenta y todo lo que colgaba de ella. Derecho de supresion. */
export async function deleteAccount(): Promise<SimpleResult> {
  const headers = authHeaders();
  if (!hasProxy() || !headers) return { ok: false, error: 'no hay sesion' };

  try {
    const response = await fetch(`${proxyBaseUrl()}/v1/accounts`, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 204) {
      return { ok: false, error: await errorFrom(response, 'no se pudo borrar la cuenta') };
    }
    writeToken(null);
    return { ok: true };
  } catch {
    return { ok: false, error: 'sin conexion con el servidor' };
  }
}
