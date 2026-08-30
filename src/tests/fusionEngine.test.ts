import { describe, it, expect, beforeEach } from 'vitest';

import { FusionEngine, getFusionEngine, clearAllLanes } from '@/shared/risk';
import { DEFAULT_FUSION_CONFIG } from '@/shared/risk/config';

const T0 = 1_700_000_000_000;

describe('acumulacion, no promedio', () => {
  it('una señal baja no puede hundir una alta', () => {
    // ESTA ES LA REGRESION QUE IMPORTA.
    //
    // El motor anterior promediaba, asi que un hallazgo local de 80 puntos mas
    // un modelo diciendo "esto no es fraude" daba una media tranquilizadora. Con
    // mensajes que nombraban un delito y la direccion de la victima, el usuario
    // acabo viendo "0/100 — no se detectaron patrones". Paso dos veces, con
    // usuarios reales.
    const engine = new FusionEngine();
    engine.add({ type: 'local-patterns', value: 80, confidence: 1, timestamp: T0 });

    const soloLocal = engine.fuse(T0 + 100).score;

    engine.add({ type: 'llm-risk', value: 5, confidence: 0.95, timestamp: T0 + 50 });
    const conModeloTranquilo = engine.fuse(T0 + 100).score;

    // El modelo puede no aportar. Lo que no puede es restar.
    expect(conModeloTranquilo).toBeGreaterThanOrEqual(soloLocal);
    expect(conModeloTranquilo).toBeGreaterThanOrEqual(70);
  });

  it('dos señales medias suman mas que cualquiera de las dos', () => {
    const sola = new FusionEngine();
    sola.add({ type: 'local-patterns', value: 45, confidence: 1, timestamp: T0 });

    const dos = new FusionEngine();
    dos.add({ type: 'local-patterns', value: 45, confidence: 1, timestamp: T0 });
    dos.add({ type: 'llm-risk', value: 45, confidence: 1, timestamp: T0 });

    expect(dos.fuse(T0).score).toBeGreaterThan(sola.fuse(T0).score);
  });

  it('mucho ruido debil no llega a alarma', () => {
    const engine = new FusionEngine();
    for (let i = 0; i < 8; i += 1) {
      engine.add({ type: 'llm-risk', value: 10, confidence: 0.5, timestamp: T0 + i * 1000 });
    }
    expect(engine.fuse(T0 + 8000).band).toBe('SEGURO');
  });

  it('nunca se pasa de 100', () => {
    const engine = new FusionEngine();
    for (let i = 0; i < 20; i += 1) {
      engine.add({ type: 'explicit-threat', value: 100, confidence: 1, timestamp: T0 + i });
    }
    expect(engine.fuse(T0 + 20).score).toBeLessThanOrEqual(100);
  });
});

describe('corroboracion — §3, ninguna alerta por una señal aislada', () => {
  it('una sola fuente no alerta, aunque la banda suba', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'local-patterns', value: 60, confidence: 1, timestamp: T0 });

    const result = engine.fuse(T0);
    expect(result.band).not.toBe('SEGURO');
    expect(result.corroborated).toBe(false);
    // La informacion se muestra; la alarma se retiene.
    expect(result.alert).toBe(false);
  });

  it('dos fuentes independientes si alertan', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'local-patterns', value: 45, confidence: 1, timestamp: T0 });
    engine.add({ type: 'llm-risk', value: 55, confidence: 0.8, timestamp: T0 + 1000 });

    const result = engine.fuse(T0 + 1500);
    expect(result.corroborated).toBe(true);
    expect(result.alert).toBe(true);
  });

  it('el mismo detector repitiendose no es corroboracion', () => {
    // Un detector insistiendo es un detector, no dos fuentes coincidiendo.
    const engine = new FusionEngine();
    engine.add({ type: 'local-patterns', value: 48, confidence: 1, timestamp: T0 });
    engine.add({ type: 'local-patterns', value: 50, confidence: 1, timestamp: T0 + 4000 });
    engine.add({ type: 'local-patterns', value: 46, confidence: 1, timestamp: T0 + 8000 });

    const result = engine.fuse(T0 + 9000);
    expect(result.corroborated).toBe(false);
    expect(result.alert).toBe(false);
  });

  it('nada nunca alerta', () => {
    const result = new FusionEngine().fuse(T0);
    expect(result).toMatchObject({ score: 0, band: 'SEGURO', alert: false, signalCount: 0 });
  });

  it('una señal debil no cuenta como corroboracion', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'local-patterns', value: 55, confidence: 1, timestamp: T0 });
    // Por debajo de minEvidence: existe, pero no sostiene nada.
    engine.add({ type: 'llm-risk', value: 4, confidence: 0.3, timestamp: T0 });

    expect(engine.fuse(T0).corroborated).toBe(false);
  });
});

