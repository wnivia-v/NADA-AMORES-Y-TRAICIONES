// =============================================================================
// Consentimiento
//
// La idea que sostiene este archivo: usar NADA y CONTRIBUIR a NADA no son la
// misma decision, y juntarlas las debilita las dos.
//
//   - Legalmente, un consentimiento que condiciona el servicio a aceptar un
//     tratamiento que el servicio no necesita no es libre, y un consentimiento
//     que no es libre no vale. Proteger a alguien de una estafa no requiere que
//     sus conversaciones salgan del movil; enviarlas es otra cosa, y se pide
//     aparte.
//   - En la practica, un boton de "acepto todo o vete" consigue que la gente
//     acepte sin leer o se vaya. Ninguna de las dos ayuda.
//
// De ahi los dos ambitos separados. `protection` es lo que hace falta para que
// la app funcione. `reports` es lo unico que permite que un texto salga del
// dispositivo, y viene APAGADO salvo que alguien lo encienda a proposito.
//
// El otro punto delicado: el texto de un reporte contiene mensajes de TERCEROS
// que no han consentido nada. Quien acepta esta consintiendo por si mismo y
// entregando conversaciones ajenas, y el aviso de privacidad tiene que decirlo
// con esas palabras. No hay forma de arreglar eso con codigo; si hay forma de
// no esconderlo.
// =============================================================================

import type { JurisdictionPack } from './jurisdiction';

/**
 * Version del TEXTO que se acepta.
 *
 * Se sube a mano y a proposito: cambiar lo que alguien acepto es exactamente
 * el momento en el que hay que volver a preguntarselo, y eso es una decision
 * humana, no algo que deba deducir una funcion. Al subirla, todo el mundo
 * vuelve a pasar por la pantalla.
 */
export const CONSENT_TEXT_VERSION = '2026-08-2';

/**
 * Que se acepta, por separado.
 *
 * - `protection`: usar la app. Sin esto no hay producto.
 * - `reports`: contribuir el analisis al corpus para mejorar la deteccion.
 * - `telemetry`: acompañar esos reportes con el contexto del dispositivo
 *   —plataforma, sistema, modelo, version— para poder distinguir un fallo real
 *   de alguien mandando informacion falsa a mano.
 *
 * `telemetry` es un ambito propio y no una casilla dentro de `reports` por un
 * motivo practico: se retira por separado. Alguien puede querer seguir
 * ayudando con sus reportes y no querer que viaje de que aparato salen.
 */
export type ConsentScope = 'protection' | 'reports' | 'telemetry';

export interface ConsentRecord {
  /** Version del texto aceptado + region, para saber si sigue vigente. */
  version: string;
  /** Region cuyo pack regia al aceptar. */
  region: string;
  /** ISO 8601. */
  grantedAt: string;
  /**
   * El usuario declaro tener la edad minima.
   *
   * Es una DECLARACION, no una verificacion. Una casilla no comprueba la edad
   * de nadie y conviene no llamarla de otra forma: verificar de verdad exigiria
   * un documento, o sea recoger muchos mas datos personales de los que este
   * producto deberia tocar. Se deja escrito aqui para que nadie lo confunda
   * mas adelante con una garantia.
   */
  ageConfirmed: boolean;
  scopes: Record<ConsentScope, boolean>;
}

/**
 * Identifica lo que se acepto: el texto Y la jurisdiccion.
 *
 * La region entra porque un pack distinto puede traer otro aviso de privacidad,
 * otra autoridad de control y otro canal de derechos. Aceptar bajo el pack
 * español no es aceptar bajo otro, asi que mudarse vuelve a preguntar.
 */
export function consentVersionFor(pack: JurisdictionPack): string {
  return `${CONSENT_TEXT_VERSION}:${pack.region}`;
}

/** Un consentimiento en blanco: nada concedido. Es el punto de partida. */
export function emptyConsent(): ConsentRecord | null {
  return null;
}

