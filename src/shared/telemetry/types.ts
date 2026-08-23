// =============================================================================
// Contexto del dispositivo
//
// Acompaña a un reporte para poder responder a una pregunta concreta: ¿esto es
// un fallo real de la deteccion, o alguien mandando informacion falsa a mano?
// Cien reportes diciendo que la misma estafa es inofensiva pesan distinto si
// vienen de cien aparatos distintos o de uno solo repitiendo.
//
// ── Lo que NO esta aqui, y por que ──────────────────────────────────────────
//
// LA DIRECCION MAC. No se puede obtener, y no es cuestion de permisos: desde
// Android 10 getMacAddress() devuelve 02:00:00:00:00:00 para todas las apps
// —Google lo retiro justamente como medida antirrastreo— y desde un navegador
// nunca fue accesible. Cualquier libreria que prometa la MAC en 2026 devuelve
// esa constante o un valor inventado. `installId` hace el trabajo que se le
// pedia: distingue instalaciones. Lo que no hace es identificar hardware, y
// llamarlo de otra forma seria mentir en el aviso de privacidad.
//
// LA IP. Existe en el registro, pero NO viaja en este objeto: la lee el
// servidor de la conexion. Pedirsela al cliente seria pedirle a alguien que se
// identifique solo, y quien quiera falsear reportes es precisamente quien
// pondria otra cosa.
//
// HUELLA DE NAVEGADOR (canvas, fuentes, WebGL). Identifica mucho mejor y por
// eso mismo no esta: sirve para rastrear a una persona entre sitios, que es
// mas de lo que este producto necesita para saber si un reporte es fiable.
// =============================================================================

/** Donde corre la app. Distingue app instalada de navegador, como se pidio. */
export type Platform = 'web' | 'android' | 'electron';

export interface DeviceContext {
  /**
   * Identificador de esta instalacion. Aleatorio, generado en el dispositivo.
   *
   * No es un secreto y no autentica nada: identifica. Se puede borrar vaciando
   * el almacenamiento o reinstalando, y quien quiera falsear reportes en serio
   * lo hara. Sirve contra el ruido y la repeticion, no contra un atacante
   * decidido — conviene tenerlo claro antes de apoyar nada importante en el.
   */
  installId: string;
  platform: Platform;
  /** 'Windows', 'Android 14', 'macOS', 'Linux'... Lo que el navegador declare. */
  os: string;
  /** Modelo del aparato cuando se puede saber. En web casi nunca. */
  deviceModel: string | null;
  /** Version de NADA que produjo el reporte. Sin esto no se puede comparar nada. */
  appVersion: string;
  /** Idioma de la interfaz: cambia que lexico se aplico. */
  uiLanguage: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS: Platform[] = ['web', 'android', 'electron'];

/** Tope por campo. Un contexto no tiene por que ser grande, y limita el abuso. */
export const MAX_FIELD_CHARS = 64;

/**
 * Valida un contexto que llega de fuera.
 *
 * Cerrado por defecto, igual que el resto de fronteras del proyecto: lo que no
 * encaje entero se rechaza entero. Un contexto a medias no se "arregla"
 * rellenando huecos, porque entonces el registro diria cosas que nadie envio.
 */
export function parseDeviceContext(raw: unknown): DeviceContext | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const texto = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD_CHARS ? v : null;

  const installId = typeof r['installId'] === 'string' && UUID.test(r['installId'])
    ? r['installId']
    : null;
  if (!installId) return null;

  const platform = PLATFORMS.find((p) => p === r['platform']);
  if (!platform) return null;

  const os = texto(r['os']);
  const appVersion = texto(r['appVersion']);
  const uiLanguage = texto(r['uiLanguage']);
  if (!os || !appVersion || !uiLanguage) return null;

  // El modelo es el unico opcional: en web no se sabe casi nunca, y exigirlo
  // dejaria fuera los reportes de navegador, que son la mayoria.
  const crudoModelo = r['deviceModel'];
  const ausente = crudoModelo === null || crudoModelo === undefined;
  const deviceModel = ausente ? null : texto(crudoModelo);
  if (!ausente && deviceModel === null) return null;

  return { installId, platform, os, deviceModel, appVersion, uiLanguage };
}
