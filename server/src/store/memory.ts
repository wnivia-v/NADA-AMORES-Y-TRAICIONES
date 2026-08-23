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

import type { ReportQuery, StoredReport, Store } from './types';

export class MemoryStore implements Store {
  private reports = new Map<string, StoredReport>();

  async saveReport(report: StoredReport): Promise<void> {
    this.reports.set(report.id, report);
  }

  async countReportsSince(
    key: { installId?: string; ip?: string },
    since: Date,
  ): Promise<number> {
    let count = 0;
    for (const report of this.reports.values()) {
      if (report.createdAt < since) continue;
      const coincide =
        (key.installId !== undefined && report.installId === key.installId) ||
        (key.ip !== undefined && report.ip !== null && report.ip === key.ip);
      if (coincide) count += 1;
    }
    return count;
  }

  async deleteReportsByInstall(installId: string): Promise<number> {
    let borrados = 0;
    for (const [id, report] of this.reports) {
      if (report.installId === installId) {
        this.reports.delete(id);
        borrados += 1;
      }
    }
    return borrados;
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
    this.reports.clear();
  }
}

/** El almacen del proceso cuando no hay base de datos configurada. */
export const store = new MemoryStore();
