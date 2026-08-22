import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  eyeAspectRatio,
  mouthAspectRatio,
  landmarkJitter,
  faceScale,
  eulerFromMatrix,
  evaluateDeepfake,
  FaceAnalyzer,
  BLINK_WARMUP_MS,
  type Landmark,
  type BiometricSignals,
} from '@/shared/vision/faceSignals';
import { MEDIAPIPE_VERSION } from '@/shared/vision/protocol';

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Matriz de rotacion 4x4 en orden por columnas, construida con la MISMA
 * convencion que documenta eulerFromMatrix: R = Rz(roll)·Ry(yaw)·Rx(pitch).
 *
 * Que el test la construya a mano en vez de reutilizar codigo de produccion es
 * el punto: si la extraccion y la construccion compartieran implementacion, el
 * test pasaria con la convencion equivocada.
 */
function rotation(yawDeg: number, pitchDeg: number, rollDeg: number): number[] {
  const y = rad(yawDeg), p = rad(pitchDeg), r = rad(rollDeg);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);

  const R = [
    [cr * cy, cr * sy * sp - sr * cp, cr * sy * cp + sr * sp],
    [sr * cy, sr * sy * sp + cr * cp, sr * sy * cp - cr * sp],
    [-sy, cy * sp, cy * cp],
  ];

  const m = new Array<number>(16).fill(0);
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) m[col * 4 + row] = R[row]![col]!;
  }
  m[15] = 1;
  return m;
}

/** Malla de 478 puntos con todo en el centro, para ir moviendo solo lo que interesa. */
function mesh(): Landmark[] {
  return Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
}

function withEye(openness: number): Landmark[] {
  const m = mesh();
  m[33] = { x: 0.40, y: 0.40 };
  m[133] = { x: 0.50, y: 0.40 };
  m[160] = { x: 0.43, y: 0.40 };
  m[144] = { x: 0.43, y: 0.40 + openness };
  m[158] = { x: 0.47, y: 0.40 };
  m[153] = { x: 0.47, y: 0.40 + openness };
  return m;
}

describe('pose de la cabeza a partir de la matriz de MediaPipe', () => {
  it('la identidad es mirar de frente', () => {
    const pose = eulerFromMatrix(rotation(0, 0, 0));
    expect(pose?.yaw).toBeCloseTo(0, 5);
    expect(pose?.pitch).toBeCloseTo(0, 5);
    expect(pose?.roll).toBeCloseTo(0, 5);
  });

  it('recupera los tres angulos combinados', () => {
    const pose = eulerFromMatrix(rotation(-25, 12, 8));
    expect(pose?.yaw).toBeCloseTo(-25, 4);
    expect(pose?.pitch).toBeCloseTo(12, 4);
    expect(pose?.roll).toBeCloseTo(8, 4);
  });

  it('no confunde girar la cabeza con inclinarla', () => {
    // Es la confusion clasica al extraer Euler con la convencion equivocada, y
    // aqui costaria caro: el reto "gira la cabeza" se daria por superado con
    // solo ladearla, que es algo que una grabacion tambien hace.
    const soloYaw = eulerFromMatrix(rotation(-30, 0, 0));
    expect(soloYaw?.yaw).toBeCloseTo(-30, 4);
    expect(soloYaw?.roll).toBeCloseTo(0, 4);

    const soloRoll = eulerFromMatrix(rotation(0, 0, -30));
    expect(soloRoll?.yaw).toBeCloseTo(0, 4);
    expect(soloRoll?.roll).toBeCloseTo(-30, 4);
  });

  it('de perfil no inventa un roll: devuelve 0 en vez de ruido', () => {
    // A 90 grados de yaw, pitch y roll dejan de ser separables. Con la cara asi
    // MediaPipe ya casi no ve landmarks; lo importante es que no salga NaN.
    const pose = eulerFromMatrix(rotation(90, 20, 40));
    expect(pose?.yaw).toBeCloseTo(90, 3);
    expect(Number.isFinite(pose?.roll ?? NaN)).toBe(true);
    expect(pose?.roll).toBe(0);
  });

  it('una matriz incompleta devuelve null en vez de leer basura', () => {
    expect(eulerFromMatrix([1, 0, 0, 0])).toBeNull();
  });
});

