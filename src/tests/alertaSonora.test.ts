// =============================================================================
// El tono no se repite mientras la amenaza sigue siendo la misma
//
// Reportado usando la app: "cada 15 segundos suena un sonido y vuelve a sonar".
//
// La causa estaba en la de-duplicacion: trabajaba sobre la FIRMA de tacticas, y
// esa firma cambia en cuanto la conversacion suma una frase nueva. Basta que
// aparezca un patron mas para que el conjunto sea distinto, deje de contar como
// la misma amenaza, y vuelva a sonar. En una conversacion sospechosa que sigue
// adelante, eso es un pitido cada pocos segundos.
//
// El escudo de video ya lo tenia resuelto y aqui faltaba. El aviso sonoro es
// para lo que la persona TODAVIA NO SABE: la primera deteccion, o una que ha
// empeorado. Mientras la misma amenaza continua, la evidencia se acumula en
// pantalla en silencio.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const tono = vi.hoisted(() => vi.fn());

vi.mock('@/utils/audioAlert', () => ({ playAlertTone: tono }));
vi.mock('@/services/voice', () => ({
  voiceRecognition: { start: vi.fn(), stop: vi.fn(), isSupported: () => true, isRunning: () => false, getActiveEngine: () => null },
  isEngineIndependentFailure: (c: string) => c === 'not-allowed' || c === 'no-microphone',
}));
vi.mock('@/services/safeBrowsingService', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true, threats: [] }),
}));
vi.mock('@/services/scamDatabase', () => ({
  scamDatabase: { lookup: vi.fn().mockResolvedValue({ found: false }), store: vi.fn() },
}));
vi.mock('@/services/aiProviders', () => ({ orchestrateAnalysis: vi.fn() }));
vi.mock('@/services/notificationService', () => ({
  notificationService: { sendThreatAlert: vi.fn() },
}));

import { protectionEngine } from '@/services/protectionEngine';
import type { ScamAnalysis, Verdict } from '@/store/useNadaStore';

const analisis = (verdict: Verdict, tactics: string[]): ScamAnalysis => ({
  verdict,
  riskScore: verdict === 'PELIGROSO' ? 85 : 50,
  tactics,
  explanation: '',
  scanSource: 'local',
  recommendations: [],
  alert: true,
});

const avisar = (verdict: Verdict, tactics: string[], carril = 'Voz') =>
  protectionEngine.triggerThreatAlert(analisis(verdict, tactics), 'prueba', carril);

describe('el tono de alerta no se convierte en un pitido', () => {
  const reiniciar = () => {
    // stop() vuelve enseguida si el motor no estaba encendido, asi que el
    // reinicio de verdad es el ciclo completo — que ademas es lo que hace la
    // persona cuando apaga y enciende la proteccion.
    protectionEngine.start();
    protectionEngine.stop();
    tono.mockClear();
  };

  beforeEach(reiniciar);

  it('la primera amenaza del carril suena', () => {
    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    expect(tono).toHaveBeenCalledTimes(1);
  });

  it('la misma amenaza, repetida, NO vuelve a sonar', () => {
    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    expect(tono).toHaveBeenCalledTimes(1);
  });

  it('y tampoco suena porque la lista de tacticas crezca — este era el fallo', () => {
    // Exactamente lo reportado: la conversacion sigue, aparece un patron mas,
    // la firma cambia, y antes eso bastaba para volver a sonar.
    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    avisar('SOSPECHOSO', ['Solicitud de dinero', 'Presion de urgencia']);
    avisar('SOSPECHOSO', ['Solicitud de dinero', 'Presion de urgencia', 'Aislamiento']);
    expect(tono).toHaveBeenCalledTimes(1);
  });

  it('pero si la cosa EMPEORA a peligroso, suena — eso la persona no lo sabia', () => {
    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    expect(tono).toHaveBeenCalledTimes(1);

    avisar('PELIGROSO', ['Solicitud de dinero', 'Canal de pago irrastreable']);
    expect(tono).toHaveBeenCalledTimes(2);
    expect(tono).toHaveBeenLastCalledWith('high');
  });

  it('y una vez peligroso, seguir peligroso ya no vuelve a sonar', () => {
    avisar('PELIGROSO', ['Canal de pago irrastreable']);
    avisar('PELIGROSO', ['Canal de pago irrastreable', 'Aislamiento']);
    expect(tono).toHaveBeenCalledTimes(1);
  });

  it('cada carril avisa por su cuenta: silenciar uno no esconde al otro', () => {
    avisar('SOSPECHOSO', ['Solicitud de dinero'], 'Voz');
    avisar('SOSPECHOSO', ['Solicitud de dinero'], 'Pantalla');
    expect(tono).toHaveBeenCalledTimes(2);
  });

  it('apagar y encender la proteccion vuelve a empezar de cero', () => {
    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    expect(tono).toHaveBeenCalledTimes(1);

    reiniciar();

    avisar('SOSPECHOSO', ['Solicitud de dinero']);
    expect(tono).toHaveBeenCalledTimes(1);
  });
});
