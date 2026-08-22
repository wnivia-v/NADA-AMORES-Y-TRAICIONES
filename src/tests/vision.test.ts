import { describe, it, expect } from 'vitest';

import { pickTier, withDelegateFallback, detectWasmSimd, TIER_BUDGETS } from '@/shared/vision/deviceTier';
import { FrameBudget } from '@/shared/vision/frameBudget';
import { frameSignature, hammingDistance, LoopDetector, HASH_GRID } from '@/shared/vision/loopDetection';
import {
  startChallenge,
  evaluateChallenge,
  pickGesture,
  challengeSignalValue,
  CHALLENGE_WINDOW_MS,
  type PoseSample,
} from '@/shared/vision/challenge';

/** PRNG sembrado: los tests tienen que dar lo mismo en cada ejecucion. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('tiers de dispositivo', () => {
  it('un escritorio potente con WebGPU llega al analisis completo', () => {
    const tier = pickTier({ cores: 12, memoryGb: 16, mobile: false, webgpu: true, wasmSimd: true });
    expect(tier.id).toBe('desktop');
    expect(tier.targetFps).toBe(30);
    expect(tier.rppg).toBe(true);
  });

  it('un movil nunca llega a escritorio aunque le sobre CPU', () => {
    // El presupuesto termico manda, y no hay forma de medirlo desde el
    // navegador. Un movil de 8 nucleos se calienta igual.
    const tier = pickTier({ cores: 8, memoryGb: 8, mobile: true, webgpu: true, wasmSimd: true });
    expect(tier.id).toBe('mid');
    expect(tier.rppg).toBe(false);
  });

  it('gama media degrada a ~5 fps y sin rPPG, como pide la Fase 4', () => {
    const tier = pickTier({ cores: 4, memoryGb: 4, mobile: false, webgpu: true, wasmSimd: true });
    expect(tier.targetFps).toBe(5);
    expect(tier.rppg).toBe(false);
  });

  it('sin GPU ni SIMD cae al suelo, pero no se apaga', () => {
    const tier = pickTier({ cores: 8, memoryGb: 8, webgpu: false, wasmSimd: false });
    expect(tier.id).toBe('low');
    // Sigue analizando: parpadeo, pose y bucle no necesitan GPU.
    expect(tier.targetFps).toBeGreaterThan(0);
  });

  it('ante la duda degrada', () => {
    // Un navegador que no expone nada no puede tratarse como potente.
    expect(pickTier({}).id).toBe('low');
  });

  it('la sonda de SIMD detecta el SIMD que este runtime tiene', () => {
    // Cualquier motor capaz de correr estos tests admite SIMD desde hace años.
    // Un false aqui no significa "no hay SIMD": significa que el modulo de
    // sonda esta mal formado y validate() falla por eso — que es exactamente lo
    // que pasaba antes, y dejaba a todo dispositivo sin WebGPU clavado a 2 fps.
    expect(detectWasmSimd()).toBe(true);
  });

  it('sin WebGPU el delegado cae a CPU (WASM+SIMD)', () => {
    // El codigo tenia delegate: 'GPU' fijo, sin ninguna alternativa.
    expect(withDelegateFallback(TIER_BUDGETS.desktop, false).delegate).toBe('CPU');
    expect(withDelegateFallback(TIER_BUDGETS.desktop, true).delegate).toBe('GPU');
  });
});

describe('presupuesto de frames', () => {
  it('analiza al ritmo objetivo y descarta el resto', () => {
    const budget = new FrameBudget({ targetFps: 5 }); // un frame cada 200 ms
    expect(budget.shouldAnalyse(0)).toBe(true);
    expect(budget.shouldAnalyse(50)).toBe(false);
    expect(budget.shouldAnalyse(150)).toBe(false);
    expect(budget.shouldAnalyse(200)).toBe(true);

    const state = budget.state();
    expect(state.analysed).toBe(2);
    expect(state.dropped).toBe(2);
  });

  it('un pico aislado no degrada la sesion entera', () => {
    // La primera inferencia de MediaPipe siempre se pasa de presupuesto.
    const budget = new FrameBudget({ targetFps: 30, overrunsBeforeBackoff: 5 });
    budget.recordAnalysisTime(500);
    expect(budget.state().throttled).toBe(false);
  });

  it('pero pasarse de forma sostenida si degrada', () => {
    const budget = new FrameBudget({ targetFps: 30, overrunsBeforeBackoff: 5 });
    for (let i = 0; i < 5; i += 1) budget.recordAnalysisTime(500);

    const state = budget.state();
    expect(state.throttled).toBe(true);
    expect(state.currentFps).toBeLessThan(30);
  });

  it('nunca baja del suelo', () => {
    const budget = new FrameBudget({ targetFps: 30, minFps: 2, overrunsBeforeBackoff: 1 });
    for (let i = 0; i < 50; i += 1) budget.recordAnalysisTime(100_000);
    expect(budget.state().currentFps).toBe(2);
  });

  it('recupera despacio, no de golpe', () => {
    // Bajar rapido y subir lento es lo que evita el vaiven.
    const budget = new FrameBudget({
      targetFps: 30, overrunsBeforeBackoff: 1, goodRunsBeforeRecover: 3,
    });
    budget.recordAnalysisTime(10_000);
    const degradado = budget.state().currentFps;

    for (let i = 0; i < 3; i += 1) budget.recordAnalysisTime(1);
    expect(budget.state().currentFps).toBe(degradado + 1);
  });
});

describe('deteccion de bucle', () => {
  const cells = HASH_GRID * HASH_GRID;
  const flat = (seed: number) =>
    Array.from({ length: cells }, (_, i) => (i * 7 + seed * 13) % 256);

  it('la firma ignora el brillo global', () => {
    // Subir el brillo de todo el frame no cambia que celda es mas clara que la
    // media, asi que la firma no se mueve. Es lo que la hace util contra el
    // ruido de compresion.
    const base = flat(1);
    const masClaro = base.map((v) => Math.min(255, v + 30));
    expect(frameSignature(masClaro)).toBe(frameSignature(base));
  });

  it('pero si detecta que algo se mueve dentro', () => {
    const a = frameSignature(flat(1));
    const b = frameSignature(flat(9));
    expect(hammingDistance(a, b)).toBeGreaterThan(6);
  });

  it('rechaza una matriz del tamaño equivocado en vez de calcular basura', () => {
    expect(() => frameSignature([1, 2, 3])).toThrow();
  });

  it('detecta imagen congelada', () => {
    const detector = new LoopDetector({ frozenRun: 5 });
    const congelada = frameSignature(flat(3));

    let finding = null;
    for (let i = 0; i < 8; i += 1) finding = detector.push(congelada, i * 200);

    expect(finding?.kind).toBe('frozen');
  });

  it('detecta un video en bucle y estima su periodo', () => {
    // Ciclo de 20 frames a 5 fps = 4 segundos.
    const detector = new LoopDetector({ loopRun: 8 });
    const ciclo = Array.from({ length: 20 }, (_, i) => frameSignature(flat(i + 1)));

    let finding = null;
    for (let i = 0; i < 20 * 5 && !finding; i += 1) {
      finding = detector.push(ciclo[i % 20]!, i * 200);
    }

    expect(finding?.kind).toBe('looping');
    expect(finding?.periodSeconds).toBeCloseTo(4, 0);
  });

  it('una persona quieta pero viva no cuenta como bucle', () => {
    // Ojo con el fixture: la primera version de este test usaba flat(i), que
    // resulta ser periodico —(i*7 + i*13) % 256 cicla cada 64— y el detector lo
    // cazó como bucle. Tenia razon el detector y no el test. Aqui la secuencia
    // se genera con un PRNG sembrado: reproducible entre ejecuciones, pero sin
    // periodo corto que encontrar.
    const rand = mulberry32(1234);
    const detector = new LoopDetector();

    let finding = null;
    for (let i = 0; i < 300; i += 1) {
      const luma = Array.from({ length: cells }, () => Math.floor(rand() * 256));
      finding = detector.push(frameSignature(luma), i * 200);
      if (finding?.kind === 'looping') break;
    }
    expect(finding?.kind).not.toBe('looping');
  });
});

describe('reto activo', () => {
  const baseline: PoseSample = { yaw: 0, pitch: 0, blinkCount: 0, faceScale: 0.3 };

  it('no repite el gesto anterior', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(pickGesture('turn-left', () => i / 20).id).not.toBe('turn-left');
    }
  });

  it('se supera al hacer el gesto pedido', () => {
    const state = startChallenge(0, undefined, () => 0); // turn-left
    const girado: PoseSample = { ...baseline, yaw: -25 };
    expect(evaluateChallenge(state, baseline, girado, 1000).outcome).toBe('passed');
  });

  it('mide el CAMBIO de pose, no la postura absoluta', () => {
    // Alguien sentado de lado ya tiene yaw alto sin haber girado nada. Exigirle
    // una postura absoluta seria pedirle que se recoloque para demostrar que
    // existe.
    const deLado: PoseSample = { ...baseline, yaw: -30 };
    const state = startChallenge(0, undefined, () => 0); // turn-left
    expect(evaluateChallenge(state, deLado, deLado, 500).outcome).toBe('pending');

    const giradoDesdeAhi: PoseSample = { ...deLado, yaw: -55 };
    expect(evaluateChallenge(state, deLado, giradoDesdeAhi, 900).outcome).toBe('passed');
  });

  it('se agota si nadie responde', () => {
    const state = startChallenge(0, undefined, () => 0);
    const resultado = evaluateChallenge(state, baseline, baseline, CHALLENGE_WINDOW_MS + 1);
    expect(resultado.outcome).toBe('failed');
  });

  it('un reto superado resta sospecha; uno fallado suma poco', () => {
    // Fallar es casi siempre distraccion, no suplantacion. Con la regla de
    // corroboracion de la Fase 2, un reto fallado solo no alarma a nadie.
    expect(challengeSignalValue('passed')).toBe(0);
    expect(challengeSignalValue('failed')).toBeLessThan(40);
    expect(challengeSignalValue('pending')).toBeNull();
  });
});
