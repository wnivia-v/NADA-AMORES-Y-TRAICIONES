// =============================================================================
// Tiers de dispositivo
//
// El escudo de video corria igual en todas partes: `delegate: 'GPU'` fijo en el
// codigo y un bucle de requestAnimationFrame que analizaba TODOS los frames. En
// un portatil de sobremesa eso pasa desapercibido. En un movil de gama media es
// otra cosa — la CPU se satura, el navegador empieza a saltarse frames, el
// telefono se calienta y el sistema acaba estrangulando el proceso. Y todo eso
// ocurre justo mientras la persona esta en la videollamada que queriamos
// vigilar.
//
// Asi que la capacidad se mide al arrancar y el trabajo se ajusta a ella. Un
// analisis a 5 fps que aguanta toda la llamada protege mas que uno a 30 fps que
// se muere a los dos minutos.
// =============================================================================

export type TierId = 'desktop' | 'mid' | 'low';

export interface TierBudget {
  id: TierId;
  /** Frames analizados por segundo. El resto se descartan sin tocarlos. */
  targetFps: number;
  /**
   * Si se calcula rPPG (pulso por variacion de color de la piel).
   *
   * Es lo primero que cae al degradar: necesita leer pixeles a resolucion
   * suficiente y promediarlos frame a frame, que es con diferencia lo mas caro
   * de todo el pipeline, y es la señal mas fragil de las cuatro.
   */
  rppg: boolean;
  /** Lado mayor al que se reduce el frame antes de analizarlo. */
  maxFrameSize: number;
  /** Delegado de MediaPipe. GPU cuando la hay, CPU (WASM+SIMD) cuando no. */
  delegate: 'GPU' | 'CPU';
}

export const TIER_BUDGETS: Record<TierId, TierBudget> = {
  // Escritorio: el analisis completo que describe el brief.
  desktop: { id: 'desktop', targetFps: 30, rppg: true, maxFrameSize: 640, delegate: 'GPU' },
  // Gama media: ~5 fps y sin rPPG, tal cual lo especifica la Fase 4.
  mid: { id: 'mid', targetFps: 5, rppg: false, maxFrameSize: 480, delegate: 'GPU' },
  // Suelo: sigue habiendo parpadeo, pose y deteccion de bucle, que no necesitan
  // GPU. Es poco, pero es mucho mas que apagar el escudo.
  low: { id: 'low', targetFps: 2, rppg: false, maxFrameSize: 320, delegate: 'CPU' },
};

export interface CapabilityProbe {
  /** navigator.hardwareConcurrency, si el navegador lo expone. */
  cores?: number;
  /** navigator.deviceMemory en GB, si el navegador lo expone. */
  memoryGb?: number;
  /** Si el equipo se comporta como movil o tablet. */
  mobile?: boolean;
  /** Si hay WebGPU disponible de verdad (no solo el objeto en navigator). */
  webgpu?: boolean;
  /** Si el runtime de WASM admite SIMD. */
  wasmSimd?: boolean;
}

/**
 * Elige el tier a partir de lo que se ha podido medir.
 *
 * Funcion pura: recibe la medicion y devuelve el presupuesto, sin tocar
 * `navigator` ni nada global. Asi se puede probar cada combinacion sin
 * navegador, que es la unica forma de tener confianza en la degradacion —
 * probarla a mano exigiria tener a mano un movil de cada gama.
 *
 * Ante la duda, degrada. Un dispositivo mal clasificado hacia abajo analiza
 * menos de lo que podria; mal clasificado hacia arriba se ahoga y deja de
 * analizar del todo.
 */
export function pickTier(probe: CapabilityProbe): TierBudget {
  const cores = probe.cores ?? 2;
  const memoryGb = probe.memoryGb ?? 2;

  // Sin GPU ni SIMD no hay forma de sostener un ritmo util.
  if (!probe.webgpu && !probe.wasmSimd) return TIER_BUDGETS.low;

  if (probe.mobile) {
    // Un movil potente llega a gama media, nunca a escritorio: aunque le sobre
    // CPU, el presupuesto termico es el que manda y no se puede medir.
    return cores >= 6 && memoryGb >= 4 ? TIER_BUDGETS.mid : TIER_BUDGETS.low;
  }

  if (cores >= 8 && memoryGb >= 8 && probe.webgpu) return TIER_BUDGETS.desktop;
  if (cores >= 4) return TIER_BUDGETS.mid;
  return TIER_BUDGETS.low;
}

/** Sin GPU se cae a CPU, que en la practica es WASM con SIMD. */
export function withDelegateFallback(budget: TierBudget, webgpu: boolean): TierBudget {
  if (webgpu || budget.delegate === 'CPU') return budget;
  return { ...budget, delegate: 'CPU' };
}

/**
 * Mide el dispositivo. Es la unica funcion del modulo que toca APIs del
 * navegador, para que todo lo demas se pueda probar sin uno.
 */
export async function probeDevice(): Promise<CapabilityProbe> {
  const nav = globalThis.navigator as (Navigator & {
    deviceMemory?: number;
    gpu?: { requestAdapter(): Promise<unknown> };
  }) | undefined;

  if (!nav) return { webgpu: false, wasmSimd: false };

  const mobile = /android|iphone|ipad|ipod|mobile/i.test(nav.userAgent ?? '');

  // No basta con que `navigator.gpu` exista: hay navegadores que lo exponen y
  // luego no dan adaptador. Lo que importa es si se puede obtener uno.
  let webgpu = false;
  try {
    webgpu = Boolean(nav.gpu && (await nav.gpu.requestAdapter()));
  } catch {
    webgpu = false;
  }

  return {
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    mobile,
    webgpu,
    wasmSimd: detectWasmSimd(),
  };
}

/**
 * Modulo WASM minimo que solo valida si el runtime entiende una instruccion
 * SIMD (v128). Es la forma estandar de detectarlo: si el modulo compila, hay
 * SIMD; si lanza, no la hay.
 */
function detectWasmSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
        0x03, 0x02, 0x01, 0x00,
        0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x26, 0x0b,
      ]),
    );
  } catch {
    return false;
  }
}