/**
 * ¿Hay que (volver a) preguntar?
 *
 * Ante la duda, si. Un consentimiento que no se puede verificar es un
 * consentimiento que no existe.
 */
export function consentNeeded(pack: JurisdictionPack, consent: ConsentRecord | null): boolean {
  if (!consent) return true;
  if (consent.version !== consentVersionFor(pack)) return true;
  if (!consent.ageConfirmed) return true;
  // Si el pack exige consentimiento explicito, tenerlo sin el ambito basico no
  // sirve de nada.
  if (pack.requiresExplicitConsent && !consent.scopes.protection) return true;
  return false;
}

/**
 * La unica puerta por la que un texto puede salir del dispositivo.
 *
 * Todo lo que envie reportes tiene que pasar por aqui, igual que toda alerta
 * pasa por triggerThreatAlert. Un segundo camino que "solo manda una cosita"
 * es como se pierden estas garantias.
 */
export function mayShareReports(pack: JurisdictionPack, consent: ConsentRecord | null): boolean {
  if (consentNeeded(pack, consent)) return false;
  return consent?.scopes.reports === true;
}

/**
 * True cuando el contexto del dispositivo puede acompañar a un reporte.
 *
 * Exige las DOS cosas. No hay telemetria suelta: el contexto del aparato solo
 * tiene sentido pegado a un reporte que explique de que analisis habla, y
 * mandarlo por su cuenta seria recoger datos sin nada que mejorar con ellos.
 */
export function mayShareTelemetry(
  pack: JurisdictionPack,
  consent: ConsentRecord | null,
): boolean {
  return mayShareReports(pack, consent) && consent?.scopes.telemetry === true;
}

/** Concede lo elegido bajo el pack vigente. */
export function grantConsent(
  pack: JurisdictionPack,
  choice: { ageConfirmed: boolean; scopes: Partial<Record<ConsentScope, boolean>> },
  now: Date = new Date(),
): ConsentRecord {
  return {
    version: consentVersionFor(pack),
    region: pack.region,
    grantedAt: now.toISOString(),
    ageConfirmed: choice.ageConfirmed === true,
    scopes: {
      protection: choice.scopes.protection === true,
      // Solo un true explicito enciende el envio. Cualquier otra cosa
      // —undefined, null, 'si', 1— lo deja apagado.
      reports: choice.scopes.reports === true,
      telemetry: choice.scopes.telemetry === true,
    },
  };
}

/**
 * Retira un ambito sin tirar el resto.
 *
 * Retirar tiene que ser tan facil como conceder, y ademas tiene que poder ser
 * PARCIAL: dejar de contribuir reportes no puede obligar a nadie a dejar de
 * usar la proteccion.
 */
export function withdrawScope(consent: ConsentRecord, scope: ConsentScope): ConsentRecord {
  return { ...consent, scopes: { ...consent.scopes, [scope]: false } };
}

/**
 * Valida un registro venido del almacenamiento local.
 *
 * localStorage lo puede editar cualquiera con acceso al dispositivo, asi que
 * esto se trata como entrada no fiable: lo que no encaje se descarta y se
 * vuelve a preguntar. Mismo criterio que con la respuesta del modelo en la
 * Fase 1 — cerrado por defecto.
 */
export function parseConsent(raw: unknown): ConsentRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const scopes = r['scopes'];
  if (typeof scopes !== 'object' || scopes === null) return null;
  const s = scopes as Record<string, unknown>;

  if (typeof r['version'] !== 'string' || typeof r['region'] !== 'string') return null;
  if (typeof r['grantedAt'] !== 'string') return null;

  return {
    version: r['version'],
    region: r['region'],
    grantedAt: r['grantedAt'],
    ageConfirmed: r['ageConfirmed'] === true,
    scopes: {
      protection: s['protection'] === true,
      reports: s['reports'] === true,
      // Un registro guardado antes de que existiera este ambito no lo trae, y
      // ausente significa apagado. Nadie consintio algo que no se le pregunto.
      telemetry: s['telemetry'] === true,
    },
  };
}
