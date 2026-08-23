// =============================================================================
// Almacen sobre PostgreSQL
//
// Implementa el mismo contrato `Store` que la version en memoria. Esa simetria
// es el punto: la bateria de reglas de seguridad —cuenta sin verificar no
// reporta, borrar borra, el limite de ritmo corta— se ejecuta contra LAS DOS
// implementaciones, asi que lo que se verifico en memoria esta verificado
// tambien aqui, contra una base de datos de verdad.
//
// Dos cosas que Prisma hace por nosotros y conviene tener localizadas:
//
//   1. El borrado en cascada vive en el esquema (`onDelete: Cascade`), no aqui.
//      deleteAccount es una sola linea y aun asi se lleva sesiones,
//      verificaciones y reportes. Es el derecho de supresion, y que sea una
//      linea es justamente lo que evita que dentro de dos años alguien añada
//      una tabla y se olvide de borrarla — la declara el esquema, no la
//      memoria de nadie.
//   2. `drivers` es una columna Json. Entra y sale como estructura; el resto de
//      los campos son columnas normales precisamente para poder consultarlos
//      (findReports filtra por errorKind y por lexiconVersion, que son indices).
// =============================================================================

import { PrismaClient } from '@prisma/client';

import type {
  ReportQuery, StoredReport, Store,
} from './types';

type Driver = { type: string; evidence: number };

export class PrismaStore implements Store {
  constructor(private readonly db: PrismaClient) {}

  // --- Cuentas ---

  /**
   * Crea la cuenta, o la reemplaza si existia SIN VERIFICAR.
   *
   * Es upsert y no create por el camino de reclamacion: una cuenta que nadie ha
   * confirmado no tiene dueño todavia, y quien controle el buzon puede
   * quedarsela. El manejador es el que decide si procede — aqui solo se hace
   * posible. Con `create` a secas, reclamar reventaba por clave duplicada.
   */
  async saveReport(report: StoredReport): Promise<void> {
    await this.db.report.create({ data: { ...report, drivers: report.drivers } });
  }

  async countReportsSince(
    key: { installId?: string; ip?: string },
    since: Date,
  ): Promise<number> {
    // OR y no AND: cada clave frena por su cuenta. Con AND, borrar el
    // almacenamiento local dejaria la cuenta a cero aunque la IP llevara mil.
    const claves: Array<Record<string, string>> = [];
    if (key.installId !== undefined) claves.push({ installId: key.installId });
    if (key.ip !== undefined) claves.push({ ip: key.ip });
    if (claves.length === 0) return 0;

    return this.db.report.count({
      where: { createdAt: { gte: since }, OR: claves },
    });
  }

  async deleteReportsByInstall(installId: string): Promise<number> {
    const { count } = await this.db.report.deleteMany({ where: { installId } });
    return count;
  }

  async findReports(query: ReportQuery): Promise<StoredReport[]> {
    const rows = await this.db.report.findMany({
      where: {
        ...(query.errorKind ? { errorKind: query.errorKind } : {}),
        ...(query.lexiconVersion ? { lexiconVersion: query.lexiconVersion } : {}),
        ...(query.unreviewedOnly ? { reviewedAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...(query.limit ? { take: query.limit } : {}),
    });

    return rows.map((row) => ({
      ...row,
      // La columna es Json; el contrato pide una lista tipada. Lo que no encaje
      // sale como lista vacia en vez de propagar un any hacia arriba.
      drivers: Array.isArray(row.drivers) ? (row.drivers as unknown as Driver[]) : [],
    }));
  }

  async markReviewed(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.report.updateMany({ where: { id: { in: ids } }, data: { reviewedAt: at } });
  }

  /** Solo para tests: vacia la tabla. Sin cuentas ya no hay cascadas. */
  async reset(): Promise<void> {
    await this.db.report.deleteMany({});
  }

  /**
   * Abre la conexion de verdad.
   *
   * Prisma conecta de forma perezosa —construir el cliente no toca la red— asi
   * que sin llamar a esto un servidor con la base caida arranca tan tranquilo y
   * revienta en la primera peticion. Se llama al arrancar para que el fallo
   * ocurra donde se puede ver.
   */
  async connect(): Promise<void> {
    await this.db.$connect();
  }

  async disconnect(): Promise<void> {
    await this.db.$disconnect();
  }
}

export function createPrismaStore(url?: string): PrismaStore {
  // Sin url explicita, Prisma lee DATABASE_URL del entorno, que es lo normal en
  // produccion. El parametro existe para los tests, que apuntan a otra base.
  return new PrismaStore(
    url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient(),
  );
}
