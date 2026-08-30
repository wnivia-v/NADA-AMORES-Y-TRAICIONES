// =============================================================================
// Jurisdiction pack — el lado que lo sirve
//
// §4.4 pide el denominador comun mas estricto para todo el mundo, y que la
// variacion por pais viva en un JSON que el backend entrega al arrancar. Y
// prohibe expresamente lo contrario: `if (country === 'XX')` repartido por el
// codigo.
//
// De ahi que esto sea una TABLA y no una funcion con ramas. Añadir un pais es
// añadir una fila; nada del comportamiento del producto cuelga de ella salvo
// los cinco campos de la capa fina.
//
// Tres cosas que conviene leer antes de tocar esta tabla:
//
//   1. `minimumAge: 18` NO sale de ninguna ley. Es una decision de producto:
//      esto acompaña a alguien en apps de citas. Las leyes de proteccion de
//      datos fijan otra cosa distinta —la edad a la que alguien puede consentir
//      el tratamiento de sus datos, que en varios paises es menor— y mezclar
//      las dos seria un error facil de cometer y dificil de detectar.
//   2. La autoridad de control solo se nombra donde no hay duda. Para el resto
//      de la UE se remite a la autoridad nacional sin inventarse cual, porque
//      un nombre equivocado en un aviso legal es peor que no dar ninguno.
//   3. El correo de derechos y la URL del aviso salen del ENTORNO, no del
//      codigo. Son configuracion de despliegue: quien opera el servicio sabe su
//      direccion, el repositorio no. Sin configurar se sirven como null y la
//      app lo enseña como lo que es — un canal sin montar.
//
// ANTES DE PUBLICAR: esta tabla necesita revision legal. El mecanismo esta
// probado; los valores son de partida.
// =============================================================================

/** Igual que src/shared/policy/jurisdiction.ts. Es el mismo contrato. */
export interface JurisdictionPack {
  region: string;
  requiresExplicitConsent: boolean;
  minimumAge: number;
  historyRetentionDays: number;
  privacyNoticeUrl: string | null;
  rightsChannel: { email: string | null; url: string | null };
  supervisoryAuthority: string | null;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

/** Edad minima de PRODUCTO, la misma en todas partes. Ver nota (1) arriba. */
const PRODUCT_MINIMUM_AGE = 18;

interface PackTemplate {
  requiresExplicitConsent: boolean;
  historyRetentionDays: number;
  supervisoryAuthority: string | null;
}

/**
 * La tabla. Una fila por region, y nada mas que la capa fina.
 *
 * Las claves son codigos de region en minusculas. `default` es el denominador
 * comun estricto y es lo que recibe cualquiera que no encaje en ninguna fila.
 */
const PACKS: Record<string, PackTemplate> = {
  // Denominador comun estricto: consentimiento explicito y CERO retencion. Es
  // lo que se sirve ante cualquier duda, incluida una region desconocida.
  default: {
    requiresExplicitConsent: true,
    historyRetentionDays: 0,
    supervisoryAuthority: null,
  },
  es: {
    requiresExplicitConsent: true,
    historyRetentionDays: 90,
    supervisoryAuthority: 'Agencia Española de Protección de Datos (AEPD)',
  },
  eu: {
    requiresExplicitConsent: true,
    historyRetentionDays: 90,
    // A proposito sin nombre concreto: son 27 autoridades y equivocarse en un
    // aviso legal es peor que remitir a la que corresponda.
    supervisoryAuthority: 'la autoridad de control de tu pais de residencia',
  },
};

/** Regiones que la tabla contempla. Para diagnostico y tests. */
export function knownRegions(): string[] {
  return Object.keys(PACKS);
}

/**
 * Resuelve el pack de una region.
 *
 * La region la DECLARA el cliente. Deducirla de la IP seria mas exacto y
 * costaria tratar una direccion IP —un dato personal— en cada arranque, para
 * elegir entre unas pocas filas. No compensa.
 *
 * Lo desconocido cae al estricto, nunca al permisivo: equivocarse hacia la
 * proteccion solo molesta, equivocarse hacia la permisividad es un problema.
 */
export function packFor(region: string | null): JurisdictionPack {
  const key = (region ?? '').trim().toLowerCase();
  const template = PACKS[key] ?? PACKS['default']!;
  const resolved = PACKS[key] ? key : 'default';

  return {
    region: resolved,
    requiresExplicitConsent: template.requiresExplicitConsent,
    minimumAge: PRODUCT_MINIMUM_AGE,
    historyRetentionDays: template.historyRetentionDays,
    privacyNoticeUrl: env('PRIVACY_NOTICE_URL'),
    rightsChannel: {
      email: env('RIGHTS_CONTACT_EMAIL'),
      url: env('RIGHTS_CONTACT_URL'),
    },
    supervisoryAuthority: template.supervisoryAuthority,
  };
}

export interface PolicyResponse {
  status: number;
  body: unknown;
}

/**
 * GET /v1/policy?region=es
 *
 * Sin autenticacion y a proposito: se sirve ANTES de que exista cuenta alguna,
 * porque hay que enseñar el aviso de privacidad antes de pedirle nada a nadie.
 * No devuelve nada especifico de ninguna persona — es la misma respuesta para
 * todos los de una region — asi que no hay nada que proteger aqui.
 */
export function handlePolicy(region: string | null): PolicyResponse {
  return { status: 200, body: { pack: packFor(region) } };
}
