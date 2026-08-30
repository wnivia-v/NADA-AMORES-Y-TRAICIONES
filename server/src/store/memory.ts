// =============================================================================
// Almacen en memoria
//
// Es lo que corre hoy, y es lo que se prueba. No pretende ser produccion —al
// reiniciar el proceso desaparece todo— pero implementa el mismo contrato, asi
// que las reglas verificadas aqui son las mismas que regiran cuando haya
// PostgreSQL detras.
//
// El borrado en cascada esta hecho a mano y a proposito de forma explicita: en
// Prisma lo hace `onDelete: Cascade`, y aqui se ve linea por linea que no queda
// nada. Si mañana alguien añade una tabla nueva y se olvida de borrarla, el test
// de supresion lo dira.
// =============================================================================

import type {
  AccountRecord, ReportQuery, SessionRecord, StoredReport, Store, VerificationRecord,
} from './types';

export class MemoryStore implements Store {
  private accounts = new Map<string, AccountRecord>();
  private emailIndex = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private verifications = new Map<string, VerificationRecord>();
  private reports = new Map<string, StoredReport>();

  /** Crea, o reemplaza si existia sin verificar. Ver la version de Prisma. */
  async createAccount(account: AccountRecord): Promise<void> {
    this.accounts.set(account.id, account);
    this.emailIndex.set(account.email, account.id);
  }

  async accountByEmail(email: string): Promise<AccountRecord | null> {
    const id = this.emailIndex.get(email);
    return id ? this.accounts.get(id) ?? null : null;
  }

  async accountById(id: string): Promise<AccountRecord | null> {
    return this.accounts.get(id) ?? null;
  }

  async markVerified(accountId: string, at: Date): Promise<void> {
    const account = this.accounts.get(accountId);
    if (account) this.accounts.set(accountId, { ...account, verifiedAt: at });
  }

  async deleteAccount(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;

    this.accounts.delete(accountId);
    this.emailIndex.delete(account.email);
    for (const [key, s] of this.sessions) if (s.accountId === accountId) this.sessions.delete(key);
    for (const [key, v] of this.verifications) if (v.accountId === accountId) this.verifications.delete(key);
    for (const [key, r] of this.reports) if (r.accountId === accountId) this.reports.delete(key);
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, session);
  }

  async sessionByHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async createVerification(verification: VerificationRecord): Promise<void> {
    this.verifications.set(verification.tokenHash, verification);
  }

  /** De un solo uso: se borra al canjearlo, haya caducado o no. */
  async consumeVerification(tokenHash: string): Promise<VerificationRecord | null> {
    const record = this.verifications.get(tokenHash);
    if (!record) return null;
    this.verifications.delete(tokenHash);
    return record;
  }

  async saveReport(report: StoredReport): Promise<void> {
    this.reports.set(report.id, report);
  }

  async countReportsSince(accountId: string, since: Date): Promise<number> {
    let count = 0;
    for (const report of this.reports.values()) {
      if (report.accountId === accountId && report.createdAt >= since) count += 1;
    }
    return count;
  }

  async findReports(query: ReportQuery): Promise<StoredReport[]> {
    const matches = [...this.reports.values()].filter((r) => {
      if (query.errorKind && r.errorKind !== query.errorKind) return false;
      if (query.lexiconVersion && r.lexiconVersion !== query.lexiconVersion) return false;
      if (query.unreviewedOnly && r.reviewedAt !== null) return false;
      return true;
    });

    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return query.limit ? matches.slice(0, query.limit) : matches;
  }

  async markReviewed(ids: string[], at: Date): Promise<void> {
    for (const id of ids) {
      const report = this.reports.get(id);
      if (report) this.reports.set(id, { ...report, reviewedAt: at });
    }
  }

  /** Solo para tests. */
  reset(): void {
    this.accounts.clear();
    this.emailIndex.clear();
    this.sessions.clear();
    this.verifications.clear();
    this.reports.clear();
  }
}

/** El almacen del proceso. Se sustituira por el de Prisma cuando exista. */
export const store = new MemoryStore();
