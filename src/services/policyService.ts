// =============================================================================
// Politica vigente: que pack rige y que ha consentido el usuario
//
// Junta las dos mitades de §4.4 en el lado del cliente: pide el pack al backend
// al arrancar y guarda el consentimiento. Todo lo que quiera saber si puede
// enviar algo pregunta aqui, y solo aqui.
//
// La decision menos obvia del archivo, y la que mas importa:
//
//   LA RETENCION SOLO SE APLICA DESDE UN PACK QUE ALGUIEN SIRVIO DE VERDAD.
//
// El pack estricto por defecto dice "cero retencion", y esta bien que lo diga:
// es la postura segura mientras no se sepa donde esta el usuario. Pero aplicar
// esa regla cuando el backend simplemente no contesta significaria borrarle el
// historial a alguien por un fallo de red. Un fallo de red puede hacer que el
// producto proteja MENOS de lo que podria; no puede destruir datos.
//
// Asi que el estricto gobierna el CONSENTIMIENTO —donde equivocarse hacia la
// prudencia solo molesta— y no gobierna el BORRADO, donde equivocarse es
// irreversible.
// =============================================================================

import {
  STRICT_DEFAULT_PACK,
  jurisdictionPack,
  loadJurisdictionPack,
  resetJurisdictionPack,
  type JurisdictionPack,
} from '@/shared/policy/jurisdiction';
import {
  consentNeeded,
  grantConsent,
  mayShareReports as mayShare,
  mayShareTelemetry as mayTelemetry,
  parseConsent,
  withdrawScope,
  type ConsentRecord,
  type ConsentScope,
} from '@/shared/policy/consent';
import { proxyBaseUrl, hasProxy } from './aiProviders/proxyClient';

const CONSENT_KEY = 'nada-consent';
const PACK_CACHE_KEY = 'nada-jurisdiction-pack';
/** Sin esto, un backend lento dejaria la app en la pantalla de carga. */
const POLICY_TIMEOUT_MS = 6_000;

/** True cuando el pack vigente lo sirvio alguien, y no es el de reserva. */
let packWasServed = false;

/**
 * Region declarada por el dispositivo.
 *
 * Sale del idioma del navegador, que es lo que hay sin preguntar. No es exacto
 * —alguien en Francia con el navegador en español declarara 'es'— y da igual:
 * lo unico que decide es que aviso de privacidad se enseña, y errar hacia el
 * mas estricto no hace daño. La alternativa, deducirla de la IP, obligaria a
 * tratar una direccion IP en cada arranque para elegir entre tres filas.
 */
export function declaredRegion(): string {
  const tag = globalThis.navigator?.language ?? '';
  const [lang, country] = tag.split('-');
  if (country) return country.toLowerCase();
  return (lang || 'default').toLowerCase();
}

/**
 * Pide el pack al backend. Se llama una vez al arrancar.
 *
 * Orden de preferencia: lo que sirva el backend, luego el ultimo pack conocido,
 * y por ultimo el estricto. El cache existe para que quien abra la app sin
 * conexion siga viendo el aviso de SU jurisdiccion en vez de volver al generico
 * y que se le vuelva a preguntar todo.
 */
export async function loadPolicy(): Promise<JurisdictionPack> {
  const served = await fetchPack();
  if (served) {
    packWasServed = true;
    cachePack(served);
    return loadJurisdictionPack(served);
  }

  const cached = readCachedPack();
  if (cached) {
    // Servido en su dia, aunque hoy no haya red: cuenta como pack real.
    packWasServed = true;
    return loadJurisdictionPack(cached);
  }

  resetJurisdictionPack();
  packWasServed = false;
  return STRICT_DEFAULT_PACK;
}

/** El pack vigente. Nunca null: sin pack cargado, rige el estricto. */
export function currentPack(): JurisdictionPack {
  return jurisdictionPack();
}

/**
 * Si la retencion del pack puede aplicarse.
 *
 * Ver la cabecera: el estricto de reserva no borra nada de nadie.
 */
export function retentionIsAuthoritative(): boolean {
  return packWasServed;
}

