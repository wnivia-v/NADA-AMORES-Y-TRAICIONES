// =============================================================================
// Limite de ritmo
//
// Dos usos distintos y las dos veces por el mismo motivo: que un bucle
// automatico no pueda hacer en un minuto lo que a una persona le costaria un
// mes.
//
//   - En el login, frena la prueba de contraseñas por fuerza bruta.
//   - En los reportes, frena el ENVENENAMIENTO DEL CORPUS. Es el riesgo
//     especifico de esta funcion: quien quiera que NADA deje de detectar su
//     estafa solo tiene que mandar mil reportes diciendo que esos mensajes eran
//     legitimos. Sin cuenta y sin limite, eso sale gratis.
//
// Ventana deslizante en memoria. Al reiniciar el proceso se olvida, y con
// varias instancias cada una cuenta la suya — las dos cosas son limitaciones
// reales que conviene tener escritas antes de que alguien las descubra. Para un
// despliegue serio esto va a Redis o al propio PostgreSQL.
// =============================================================================

interface Bucket {
  hits: number[];
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * ¿Cabe un intento mas? Lo cuenta si cabe.
   *
   * Devolver un booleano y contar a la vez es a proposito: separar "preguntar"
   * de "registrar" invita a que alguien pregunte y se olvide de registrar.
   */
  take(key: string, now: number = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { hits: [] };
    const cutoff = now - this.windowMs;

    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length >= this.limit) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return true;
  }

  /** Cuanto falta para que vuelva a caber uno, en segundos. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const oldest = this.buckets.get(key)?.hits[0];
    if (oldest === undefined) return 0;
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** Intentos de login por correo. Lento a proposito. */
export const loginLimiter = new RateLimiter(8, 15 * 60 * 1000);

/** Registros por origen, para que nadie cree cuentas en bucle. */
export const registerLimiter = new RateLimiter(5, 60 * 60 * 1000);

/**
 * Reportes por cuenta y hora.
 *
 * Generoso para una persona —nadie corrige treinta detecciones en una hora— y
 * estrecho para un script.
 */
export const REPORTS_PER_HOUR = 30;
