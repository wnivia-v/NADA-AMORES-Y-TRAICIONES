// =============================================================================
// Que motor de voz usar
//
// Existe por un fallo reportado usando la app: con el escudo puesto y un podcast
// sonando, Spotify se pausaba y volvia una y otra vez hasta que el escudo se
// rendia — y entonces Spotify seguia normal.
//
// La causa esta en como cada motor abre el microfono, y la diferencia es de
// fondo, no un ajuste:
//
//   Reconocedor del sistema (Web Speech, SpeechRecognizer de Android)
//     Abre y cierra una sesion de reconocimiento cada pocos segundos. Cada
//     arranque PIDE EL FOCO DE AUDIO, y Android pausa lo que este sonando. Al
//     soltarlo, la reproduccion vuelve. Repetido tantas veces como reinicios.
//     Esta pensado para "pulsa el microfono y habla", no para vigilar de fondo.
//
//   En el dispositivo (Whisper)
//     Abre getUserMedia UNA vez y mantiene el flujo. Una sola toma de
//     microfono, sin reinicios — se acaba el tartamudeo.
//
//     CORRECCION de lo que decia aqui antes: "y convive con la reproduccion"
//     era falso a medias. Abrir el microfono una sola vez quita el
//     pausa-vuelve-pausa, pero abrirlo SIGUE pausando la reproduccion mientras
//     dure, porque las restricciones que se piden lo abren en modo
//     comunicacion. Convivir de verdad depende de micMode.ts, no de que motor
//     se use. Lo destapo un reporte: "no permite audio de Spotify y microfono
//     a la vez".
//
// De ahi que esto sea una eleccion y no una heuristica escondida: los dos
// motores son correctos para casos distintos, y quien usa la app es quien sabe
// si esta escuchando algo mientras vigila.
// =============================================================================

import type { VoiceEngineId } from './types';

export type VoicePreference =
  /** Lo que sea mas rapido y preciso en este aparato. El de siempre. */
  | 'auto'
  /** Forzar el reconocedor del sistema. Rapido, pero interrumpe otro audio. */
  | 'system'
  /**
   * Forzar el motor local. No interrumpe la reproduccion, no manda audio a
   * ningun servidor y no toca la campanita de "escuchando". A cambio es mas
   * lento, menos preciso y la primera vez descarga un modelo.
   */
  | 'on-device';

const KEY = 'nada-voice-engine';
const VALIDAS: VoicePreference[] = ['auto', 'system', 'on-device'];

export function voicePreference(): VoicePreference {
  try {
    const guardado = localStorage.getItem(KEY);
    return VALIDAS.find((v) => v === guardado) ?? 'auto';
  } catch {
    return 'auto';
  }
}

export function setVoicePreference(pref: VoicePreference): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch { /* sin almacenamiento se queda en auto */ }
}

/**
 * Ordena los motores segun la preferencia.
 *
 * Nunca deja la lista vacia, ni siquiera al forzar uno: si el forzado no puede
 * arrancar aqui, el otro sigue detras como respaldo. Forzar es decir cual va
 * primero, no quedarse sin escudo si ese falla — que seria peor que el problema
 * que se venia a resolver.
 */
export function orderEngines(
  disponibles: VoiceEngineId[],
  pref: VoicePreference,
): VoiceEngineId[] {
  if (pref === 'auto') return disponibles;

  // El unico motor que abre el microfono una sola vez. Los otros dos son
  // reconocedores del sistema y se comportan igual frente a la reproduccion.
  const esLocal = (id: VoiceEngineId) => id === 'whisper-local';
  const primero = pref === 'on-device' ? esLocal : (id: VoiceEngineId) => !esLocal(id);

  return [...disponibles.filter(primero), ...disponibles.filter((id) => !primero(id))];
}
