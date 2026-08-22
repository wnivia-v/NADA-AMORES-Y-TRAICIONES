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

/** Instala un almacen. Lo usan el arranque y los tests. */
export function useStore(next: Store, kind: 'memoria' | 'postgres'): void {
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
    useStore(createPrismaStore(url), 'postgres');
    return 'postgres';
  } catch (error) {
    console.error('[NADA][store] no se pudo abrir PostgreSQL:', error);
    console.error('[NADA][store] ¿falta `npx prisma generate`? Se sigue en memoria.');
    return 'memoria';
  }
}
