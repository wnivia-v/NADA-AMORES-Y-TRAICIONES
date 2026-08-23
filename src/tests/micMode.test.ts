// =============================================================================
// Como se pide el microfono
//
// Reportado usando la app: "un sitio web esta tratando de utilizar el
// microfono... no permite audio de Spotify y microfono a la vez".
//
// No lo impedia el navegador: lo pedia NADA. echoCancellation en true hace que
// Chrome abra el microfono como VOICE_COMMUNICATION en Android —modo llamada— y
// en ese modo el sistema pausa lo que suene.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { micMode, setMicMode, audioConstraints } from '@/services/voice/micMode';

describe('modo de microfono', () => {
  beforeEach(() => localStorage.clear());

  it('por defecto va aislado: mejor transcripcion para una llamada', () => {
    expect(micMode()).toBe('aislado');
  });

  it('un valor corrupto no enciende la convivencia por accidente', () => {
    localStorage.setItem('nada-mic-mode', 'lo-que-sea');
    expect(micMode()).toBe('aislado');
  });

  it('se guarda y se recupera', () => {
    setMicMode('convivir');
    expect(micMode()).toBe('convivir');
  });
});

describe('restricciones que se le piden a getUserMedia', () => {
  it('aislado pide el procesado completo', () => {
    expect(audioConstraints('aislado')).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it('convivir apaga los tres EXPLICITAMENTE, no los omite', () => {
    // Omitirlos deja elegir al navegador, y Chrome elige procesado — que es
    // justo lo que se quiere evitar. Ausente no es lo mismo que false.
    const c = audioConstraints('convivir');
    expect(c).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    for (const clave of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const) {
      expect(clave in c).toBe(true);
    }
  });

  it('sin argumento lee la preferencia guardada', () => {
    setMicMode('convivir');
    expect(audioConstraints().echoCancellation).toBe(false);
    setMicMode('aislado');
    expect(audioConstraints().echoCancellation).toBe(true);
  });
});
