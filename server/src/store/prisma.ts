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
  AccountRecord, ReportQuery, SessionRecord, StoredReport, Store, VerificationRecord,
} from './types';

type Driver = { type: string; evidence: number };

export class PrismaStore implements Store {
  constructor(private readonly db: PrismaClient) {}

  // --- Cuentas ---

  async createAccount(account: AccountRecord): Promise<void> {
    await this.db.account.create({ data: account });
  }

  async accountByEmail(email: string): Promise<AccountRecord | null> {
    return this.db.account.findUnique({ where: { email } });
  }

  async accountById(id: string): Promise<AccountRecord | null> {
    return this.db.account.findUnique({ where: { id } });
  }

  async markVerified(accountId: string, at: Date): Promise<void> {
    // updateMany y no update: si la cuenta ya no existe, no es un error que
    // deba tumbar la peticion. update lanzaria.
    await this.db.account.updateMany({ where: { id: accountId }, data: { verifiedAt: at } });
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.db.account.deleteMany({ where: { id: accountId } });
  }

  // --- Sesiones ---

  async createSession(session: SessionRecord): Promise<void> {
    // upsert y no create: renovar una sesion existente no debe fallar por
    // clave duplicada. La clave es el hash del token, asi que colisionar
    // significa el mismo token, no dos sesiones distintas.
    await this.db.session.upsert({
      where: { tokenHash: session.tokenHash },
      create: session,
      update: { expiresAt: session.expiresAt },
    });
  }

  async sessionByHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.db.session.findUnique({ where: { tokenHash } });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.session.deleteMany({ where: { tokenHash } });
  }

  // --- Verificacion ---

  async createVerification(verification: VerificationRecord): Promise<void> {
    await this.db.verification.create({ data: verification });
  }

  /**
   * De un solo uso, y de forma atomica.
   *
   * El borrado y la lectura van en una transaccion: si dos peticiones canjean
   * el mismo token a la vez, solo una puede encontrarlo. Sin la transaccion,
   * las dos leerian y las dos verificarian — que es exactamente lo que "de un
   * solo uso" tiene que impedir.
   */
  async consumeVerification(tokenHash: string): Promise<VerificationRecord | null> {
    return this.db.$transaction(async (tx) => {
      const record = await tx.verification.findUnique({ where: { tokenHash } });
      if (!record) return null;
      await tx.verification.delete({ where: { tokenHash } });
      return record;
    });
  }

  // --- Reportes ---

  async saveReport(report: StoredReport): Promise<void> {
    await this.db.report.create({ data: { ...report, drivers: report.drivers } });
  }

  async countReportsSince(accountId: string, since: Date): Promise<number> {
    return this.db.report.count({ where: { accountId, createdAt: { gte: since } } });
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

  /** Solo para tests: vacia las tablas. Las cascadas hacen el resto. */
  async reset(): Promise<void> {
    await this.db.account.deleteMany({});
    await this.db.report.deleteMany({});
    await this.db.session.deleteMany({});
    await this.db.verification.deleteMany({});
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
