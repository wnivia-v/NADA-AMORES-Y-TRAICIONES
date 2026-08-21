// =============================================================================
// Presupuesto de frames y gestion termica
//
// El bucle anterior era `requestAnimationFrame` llamando a MediaPipe con cada
// frame que llegaba. Eso no es una decision de rendimiento, es la ausencia de
// una: el ritmo lo marcaba el navegador, y el navegador lo marca segun el
// refresco de la pantalla, que no tiene nada que ver con lo que el dispositivo
// aguanta.
//
// Aqui el ritmo se decide y se sostiene:
//
//   1. Se analiza a `targetFps`, no a lo que dé la pantalla. Los frames
//      intermedios se descartan sin tocarlos — descartarlos es gratis, y es lo
//      que la Fase 4 llama muestrear en vez de procesar todos.
//   2. Si el analisis tarda mas de lo que dura su hueco de forma SOSTENIDA, se
//      baja el ritmo. Un pico aislado no cuenta: la primera inferencia siempre
//      es lenta, y castigarla degradaria toda la sesion por un frame.
//   3. Al recuperarse se sube otra vez, mas despacio de lo que se bajo. Bajar
//      rapido y subir lento evita el vaiven de estar todo el rato cambiando de
//      ritmo, que es peor que quedarse en el ritmo bajo.
//
// Sin reloj propio: `now` entra como parametro. Un planificador que llama a
// Date.now() por dentro no se puede probar sin esperar en tiempo real.
// =============================================================================

export interface FrameBudgetOptions {
  targetFps: number;
  /** Ritmo minimo al que se puede degradar. Por debajo, mejor no analizar. */
  minFps?: number;
  /**
   * Cuantos huecos seguidos hay que pasarse antes de degradar.
   *
   * La primera inferencia de MediaPipe carga el modelo y siempre se pasa. Con
   * un umbral de 1 se degradaria siempre en el primer frame de cada sesion.
   */
  overrunsBeforeBackoff?: number;
  /** Huecos seguidos dentro de presupuesto antes de intentar recuperar. */
  goodRunsBeforeRecover?: number;
}

export interface BudgetState {
  /** Ritmo al que se esta analizando ahora mismo. */
  currentFps: number;
  /** True si se ha degradado por debajo del objetivo. */
  throttled: boolean;
  /** Frames analizados y descartados desde el arranque. */
  analysed: number;
  dropped: number;
}

export class FrameBudget {
  private readonly targetFps: number;
  private readonly minFps: number;
  private readonly overrunsBeforeBackoff: number;
  private readonly goodRunsBeforeRecover: number;

  private currentFps: number;
  private lastAnalysisAt = Number.NEGATIVE_INFINITY;
  private consecutiveOverruns = 0;
  private consecutiveGoodRuns = 0;
  private analysed = 0;
  private dropped = 0;

  constructor(options: FrameBudgetOptions) {
    this.targetFps = Math.max(1, options.targetFps);
    this.minFps = Math.max(1, options.minFps ?? 1);
    this.overrunsBeforeBackoff = options.overrunsBeforeBackoff ?? 5;
    this.goodRunsBeforeRecover = options.goodRunsBeforeRecover ?? 60;
    this.currentFps = this.targetFps;
  }

  /**
   * ¿Toca analizar este frame?
   *
   * Se llama con cada frame que llega. Devolver false es la ruta barata: el
   * frame se descarta sin decodificar ni copiar nada.
   */
  shouldAnalyse(now: number): boolean {
    const interval = 1000 / this.currentFps;
    if (now - this.lastAnalysisAt < interval) {
      this.dropped += 1;
      return false;
    }
    this.lastAnalysisAt = now;
    this.analysed += 1;
    return true;
  }

  /**
   * Cuanto tardo el analisis de verdad. Es lo que gobierna la degradacion.
   *
   * Se mide el trabajo, no la temperatura: ningun navegador expone la
   * temperatura del dispositivo. Pero cuando el sistema empieza a estrangular
   * por calor, el trabajo tarda mas — asi que el tiempo de analisis es la
   * unica señal termica que se puede leer desde aqui, y llega antes de que el
   * usuario note nada.
   */
  recordAnalysisTime(durationMs: number): void {
    const budgetMs = 1000 / this.currentFps;

    if (durationMs > budgetMs) {
      this.consecutiveOverruns += 1;
      this.consecutiveGoodRuns = 0;
      if (this.consecutiveOverruns >= this.overrunsBeforeBackoff) this.backOff();
      return;
    }

    this.consecutiveGoodRuns += 1;
    this.consecutiveOverruns = 0;
    if (this.consecutiveGoodRuns >= this.goodRunsBeforeRecover) this.recover();
  }

  state(): BudgetState {
    return {
      currentFps: this.currentFps,
      throttled: this.currentFps < this.targetFps,
      analysed: this.analysed,
      dropped: this.dropped,
    };
  }

  /** Al empezar una sesion nueva. No reinicia el ritmo aprendido a proposito. */
  resetCounters(): void {
    this.analysed = 0;
    this.dropped = 0;
    this.lastAnalysisAt = Number.NEGATIVE_INFINITY;
  }

  private backOff(): void {
    this.consecutiveOverruns = 0;
    const next = Math.max(this.minFps, Math.floor(this.currentFps / 2));
    this.currentFps = next;
  }

  private recover(): void {
    this.consecutiveGoodRuns = 0;
    // Se sube de uno en uno, no al doble: recuperar despacio es lo que evita
    // el vaiven de degradar y recuperar sin parar.
    this.currentFps = Math.min(this.targetFps, this.currentFps + 1);
  }
}
