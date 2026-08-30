// =============================================================================
// Jurisdiction pack — la costura, todavia vacia
//
// §4.4 del brief pide el denominador comun mas estricto para todos, y que la
// variacion por pais viva en un JSON que el backend sirve al arrancar. Y
// prohibe expresamente lo contrario: `if (country === 'XX')` repartido por el
// codigo.
//
// Esa prohibicion es la razon de que este archivo exista ahora, aunque el
// contenido llegue despues. Un `if` de pais no se escribe por decision
// arquitectonica: se escribe porque hay una fecha encima y no habia sitio donde
// ponerlo. Habiendo sitio, se pone donde toca.
//
// ESTADO: el pack por defecto es el denominador comun estricto, y no hay
// backend que lo sirva. Vale para Modo A, donde §4.4 no aplica en v1. Cuando se
// decida Modo B hay que:
//
//   1. Añadir GET /v1/policy al servidor, devolviendo el pack por region.
//   2. Cargarlo al arrancar con loadJurisdictionPack().
//   3. Construir sobre el la capa fina: consentimiento, aviso de privacidad,
//      edad minima, retencion, canal de derechos.
//
// Nada de eso existe hoy, y el README lo dice.
// =============================================================================

/**
 * La capa fina que varia por jurisdiccion. Solo esto — el resto del producto se
 * comporta igual en todas partes, que es lo que significa "denominador comun".
 */
export interface JurisdictionPack {
  /** Codigo de region al que corresponde el pack. */
  region: string;
  /** Si hay que recabar consentimiento explicito antes de analizar. */
  requiresExplicitConsent: boolean;
  /** Edad minima para usar el producto. */
  minimumAge: number;
  /** Dias que se conserva el historial NO biometrico. 0 = no se conserva. */
  historyRetentionDays: number;
  /** URL del aviso de privacidad aplicable. */
  privacyNoticeUrl: string | null;
  /** Como ejerce el usuario sus derechos (ARCO / DSR). */
  rightsChannel: { email: string | null; url: string | null };
  /** Autoridad de control de referencia, para el aviso. */
  supervisoryAuthority: string | null;
}

/**
 * Denominador comun estricto.
 *
 * Los valores son deliberadamente los mas restrictivos: consentimiento
 * explicito, 18 años y CERO retencion. Si el pack no llega —porque no hay
 * backend, porque falla la red, porque la region no esta contemplada— el
 * producto se comporta de la forma mas conservadora posible, no de la mas
 * permisiva. Un fallo de red no puede rebajar la proteccion legal del usuario,
 * por la misma razon por la que en la Fase 1 una respuesta invalida del modelo
 * no puede convertirse en un veredicto SEGURO.
 */
export const STRICT_DEFAULT_PACK: JurisdictionPack = {
  region: 'default',
  requiresExplicitConsent: true,
  minimumAge: 18,
  historyRetentionDays: 0,
  privacyNoticeUrl: null,
  rightsChannel: { email: null, url: null },
  supervisoryAuthority: null,
};

let activePack: JurisdictionPack = STRICT_DEFAULT_PACK;

/** El pack vigente. Nunca null: sin pack cargado, rige el estricto. */
export function jurisdictionPack(): JurisdictionPack {
  return activePack;
}

/**
 * Instala un pack recibido del backend.
 *
 * Valida antes de instalar y, ante cualquier duda, se queda con el estricto.
 * Un pack manipulado que dijera "sin consentimiento, retencion infinita, edad
 * minima cero" seria un problema legal servido por HTTP, asi que los campos que
 * relajan la proteccion solo se aceptan bien tipados.
 */
export function loadJurisdictionPack(raw: unknown): JurisdictionPack {
  if (typeof raw !== 'object' || raw === null) return activePack;
  const p = raw as Record<string, unknown>;

  const region = typeof p['region'] === 'string' ? p['region'] : STRICT_DEFAULT_PACK.region;
  const minimumAge =
    typeof p['minimumAge'] === 'number' && Number.isInteger(p['minimumAge']) && p['minimumAge'] >= 0
      ? p['minimumAge']
      : STRICT_DEFAULT_PACK.minimumAge;
  const retention =
    typeof p['historyRetentionDays'] === 'number' && p['historyRetentionDays'] >= 0
      ? Math.floor(p['historyRetentionDays'])
      : STRICT_DEFAULT_PACK.historyRetentionDays;

  activePack = {
    region,
    // Solo un false explicito y bien tipado libera del consentimiento.
    requiresExplicitConsent: p['requiresExplicitConsent'] === false ? false : true,
    minimumAge,
    historyRetentionDays: retention,
    privacyNoticeUrl: typeof p['privacyNoticeUrl'] === 'string' ? p['privacyNoticeUrl'] : null,
    rightsChannel: {
      email: typeof (p['rightsChannel'] as Record<string, unknown>)?.['email'] === 'string'
        ? String((p['rightsChannel'] as Record<string, unknown>)['email'])
        : null,
      url: typeof (p['rightsChannel'] as Record<string, unknown>)?.['url'] === 'string'
        ? String((p['rightsChannel'] as Record<string, unknown>)['url'])
        : null,
    },
    supervisoryAuthority:
      typeof p['supervisoryAuthority'] === 'string' ? p['supervisoryAuthority'] : null,
  };

  return activePack;
}

/** Vuelve al denominador comun estricto. */
export function resetJurisdictionPack(): void {
  activePack = STRICT_DEFAULT_PACK;
}
