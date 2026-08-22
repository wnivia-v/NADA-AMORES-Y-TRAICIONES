// =============================================================================
// Servicio de feedback — donde se recoge que el sistema se equivoco
//
// Tiene dos mitades que conviene no confundir:
//
//   1. EL REGISTRO DE BORRADORES. Cuando termina un analisis se guarda todo lo
//      que se sabe de el: que se enseño y por que. Tiene que ser en ese momento
//      porque despues ya no se puede reconstruir — el rastro de la decision
//      vive dentro del motor de fusion y del escaner de patrones, y a la
//      interfaz solo le llega el veredicto. Es en memoria y acotado: un
//      borrador que nadie juzga no vale nada.
//
//   2. LA COLA DURABLE. Cuando el usuario si juzga, el borrador se convierte en
//      reporte y se guarda en IndexedDB. Aqui la durabilidad no es un lujo:
//      alguien que marca un falso positivo en el metro, sin cobertura, esta
//      dando justo el dato mas dificil de conseguir. Perderlo por no tener red
//      seria el peor fallo posible de esta funcion.
//
// El ENVIO todavia no existe, y es a proposito. Mandar reportes exige
// consentimiento registrado (§4.4, Modo B) y una cuenta que permita agrupar y
// limitar el ritmo; sin las dos cosas, el endpoint seria una puerta abierta al
// envenenamiento del corpus y un problema de proteccion de datos. Hasta
// entonces los reportes se acumulan en el dispositivo, que ademas ya sirve para
// algo: se pueden exportar y meter en el corpus del banco.
// =============================================================================

import {
  buildReport,
  type AnalysisDraft,
  type FeedbackReport,
  type FeedbackSubmission,
} from '@/shared/feedback/types';

const DB_NAME = 'nada-feedback';
const DB_VERSION = 1;
const STORE_NAME = 'reports';

/**
 * Cuantos borradores se guardan a la vez.
 *
 * Los analisis llegan solos —el escudo de portapapeles analiza cada copia— y
 * casi ninguno se juzga. Cincuenta cubre de sobra lo que alguien tiene a la
 * vista para opinar.
 */
const MAX_DRAFTS = 50;

export type QueueStatus = 'pending' | 'sent';

export interface QueuedReport extends FeedbackReport {
  status: QueueStatus;
  queuedAt: number;
}

export type SubmitOutcome =
  /** Guardado y a salvo. */
  | { ok: true; report: FeedbackReport }
  /** El borrador ya no estaba: analisis demasiado viejo. */
  | { ok: false; reason: 'draft-missing' }
  /** No se pudo escribir en el dispositivo. */
  | { ok: false; reason: 'storage-unavailable' };

class FeedbackService {
  private drafts = new Map<string, AnalysisDraft>();
  private db: IDBDatabase | null = null;
  private initPromise: Promise<boolean> | null = null;

  /**
   * Guarda todo lo que se sabe de un analisis y devuelve su id.
   *
   * El id acaba viajando dentro del ScamAnalysis para que la interfaz pueda
   * referirse a este analisis sin cargar con sus tripas.
   */
  registerDraft(draft: Omit<AnalysisDraft, 'id' | 'createdAt'>): string {
    const id = newId();
    this.drafts.set(id, { ...draft, id, createdAt: new Date().toISOString() });

    // Map conserva el orden de insercion, asi que el primero es el mas viejo.
    while (this.drafts.size > MAX_DRAFTS) {
      const oldest = this.drafts.keys().next().value;
      if (oldest === undefined) break;
      this.drafts.delete(oldest);
    }

    return id;
  }

  /** Si todavia se puede opinar sobre este analisis. */
  hasDraft(id: string): boolean {
    return this.drafts.has(id);
  }

  /**
   * El usuario ha juzgado un analisis.
   *
   * Devuelve un resultado explicito en vez de un booleano: la interfaz tiene
   * que poder distinguir "guardado" de "no se pudo guardar", porque decir
   * "gracias" cuando no se ha guardado nada es mentirle a quien acaba de
   * dedicarte su tiempo.
   */
  async submit(analysisId: string, submission: FeedbackSubmission): Promise<SubmitOutcome> {
    const draft = this.drafts.get(analysisId);
    if (!draft) return { ok: false, reason: 'draft-missing' };

    const report = buildReport(draft, submission);

    const stored = await this.persist({ ...report, status: 'pending', queuedAt: Date.now() });
    if (!stored) return { ok: false, reason: 'storage-unavailable' };

    // Juzgado una vez, fuera: asi el mismo analisis no se puede reportar dos
    // veces y falsear el peso de un caso en el corpus.
    this.drafts.delete(analysisId);
    return { ok: true, report };
  }

  /** Los reportes que todavia no se han entregado a ningun sitio. */
  async pending(): Promise<QueuedReport[]> {
    const all = await this.all();
    return all.filter((r) => r.status === 'pending');
  }

  /**
   * Todos los reportes guardados, para exportarlos.
   *
   * Mientras no exista el envio, esto es lo que hace util la funcion desde el
   * primer dia: las correcciones se pueden sacar del dispositivo y meterse a
   * mano en el corpus del banco.
   */
  async all(): Promise<QueuedReport[]> {
    const db = await this.open();
    if (!db) return [];

    return new Promise<QueuedReport[]>((resolve) => {
      try {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve((request.result as QueuedReport[]) ?? []);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  /** Vacia la cola. Para el borrado por peticion del usuario (ARCO/DSR). */
  async clear(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    try {
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
    } catch {
      /* no hay nada que hacer si el almacen no responde */
    }
  }

  /** Solo para tests: olvida los borradores en memoria. */
  resetDrafts(): void {
    this.drafts.clear();
  }

  private persist(record: QueuedReport): Promise<boolean> {
    return this.open().then((db) => {
      if (!db) return false;
      return new Promise<boolean>((resolve) => {
        try {
          const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record);
          request.onsuccess = () => resolve(true);
          request.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    });
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (this.initPromise) return this.initPromise.then(() => this.db);

    this.initPromise = new Promise<boolean>((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(false);
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('status', 'status', { unique: false });
            store.createIndex('queuedAt', 'queuedAt', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          resolve(true);
        };

        request.onerror = () => {
          console.warn('[NADA][Feedback] No se pudo abrir IndexedDB');
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });

    return this.initPromise.then(() => this.db);
  }
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const feedbackService = new FeedbackService();
