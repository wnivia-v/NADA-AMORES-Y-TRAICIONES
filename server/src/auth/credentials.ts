// =============================================================================
// Contraseñas y tokens
//
// Todo con node:crypto y cero dependencias nuevas, igual que el resto del
// servidor. No es minimalismo por deporte: cada dependencia que toca
// credenciales es una superficie mas que auditar, y scrypt ya viene en la
// biblioteca estandar.
//
// Las tres decisiones que importan:
//
//   1. scrypt, no SHA. Un hash rapido es exactamente lo que no se quiere aqui:
//      si la base de datos se filtra, lo unico que protege las contraseñas es
//      cuanto cuesta probarlas. scrypt esta pensado para costar tiempo Y
//      memoria, que es lo que arruina el ataque con GPU.
//   2. Comparacion en tiempo constante. Comparar dos hashes con === filtra por
//      cuanto tarda en encontrar la primera diferencia. timingSafeEqual no.
//   3. Los tokens de sesion se guardan HASHEADOS. Quien lea la base de datos no
//      puede suplantar a nadie con lo que hay dentro: tendria el hash, no el
//      token. Es la misma razon por la que no se guardan contraseñas.
// =============================================================================

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

/** Parametros de scrypt. Subirlos invalida los hashes ya guardados. */
const KEY_LENGTH = 64;

export interface PasswordDigest {
  hash: string;
  salt: string;
}

/**
 * Longitud minima. No hay reglas de "una mayuscula y un simbolo".
 *
 * Esas reglas producen contraseñas peores: empujan a la gente a
 * "Password1!" en vez de a una frase larga, que es mas facil de recordar y
 * muchisimo mas dificil de romper. La longitud es lo que de verdad cuenta.
 */
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<PasswordDigest> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return { hash: derived.toString('hex'), salt };
}

/**
 * Comprueba una contraseña contra su digest.
 *
 * Nunca lanza por una entrada rara: devuelve false. Un error distinto para
 * "usuario no existe" y para "contraseña mal" le dice al atacante que correos
 * estan registrados.
 */
export async function verifyPassword(password: string, digest: PasswordDigest): Promise<boolean> {
  try {
    const derived = await scryptAsync(password, digest.salt, KEY_LENGTH);
    const stored = Buffer.from(digest.hash, 'hex');
    if (stored.length !== derived.length) return false;
    return timingSafeEqual(stored, derived);
  } catch {
    return false;
  }
}

/**
 * Token opaco para sesiones y verificaciones.
 *
 * 32 bytes de aleatoriedad criptografica. No lleva dentro ninguna informacion:
 * un token que codifica el id de la cuenta invita a manipularlo.
 */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Lo que se guarda de un token.
 *
 * SHA-256 a secas y no scrypt, y aqui si es lo correcto: un token de 32 bytes
 * aleatorios no se puede adivinar por fuerza bruta, asi que no hace falta
 * encarecer cada intento. Lo que se quiere es solo que la base de datos no
 * contenga nada usable.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Normaliza un correo para poder compararlo. No valida que exista. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Comprobacion minima de forma.
 *
 * A proposito laxa: la unica forma de saber si un correo existe es mandarle
 * algo, que es justamente lo que hace el flujo de verificacion. Una expresion
 * regular estricta rechaza direcciones validas y no detecta las falsas.
 */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