describe('excepcion tasada para amenazas explicitas', () => {
  it('una amenaza explicita alerta sola', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'explicit-threat', value: 82, confidence: 1, timestamp: T0 });

    const result = engine.fuse(T0);
    expect(result.explicitThreat).toBe(true);
    expect(result.corroborated).toBe(false);
    // Sin corroborar y aun asi alerta: es el caso que la lista cerrada protege.
    expect(result.alert).toBe(true);
  });

  it('la excepcion no convierte cualquier cosa en alerta', () => {
    // Una amenaza explicita tan debil que no llega ni a SOSPECHOSO no alarma:
    // la excepcion salta la corroboracion, no el umbral.
    const engine = new FusionEngine();
    engine.add({ type: 'explicit-threat', value: 8, confidence: 0.5, timestamp: T0 });

    const result = engine.fuse(T0);
    expect(result.band).toBe('SEGURO');
    expect(result.alert).toBe(false);
  });
});

describe('ventana deslizante', () => {
  it('olvida lo que salio de la ventana', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'local-patterns', value: 90, confidence: 1, timestamp: T0 });

    expect(engine.fuse(T0 + 1000).score).toBeGreaterThan(0);
    expect(engine.fuse(T0 + DEFAULT_FUSION_CONFIG.windowMs + 1).score).toBe(0);
  });

  it('dos señales separadas por mas de la ventana no se corroboran', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'local-patterns', value: 60, confidence: 1, timestamp: T0 });
    engine.add({ type: 'llm-risk', value: 55, confidence: 0.8, timestamp: T0 + 40_000 });

    expect(engine.fuse(T0 + 40_500).corroborated).toBe(false);
  });

  it('lo reciente pesa mas que lo viejo dentro de la ventana', () => {
    const reciente = new FusionEngine();
    reciente.add({ type: 'local-patterns', value: 60, confidence: 1, timestamp: T0 + 29_000 });

    const viejo = new FusionEngine();
    viejo.add({ type: 'local-patterns', value: 60, confidence: 1, timestamp: T0 });

    expect(reciente.fuse(T0 + 29_500).score).toBeGreaterThan(viejo.fuse(T0 + 29_500).score);
  });
});

describe('confianza', () => {
  it('una señal con poca confianza pesa menos', () => {
    const segura = new FusionEngine();
    segura.add({ type: 'llm-risk', value: 70, confidence: 1, timestamp: T0 });

    const dudosa = new FusionEngine();
    dudosa.add({ type: 'llm-risk', value: 70, confidence: 0.3, timestamp: T0 });

    expect(dudosa.fuse(T0).score).toBeLessThan(segura.fuse(T0).score);
  });

  it('la confianza del resultado sube al corroborar', () => {
    const sola = new FusionEngine();
    sola.add({ type: 'local-patterns', value: 50, confidence: 1, timestamp: T0 });

    const corroborada = new FusionEngine();
    corroborada.add({ type: 'local-patterns', value: 50, confidence: 1, timestamp: T0 });
    corroborada.add({ type: 'llm-risk', value: 50, confidence: 1, timestamp: T0 });

    expect(corroborada.fuse(T0).confidence).toBeGreaterThan(sola.fuse(T0).confidence);
  });

  it('acota valores imposibles en vez de propagarlos', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'llm-risk', value: 500, confidence: 9, timestamp: T0 });
    engine.add({ type: 'llm-risk', value: Number.NaN, confidence: Number.NaN, timestamp: T0 });

    const result = engine.fuse(T0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('carriles independientes', () => {
  beforeEach(() => clearAllLanes());

  it('una llamada sospechosa no contamina el portapapeles', () => {
    // El motor anterior era un singleton global compartido por los cuatro
    // escudos, asi que esto era exactamente lo que pasaba.
    getFusionEngine('voice').addSignal('local-patterns', 90, 1);

    expect(getFusionEngine('clipboard').fuse().score).toBe(0);
    expect(getFusionEngine('voice').fuse().score).toBeGreaterThan(0);
  });

  it('devuelve siempre el mismo motor para un carril', () => {
    expect(getFusionEngine('screen')).toBe(getFusionEngine('screen'));
  });

  it('clearAllLanes vacia todo', () => {
    getFusionEngine('voice').addSignal('local-patterns', 90, 1);
    getFusionEngine('ui').addSignal('llm-risk', 80, 1);
    clearAllLanes();

    expect(getFusionEngine('voice').fuse().score).toBe(0);
    expect(getFusionEngine('ui').fuse().score).toBe(0);
  });
});

describe('drivers', () => {
  it('nombra lo que sostuvo el resultado, de mayor a menor', () => {
    const engine = new FusionEngine();
    engine.add({ type: 'llm-risk', value: 20, confidence: 0.5, timestamp: T0 });
    engine.add({ type: 'explicit-threat', value: 85, confidence: 1, timestamp: T0 });

    const drivers = engine.fuse(T0).drivers;
    expect(drivers[0]?.type).toBe('explicit-threat');
    expect(drivers[0]!.evidence).toBeGreaterThan(drivers[1]!.evidence);
  });
});
