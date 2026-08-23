// =============================================================================
// Contexto del dispositivo: recogerlo, y poder dejar de hacerlo
//
// Todo lo que sale de aqui viaja SOLO si el ambito `telemetry` esta concedido.
// La comprobacion no vive en este fichero sino en quien lo llama, y a proposito:
// una funcion que a veces devuelve datos y a veces no, segun un estado que no
// se ve en la firma, es la clase de cosa que acaba enviando lo que no debia.
// =============================================================================

import type { DeviceContext, Platform } from '@/shared/telemetry/types';

const INSTALL_KEY = 'nada-install-id';

/**
 * Version de la app. Vite la inyecta desde package.json al construir.
 *
 * Ya existia para los reportes; se reusa en vez de añadir otra. El respaldo
 * cubre los tests, donde no hay build que sustituya nada.
 */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || '0.0.0-dev';

/**
 * Identificador de esta instalacion, estable mientras no se borre el almacen.
 *
 * Se genera perezosamente y NO al arrancar: hasta que alguien acepta contribuir
 * no hace falta ninguno, y crearlo antes seria empezar a identificar a quien
 * todavia no ha dicho que si.
 */
export function installId(): string {
  try {
    const guardado = localStorage.getItem(INSTALL_KEY);
    if (guardado) return guardado;
    const nuevo = crypto.randomUUID();
    localStorage.setItem(INSTALL_KEY, nuevo);
    return nuevo;
  } catch {
    // Almacenamiento bloqueado (ventana privada, ajustes del navegador). Se
    // devuelve uno de usar y tirar: el reporte sigue siendo util aunque no se
    // pueda enlazar con otros del mismo aparato.
    return crypto.randomUUID();
  }
}

/** Borra el identificador. Lo llama el interruptor al apagarse. */
export function forgetInstall(): void {
  try {
    localStorage.removeItem(INSTALL_KEY);
  } catch { /* nada que borrar */ }
}

function detectPlatform(): Platform {
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) {
    // Capacitor envuelve la app en un WebView: el user agent dice Android
    // igual que un Chrome normal, y lo que los separa es el protocolo con el
    // que se sirvio la pagina.
    const esApp = typeof location !== 'undefined' && location.protocol === 'capacitor:';
    return esApp ? 'android' : 'web';
  }
  // Electron se anuncia en su propio user agent.
  if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)) return 'electron';
  return 'web';
}

/**
 * Sistema operativo, de lo que el navegador quiera declarar.
 *
 * Se prefiere userAgentData —que es lo que Chrome mantiene— y se cae al user
 * agent clasico. Ninguno de los dos es fiable: se pueden falsear enteros. Como
 * dato para agrupar fallos sirve; como prueba de nada, no.
 */
function detectOs(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const declarado = nav.userAgentData?.platform;
  if (declarado) return declarado.slice(0, 64);

  const ua = navigator.userAgent;
  const versionAndroid = /Android\s+([\d.]+)/.exec(ua);
  if (versionAndroid) return `Android ${versionAndroid[1]}`;
  for (const [patron, nombre] of [
    [/Windows NT 10/, 'Windows 10/11'],
    [/Windows/, 'Windows'],
    [/Mac OS X/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
    [/iPhone|iPad/, 'iOS'],
  ] as Array<[RegExp, string]>) {
    if (patron.test(ua)) return nombre;
  }
  return 'desconocido';
}

/**
 * Modelo del aparato. Casi siempre null.
 *
 * Android lo pone en el user agent tras el numero de version, entre "; " y
 * ")". En escritorio no existe tal cosa y devolver "PC" seria inventarselo.
 */
function detectModel(): string | null {
  const m = /Android\s+[\d.]+;\s*([^)]+?)(?:\s+Build\/|\))/.exec(navigator.userAgent);
  const modelo = m?.[1]?.trim();
  if (!modelo || modelo.length > 64) return null;
  // Chrome manda "K" como modelo desde que redujo el user agent. No es un
  // aparato: es el marcador de que no lo va a decir.
  return modelo === 'K' ? null : modelo;
}

/** Reune el contexto. Quien llame decide si tiene derecho a enviarlo. */
export function collectDeviceContext(uiLanguage: string): DeviceContext {
  return {
    installId: installId(),
    platform: detectPlatform(),
    os: detectOs(),
    deviceModel: detectModel(),
    appVersion: APP_VERSION,
    uiLanguage,
  };
}
