// =============================================================================
// Cuentas: registro, verificacion, sesion y supresion
//
// Tres decisiones que no son evidentes leyendo el codigo, y que son las que
// importan:
//
//   1. NUNCA SE DICE SI UN CORREO ESTA REGISTRADO. Ni al registrarse ni al
//      entrar. Un mensaje distinto para "ese correo ya existe" convierte el
//      formulario en un comprobador de cuentas: cualquiera puede averiguar si
//      una persona concreta usa NADA. En una app de seguridad personal, eso no
//      es un detalle — es informacion sobre alguien que puede estar
//      precisamente huyendo de otra persona.
//   2. SIN CORREO VERIFICADO NO SE ACEPTAN REPORTES. Es lo que hace que
//      envenenar el corpus cueste algo: sin verificacion, mil cuentas son mil
//      formularios; con ella, son mil buzones.
//   3. BORRAR BORRA. deleteAccount se lleva sesiones, verificaciones y
//      reportes. Es el derecho de supresion, y esta probado.
// =============================================================================

import { randomUUID } from 'node:crypto';

import {
  hashPassword, verifyPassword, newToken, hashToken,
  normalizeEmail, looksLikeEmail, MIN_PASSWORD_LENGTH,
} from '../auth/credentials';
import { loginLimiter, registerLimiter } from '../auth/rateLimit';
import { deliverVerification } from '../auth/mailer';
import { store } from '../store/memory';
import type { HandlerResponse } from '../handler';

/** Cuanto dura una sesion. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Cuanto dura un enlace de verificacion. */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Lo mismo que se responde tanto si el correo era nuevo como si ya existia.
 *
 * Ver la decision (1) arriba: la respuesta no puede depender de si la cuenta
 * existe, porque entonces la respuesta ES la respuesta a "¿existe esta cuenta?".
 */
const REGISTER_ACK = {
  status: 202,
  body: { ok: true, message: 'Si el correo es valido, recibiras un enlace de verificacion.' },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export interface RequestContext {
  /** Identificador del que llama, para el limite de ritmo. */
  clientKey: string;
  /** Base publica desde la que se sirve la verificacion. */
  verifyUrlBase: string;
}

/** POST /v1/accounts — registro. */
export async function handleRegister(raw: unknown, ctx: RequestContext): Promise<HandlerResponse> {
  if (!registerLimiter.take(ctx.clientKey)) {
    return { status: 429, body: { error: 'demasiados registros, prueba mas tarde' } };
  }
  if (!isPlainObject(raw)) return { status: 400, body: { error: 'cuerpo invalido' } };

  const email = normalizeEmail(str(raw['email']) ?? '');
  const password = str(raw['password']) ?? '';
  const region = (str(raw['region']) ?? 'default').toLowerCase();

  // La contraseña si se valida con mensaje concreto: no revela nada de nadie y
  // sin esto la persona no sabe por que no la aceptan.
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: 400,
      body: { error: `la contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres` },
    };
  }
  // Un correo mal formado tampoco delata nada: no depende de si existe.
  if (!looksLikeEmail(email)) return { status: 400, body: { error: 'correo invalido' } };

  const existing = await store.accountByEmail(email);
  if (existing) {
    // Ya registrado: se responde EXACTAMENTE lo mismo y no se crea nada. Quien
    // pruebe correos ajenos no aprende nada; quien se registro de verdad y lo
    // olvido puede pedir otro enlace por el flujo de verificacion.
    return REGISTER_ACK;
  }

  const digest = await hashPassword(password);
  const accountId = randomUUID();
  await store.createAccount({
    id: accountId,
    email,
    passwordHash: digest.hash,
    passwordSalt: digest.salt,
    verifiedAt: null,
    createdAt: new Date(),
    region,
  });

  const token = newToken();
  await store.createVerification({
    tokenHash: hashToken(token),
    accountId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
  });

  const delivery = await deliverVerification(email, token, ctx.verifyUrlBase);
  if (!delivery.ok) {
    // El correo no salio. Decirlo: una cuenta que nadie puede verificar es una
    // cuenta inservible, y callarlo la convierte en un misterio para el usuario.
    return { status: 500, body: { error: 'no se pudo enviar el correo de verificacion' } };
  }

  return REGISTER_ACK;
}

