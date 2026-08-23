// =============================================================================
// Como se pide el microfono
//
// Reportado usando la app: "un sitio web esta tratando de utilizar el
// microfono... no permite audio de Spotify y microfono a la vez".
//
// No es una restriccion del navegador ni un permiso mal dado: es lo que pedimos
// nosotros. `echoCancellation: true` hace que Chrome en Android abra el
// microfono como AudioSource.VOICE_COMMUNICATION, que pone el aparato en MODO
// COMUNICACION — el mismo que usa una llamada— y en ese modo el sistema pausa lo
// que este sonando. Los tres flags juntos son la peticion mas invasiva posible.
//
// Con los tres apagados se abre el microfono corriente, que convive con la
// reproduccion.
//
// ── El coste, que no es pequeño ─────────────────────────────────────────────
//
// La cancelacion de eco existe para quitar del microfono lo que sale por el
// altavoz del propio aparato. Sin ella, el escudo OYE lo que suene: un podcast
// entra en la transcripcion y se analiza como si alguien lo estuviera diciendo.
// Puede producir avisos sobre el contenido del podcast, no sobre una llamada.
//
// Por eso 'aislado' sigue siendo lo que se usa por defecto, y convivir es una
// eleccion — util para probar el escudo con audio grabado, o para quien quiera
// vigilar sin renunciar a lo que esta escuchando, sabiendo lo que implica.
//
// SIN VERIFICAR: no hay microfono ni Android en el entorno donde se escribio
// esto. El mapeo de flags a AudioSource es comportamiento documentado de
// Chromium, no algo medido aqui.
// =============================================================================

export type MicMode =
  /** Procesado: cancela eco y ruido. Mejor transcripcion, pausa otro audio. */
  | 'aislado'
  /** Microfono crudo: convive con la reproduccion, pero la oye. */
  | 'convivir';

const KEY = 'nada-mic-mode';

export function micMode(): MicMode {
  try {
    return localStorage.getItem(KEY) === 'convivir' ? 'convivir' : 'aislado';
  } catch {
    return 'aislado';
  }
}

export function setMicMode(mode: MicMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch { /* se queda en aislado */ }
}

/**
 * Las restricciones que se le pasan a getUserMedia.
 *
 * Un unico sitio para las dos rutas que abren el microfono —el escudo de voz y
 * el de video— porque tenerlas duplicadas garantiza que un dia solo se arregle
 * una, y entonces el ajuste diria una cosa y el aparato haria otra.
 */
export function audioConstraints(mode: MicMode = micMode()): MediaTrackConstraints {
  if (mode === 'convivir') {
    // Explicitamente en false, no ausentes: omitirlos deja que el navegador
    // elija, y Chrome elige procesado — justo lo que se quiere evitar.
    return { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  }
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}
