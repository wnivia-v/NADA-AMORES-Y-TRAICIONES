// =============================================================================
// Que motor escucha, y por que se puede elegir
//
// Reportado usando la app: escudo puesto + podcast sonando -> Spotify se
// pausaba y volvia una y otra vez, hasta que el escudo dejaba de recibir audio
// y entonces Spotify seguia normal.
//
// La causa no esta en un temporizador mal puesto: esta en como abre el
// microfono cada motor. El reconocedor del sistema abre una sesion nueva cada
// pocos segundos y cada arranque pide el foco de audio, que en Android pausa lo
// que suene. El motor local abre getUserMedia una vez y lo mantiene.
//
// Por eso esto es una eleccion y no una heuristica: los dos son correctos para
// casos distintos, y quien usa la app es quien sabe si esta escuchando algo.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  orderEngines,
  voicePreference,
  setVoicePreference,
} from '@/services/voice/preference';
import type { VoiceEngineId } from '@/services/voice/types';

const EN_ANDROID: VoiceEngineId[] = ['android-native', 'whisper-local'];
const EN_NAVEGADOR: VoiceEngineId[] = ['web-speech', 'whisper-local'];

describe('preferencia de motor de voz', () => {
  beforeEach(() => localStorage.clear());

  it('sin elegir nada vale "auto"', () => {
    expect(voicePreference()).toBe('auto');
  });

  it('un valor corrupto en el almacen no rompe: vuelve a auto', () => {
    localStorage.setItem('nada-voice-engine', 'motor-inventado');
    expect(voicePreference()).toBe('auto');
  });

  it('se guarda y se recupera', () => {
    setVoicePreference('on-device');
    expect(voicePreference()).toBe('on-device');
  });
});

describe('orden de los motores', () => {
  it('en auto no toca el orden medido', () => {
    expect(orderEngines(EN_ANDROID, 'auto')).toEqual(EN_ANDROID);
    expect(orderEngines(EN_NAVEGADOR, 'auto')).toEqual(EN_NAVEGADOR);
  });

  it('"en el dispositivo" pone delante el unico que no roba el foco', () => {
    expect(orderEngines(EN_ANDROID, 'on-device')).toEqual(['whisper-local', 'android-native']);
    expect(orderEngines(EN_NAVEGADOR, 'on-device')).toEqual(['whisper-local', 'web-speech']);
  });

  it('"sistema" pone delante el reconocedor, sea cual sea la plataforma', () => {
    expect(orderEngines(EN_ANDROID, 'system')).toEqual(['android-native', 'whisper-local']);
    expect(orderEngines(EN_NAVEGADOR, 'system')).toEqual(['web-speech', 'whisper-local']);
  });

  it('forzar uno NO deja sin respaldo', () => {
    // Quedarse sin escudo porque el motor elegido no arranca aqui seria peor
    // que el problema que se venia a resolver. Elegir es decir cual va primero.
    for (const pref of ['auto', 'system', 'on-device'] as const) {
      expect(orderEngines(EN_ANDROID, pref)).toHaveLength(2);
      expect(orderEngines(EN_NAVEGADOR, pref)).toHaveLength(2);
    }
  });

  it('no inventa motores que no esten disponibles', () => {
    // Si en este aparato solo hay uno, forzar el otro no lo hace aparecer.
    expect(orderEngines(['whisper-local'], 'system')).toEqual(['whisper-local']);
    expect(orderEngines(['web-speech'], 'on-device')).toEqual(['web-speech']);
    expect(orderEngines([], 'on-device')).toEqual([]);
  });
});
