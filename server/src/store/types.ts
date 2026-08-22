// =============================================================================
// El contrato de almacenamiento
//
// El servidor habla con esta interfaz y no con ninguna base de datos concreta.
// No es abstraccion por gusto: es lo que permite probar la logica de cuentas y
// de reportes —que es donde estan las decisiones de seguridad— sin levantar un
// PostgreSQL. Las reglas que importan (una cuenta sin verificar no puede
// reportar, borrar borra de verdad, el limite de ritmo) se comprueban contra la
// implementacion en memoria, y son las mismas reglas que corren en produccion.
//
// Hay dos implementaciones previstas:
//   - memory.ts   — la que existe hoy, probada.
//   - prisma      — SIN ESCRIBIR. Necesita una base de datos viva para poder
//                   verificarla; escribirla a ciegas seria codigo sin probar
//                   con aspecto de trabajo terminado.
// =============================================================================

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  verifiedAt: Date | null;
  createdAt: Date;
  region: string;
}

export interface SessionRecord {
  tokenHash: string;
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface VerificationRecord {
  tokenHash: string;
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Un reporte ya validado y atado a su cuenta. */
export interface StoredReport {
  id: string;
  accountId: string;
  createdAt: Date;
  surface: string;
  judgment: string;
  errorKind: string | null;
  band: string;
  riskScore: number;
  alerted: boolean;
  corroborated: boolean;
  scanSource: string;
  lexiconIds: string[];
  combos: string[];
  dampened: string[];
  localScore: number;
  llmScore: number | null;
  injectionHits: string[];
  drivers: { type: string; evidence: number }[];
  note: string | null;
  /** SIEMPRE null cuando surface es 'video'. Lo impone el servidor. */
  content: string | null;
  region: string;
  language: string;
  appVersion: string;
  lexiconVersion: string;
  reviewedAt: Date | null;
}

export interface ReportQuery {
  errorKind?: string;
  lexiconVersion?: string;
  /** Solo los que el backoffice todavia no ha mirado. */
  unreviewedOnly?: boolean;
  limit?: number;
}

export interface Store {
  // --- Cuentas ---
  createAccount(account: AccountRecord): Promise<void>;
  accountByEmail(email: string): Promise<AccountRecord | null>;
  accountById(id: string): Promise<AccountRecord | null>;
  markVerified(accountId: string, at: Date): Promise<void>;
  /**
   * Borra la cuenta y TODO lo que cuelga de ella.
   *
   * Es el derecho de supresion. Que sea una sola llamada, y no siete, es lo que
   * hace que no se olvide ninguna tabla dentro de dos años.
   */
  deleteAccount(accountId: string): Promise<void>;

  // --- Sesiones ---
  createSession(session: SessionRecord): Promise<void>;
  sessionByHash(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  // --- Verificacion ---
  createVerification(verification: VerificationRecord): Promise<void>;
  consumeVerification(tokenHash: string): Promise<VerificationRecord | null>;

  // --- Reportes ---
  saveReport(report: StoredReport): Promise<void>;
  /** Cuantos reportes lleva esa cuenta desde `since`. Para el limite de ritmo. */
  countReportsSince(accountId: string, since: Date): Promise<number>;
  findReports(query: ReportQuery): Promise<StoredReport[]>;
  markReviewed(ids: string[], at: Date): Promise<void>;
}