/**
 * Momento antes del cual ya no se conserva nada, o null si no toca borrar.
 *
 * Devuelve null cuando el pack no lo sirvio nadie — ver la cabecera del
 * archivo: un fallo de red no puede borrarle el historial a nadie. Con 0 dias
 * el corte es AHORA, que es lo que significa "no se conserva".
 */
export function retentionCutoff(now: number = Date.now()): number | null {
  if (!packWasServed) return null;
  const days = currentPack().historyRetentionDays;
  if (!Number.isFinite(days) || days < 0) return null;
  return now - days * 24 * 60 * 60 * 1000;
}

// -----------------------------------------------------------------------------
// Consentimiento
// -----------------------------------------------------------------------------

export function readConsent(): ConsentRecord | null {
  try {
    const raw = globalThis.localStorage?.getItem(CONSENT_KEY);
    return raw ? parseConsent(JSON.parse(raw)) : null;
  } catch {
    // Un consentimiento que no se puede leer es un consentimiento que no
    // existe: se vuelve a preguntar.
    return null;
  }
}

function writeConsent(record: ConsentRecord | null): void {
  try {
    if (record) globalThis.localStorage?.setItem(CONSENT_KEY, JSON.stringify(record));
    else globalThis.localStorage?.removeItem(CONSENT_KEY);
  } catch {
    /* modo privado: se comportara como si no hubiera consentimiento */
  }
}

/** ¿Hay que enseñar la pantalla de consentimiento? */
export function needsConsent(): boolean {
  return consentNeeded(currentPack(), readConsent());
}

export function recordConsent(choice: {
  ageConfirmed: boolean;
  scopes: Partial<Record<ConsentScope, boolean>>;
}): ConsentRecord {
  const record = grantConsent(currentPack(), choice);
  writeConsent(record);
  return record;
}

/** Retirar tiene que ser tan facil como conceder, y poder ser parcial. */
export function revoke(scope: ConsentScope): ConsentRecord | null {
  const current = readConsent();
  if (!current) return null;
  const updated = withdrawScope(current, scope);
  writeConsent(updated);
  return updated;
}

/** Borra el consentimiento entero. Parte del ejercicio de derechos. */
export function forgetConsent(): void {
  writeConsent(null);
}

/**
 * La UNICA puerta por la que un reporte puede salir del dispositivo.
 *
 * Todo lo que envie tiene que preguntar aqui, igual que toda alerta pasa por
 * triggerThreatAlert. Un segundo camino que "solo manda una cosita" es como se
 * pierden estas garantias.
 */
export function mayShareReports(): boolean {
  return mayShare(currentPack(), readConsent());
}

/**
 * True cuando el contexto del aparato puede acompañar a un reporte.
 *
 * Puerta aparte de la anterior a proposito: apagar la telemetria no puede
 * apagar la contribucion. Alguien puede querer seguir ayudando a mejorar la
 * deteccion y no querer que viaje de que aparato sale.
 */
export function mayShareTelemetry(): boolean {
  return mayTelemetry(currentPack(), readConsent());
}

// -----------------------------------------------------------------------------
// Transporte y cache
// -----------------------------------------------------------------------------

async function fetchPack(): Promise<unknown | null> {
  if (!hasProxy()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLICY_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${proxyBaseUrl()}/v1/policy?region=${encodeURIComponent(declaredRegion())}`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { pack?: unknown };
    return body.pack ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cachePack(pack: unknown): void {
  try {
    globalThis.localStorage?.setItem(PACK_CACHE_KEY, JSON.stringify(pack));
  } catch {
    /* sin cache se pedira otra vez al siguiente arranque */
  }
}

function readCachedPack(): unknown | null {
  try {
    const raw = globalThis.localStorage?.getItem(PACK_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Solo para tests: vuelve al estado de recien instalado. */
export function resetPolicyForTests(): void {
  packWasServed = false;
  resetJurisdictionPack();
  writeConsent(null);
  try {
    globalThis.localStorage?.removeItem(PACK_CACHE_KEY);
  } catch {
    /* da igual */
  }
}