describe('geometria facial', () => {
  it('distingue un ojo abierto de uno cerrado', () => {
    expect(eyeAspectRatio(withEye(0.03), 'left')).toBeGreaterThan(0.2);
    expect(eyeAspectRatio(withEye(0.004), 'left')).toBeLessThan(0.2);
  });

  it('sin landmarks devuelve el valor neutro, no NaN', () => {
    expect(eyeAspectRatio([], 'left')).toBe(0.3);
    expect(mouthAspectRatio([])).toBe(0);
  });

  it('un ojo de anchura cero no cuenta como ojo cerrado', () => {
    // Una deteccion que colapsa todos los landmarks en un punto no es alguien
    // parpadeando: es una medida que no salio. Contarla como parpadeo
    // fabricaria parpadeos que nadie ha dado.
    const colapsado = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    expect(eyeAspectRatio(colapsado, 'left')).toBe(0.3);
  });

  it('la boca abierta da un MAR mayor que la cerrada', () => {
    const cerrada = mesh();
    cerrada[13] = { x: 0.5, y: 0.60 };
    cerrada[14] = { x: 0.5, y: 0.605 };
    cerrada[61] = { x: 0.44, y: 0.60 };
    cerrada[291] = { x: 0.56, y: 0.60 };

    const abierta = mesh();
    abierta[13] = { x: 0.5, y: 0.58 };
    abierta[14] = { x: 0.5, y: 0.64 };
    abierta[61] = { x: 0.44, y: 0.61 };
    abierta[291] = { x: 0.56, y: 0.61 };

    expect(mouthAspectRatio(abierta)).toBeGreaterThan(mouthAspectRatio(cerrada));
  });

  it('el primer frame no tiene jitter: no hay con que comparar', () => {
    expect(landmarkJitter(mesh(), null)).toBe(0);
  });

  it('la escala de la cara sale de su caja envolvente', () => {
    const m = mesh();
    m[0] = { x: 0.2, y: 0.1 };
    m[1] = { x: 0.6, y: 0.5 };
    expect(faceScale(m)).toBeCloseTo(0.16, 6);
  });
});

describe('heuristica de deepfake', () => {
  const base: BiometricSignals = {
    earLeft: 0.3, earRight: 0.3, blinkRate: 0,
    lipSyncScore: 0.75, lipSyncMeasured: false,
    jitterScore: 0.1, headPoseStable: true,
  };

  it('ninguna señal aislada basta', () => {
    expect(evaluateDeepfake({ ...base, jitterScore: 0.9, headPoseStable: false }, false)).toBe(false);
    expect(evaluateDeepfake({ ...base, blinkRate: 0 }, true)).toBe(false);
  });

  it('dos señales fuertes si', () => {
    expect(evaluateDeepfake({ ...base, blinkRate: 0, jitterScore: 0.9, headPoseStable: false }, true)).toBe(true);
  });

  it('una sincronia labial SIN MEDIR no puede acusar a nadie', () => {
    // Es el caso de una llamada sin pista de audio. Antes salia 0.9 por defecto
    // y se contaba como prueba a favor; ahora no cuenta en ninguna direccion.
    const sinAudio = { ...base, lipSyncScore: 0.2, lipSyncMeasured: false, jitterScore: 0.9, headPoseStable: false };
    expect(evaluateDeepfake(sinAudio, false)).toBe(false);
    expect(evaluateDeepfake({ ...sinAudio, lipSyncMeasured: true }, false)).toBe(true);
  });
});

describe('FaceAnalyzer', () => {
  it('no juzga el parpadeo antes de que la tasa signifique algo', () => {
    const analyzer = new FaceAnalyzer();
    const cerrado = withEye(0.004);

    // Cara quieta, ojos cerrados, recien empezada la sesion.
    const pronto = analyzer.push(cerrado, 1_000, null, null);
    expect(pronto.signals.blinkRate).toBeGreaterThan(0);
    expect(analyzer.blinkRateReady(1_000)).toBe(false);
    // Y no aparece nombrado en la explicacion, porque no conto para nada.
    expect(pronto.explanation).not.toContain('parpadeo');

    expect(analyzer.blinkRateReady(BLINK_WARMUP_MS + 1_000)).toBe(true);
  });

  it('sin audio, la sincronia labial queda sin medir', () => {
    const analyzer = new FaceAnalyzer();
    const result = analyzer.push(mesh(), 0, null, null);
    expect(result.signals.lipSyncMeasured).toBe(false);
    expect(result.explanation).toContain('sin verificar');
  });

  it('entrega la pose que necesita el reto activo', () => {
    const analyzer = new FaceAnalyzer();
    const result = analyzer.push(withEye(0.03), 0, null, { yaw: -22, pitch: 5, roll: 0 });
    expect(result.pose.yaw).toBe(-22);
    expect(result.pose.faceScale).toBeGreaterThan(0);
  });

  it('reset borra la sesion, no solo el ultimo frame', () => {
    const analyzer = new FaceAnalyzer();
    analyzer.push(withEye(0.004), 0, null, null);
    analyzer.reset();
    expect(analyzer.blinkRateReady(BLINK_WARMUP_MS + 1)).toBe(false);
    expect(analyzer.push(mesh(), 10, null, null).pose.blinkCount).toBe(0);
  });
});

describe('version de MediaPipe', () => {
  it('el WASM del CDN va clavado a la version instalada', () => {
    // El JS sale del bundle (npm) y el WASM del CDN: son dos mitades del mismo
    // binario. El codigo anterior pedia `@latest`, o sea que la mitad del CDN
    // podia cambiar sola y dejar de encajar sin que nadie desplegara nada.
    const installed = JSON.parse(
      readFileSync('node_modules/@mediapipe/tasks-vision/package.json', 'utf-8'),
    ) as { version: string };
    expect(MEDIAPIPE_VERSION).toBe(installed.version);
  });
});
