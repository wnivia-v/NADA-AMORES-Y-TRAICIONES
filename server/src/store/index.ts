// =============================================================================
// Que almacen esta en uso
//
// El servidor no importa una implementacion concreta: pide la activa. Eso
// permite dos cosas que importan:
//
//   1. Correr la MISMA bateria de reglas de seguridad contra las dos
//      implementaciones. Lo que se verifica en memoria queda verificado tambien
//      contra PostgreSQL, sin escribir los tests dos veces y sin que puedan
//      divergir sin que nadie se entere.
//   2. Arrancar sin base de datos. Util en desarrollo, y honesto: el servidor
//      dice por cual esta corriendo en vez de fingir que hay persistencia.
// =============================================================================

import type { Store } from './types';
import { store as memoryStore } from './memory';

let active: Store = memoryStore;
let activeKind: 'memoria' | 'postgres' = 'memoria';

export function activeStore(): Store {
  return active;
}

export function activeStoreKind(): 'memoria' | 'postgres' {
  return activeKind;
}

/**
 * Instala un almacen. Lo usan el arranque y los tests.
 *
 * Se llamaba `useStore`, y el linter tenia razon al quejarse: en un proyecto
 * con React, un nombre que empieza por `use` promete un hook. No lo es, y quien
 * lo lea de pasada puede creer que si.
 */
export function setStore(next: Store, kind: 'memoria' | 'postgres'): void {
  active = next;
  activeKind = kind;
}

/**
 * Elige almacen segun el entorno.
 *
 * Con DATABASE_URL, PostgreSQL. Sin ella, memoria — y se avisa, porque un
 * servidor que pierde todas las cuentas al reiniciar es algo que hay que saber
 * antes de descubrirlo.
 *
 * El import de Prisma es dinamico a proposito: asi el servidor arranca aunque
 * el cliente no este generado, que es el estado de cualquiera que acabe de
 * clonar el repositorio y no haya ejecutado todavia `prisma generate`.
 */
export async function initStore(): Promise<'memoria' | 'postgres'> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.warn('[NADA][store] sin DATABASE_URL: almacen EN MEMORIA, se pierde al reiniciar');
    return 'memoria';
  }

  try {
    const { createPrismaStore } = await import('./prisma');
    const store = createPrismaStore(url);

    // CONECTAR DE VERDAD antes de declararlo activo.
    //
    // El cliente de Prisma es perezoso: construirlo no abre ninguna conexion, y
    // sin esta llamada el servidor anunciaba "almacen: postgres" con la base
    // caida y luego fallaba en cada peticion. Un respaldo que no se activa
    // porque nadie comprobo nada es peor que no tener respaldo: da confianza
    // falsa justo donde hacia falta la de verdad.
    await store.connect();

    setStore(store, 'postgres');
    return 'postgres';
  } catch (error) {
    console.error('[NADA][store] no se pudo abrir PostgreSQL:', error instanceof Error ? error.message : error);
    console.error('[NADA][store] se sigue EN MEMORIA: las cuentas se pierden al reiniciar.');
    console.error('[NADA][store] ¿esta arrancado el cluster? `npm run db:up`. ¿Falta `npx prisma generate`?');
    return 'memoria';
  }
}