/** POST /v1/accounts/verify — canjea el token del correo. */
export async function handleVerify(raw: unknown): Promise<HandlerResponse> {
  if (!isPlainObject(raw)) return { status: 400, body: { error: 'cuerpo invalido' } };
  const token = str(raw['token']);
  if (!token) return { status: 400, body: { error: 'falta el token' } };

  // De un solo uso: se consume aunque haya caducado, para que un token filtrado
  // no se pueda reintentar.
  const record = await store.consumeVerification(hashToken(token));
  if (!record) return { status: 400, body: { error: 'token invalido' } };
  if (record.expiresAt.getTime() < Date.now()) {
    return { status: 400, body: { error: 'token caducado' } };
  }

  await store.markVerified(record.accountId, new Date());
  return { status: 200, body: { ok: true } };
}

/** POST /v1/sessions — entrar. */
export async function handleLogin(raw: unknown, ctx: RequestContext): Promise<HandlerResponse> {
  if (!isPlainObject(raw)) return { status: 400, body: { error: 'cuerpo invalido' } };

  const email = normalizeEmail(str(raw['email']) ?? '');
  const password = str(raw['password']) ?? '';

  // El limite va por correo Y por origen: por correo frena el ataque contra una
  // cuenta concreta, por origen frena el que prueba una contraseña comun contra
  // muchas cuentas.
  if (!loginLimiter.take(`email:${email}`) || !loginLimiter.take(`ip:${ctx.clientKey}`)) {
    return { status: 429, body: { error: 'demasiados intentos, prueba mas tarde' } };
  }

  const account = await store.accountByEmail(email);
  // Misma respuesta para "no existe" y para "contraseña mal". Y se comprueba la
  // contraseña igualmente cuando no hay cuenta, para que el tiempo de respuesta
  // tampoco delate la diferencia.
  const digest = account
    ? { hash: account.passwordHash, salt: account.passwordSalt }
    : { hash: '00'.repeat(64), salt: 'inexistente' };
  const ok = await verifyPassword(password, digest);

  if (!account || !ok) {
    return { status: 401, body: { error: 'correo o contraseña incorrectos' } };
  }

  const token = newToken();
  await store.createSession({
    tokenHash: hashToken(token),
    accountId: account.id,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return {
    status: 200,
    body: {
      token,
      account: { id: account.id, email: account.email, verified: account.verifiedAt !== null },
    },
  };
}

/** DELETE /v1/sessions — salir. */
export async function handleLogout(token: string | null): Promise<HandlerResponse> {
  if (token) await store.deleteSession(hashToken(token));
  // 204 pase lo que pase: salir nunca debe fallar, y decir "esa sesion no
  // existia" no ayuda a nadie salvo a quien esta probando tokens.
  return { status: 204, body: null };
}

export interface Authenticated {
  accountId: string;
  verified: boolean;
}

/**
 * Resuelve el portador de un token de sesion.
 *
 * Devuelve null ante cualquier duda: token ausente, desconocido, caducado o de
 * una cuenta que ya no existe. Una sesion caducada se borra al detectarla.
 */
export async function authenticate(token: string | null): Promise<Authenticated | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await store.sessionByHash(tokenHash);
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await store.deleteSession(tokenHash);
    return null;
  }

  const account = await store.accountById(session.accountId);
  if (!account) return null;

  return { accountId: account.id, verified: account.verifiedAt !== null };
}

/**
 * DELETE /v1/accounts — derecho de supresion.
 *
 * Se lleva la cuenta y todo lo que cuelga de ella, reportes incluidos. Es
 * inmediato y no hay papeleo: pedirle a alguien que escriba un correo para
 * ejercer un derecho que se puede ejercer con un boton es poner una barrera
 * donde no toca.
 */
export async function handleDeleteAccount(auth: Authenticated): Promise<HandlerResponse> {
  await store.deleteAccount(auth.accountId);
  return { status: 204, body: null };
}
