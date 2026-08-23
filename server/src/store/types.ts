// =============================================================================
// El contrato de almacenamiento
//
// El servidor habla con esta interfaz y no con ninguna base de datos concreta.
// No es abstraccion por gusto: permite probar la logica de reportes —que es
// donde estan las decisiones de seguridad— sin levantar un PostgreSQL. Las
// reglas que importan (el limite de ritmo, que borrar borre de verdad, que un
// reporte de video no lleve contenido) corren contra las DOS implementaciones
// con la misma bateria de tests.
//
//   - memory.ts   — para los tests y para cuando la base no esta.
//   - prisma.ts   — PostgreSQL, la de produccion.
// =============================================================================

/** Un reporte ya validado, atado a la instalacion que lo envio. */
export interface StoredReport {
  id: string;
  /**
   * Instalacion de origen. Sustituye a la cuenta con correo.
   *
   * Identifica, no autentica: se borra vaciando el almacenamiento y quien
   * quiera falsear reportes en serio lo rotara. Contra el ruido y la
   * repeticion sirve; contra un atacante decidido, la que aguanta es la IP,
   * que la lee el servidor y el cliente no puede poner.
   */
  installId: string;
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

  // --- Contexto del aparato -------------------------------------------------
  //
  // Todo esto es null cuando la telemetria esta apagada en ajustes. Un reporte
  // sin contexto sigue siendo un reporte util: se pierde poder distinguir si
  // cien quejas iguales vienen de cien sitios o de uno, no la queja en si.

  /** 'web' | 'android' | 'electron'. */
  platform: string | null;
  os: string | null;
  deviceModel: string | null;
  /**
   * IP de la conexion, leida por el servidor.
   *
   * NUNCA la manda el cliente. Pedirsela seria pedirle a alguien que se
   * identifique solo, y quien quiera falsear reportes es justamente quien
   * pondria otra cosa. Es el unico campo de este bloque que no se puede fingir
   * desde el navegador, y por eso es el que sostiene el limite de ritmo.
   */
  ip: string | null;
}

export interface ReportQuery {
  errorKind?: string;
  lexiconVersion?: string;
  /** Solo los que el backoffice todavia no ha mirado. */
  unreviewedOnly?: boolean;
  limit?: number;
}

export interface Store {
  // --- Reportes ---
  saveReport(report: StoredReport): Promise<void>;
  /**
   * Cuantos reportes lleva esa instalacion —o esa IP— desde `since`.
   *
   * Las dos claves cuentan por separado y las dos frenan. Solo por instalacion
   * seria trivial de saltar: basta borrar el almacenamiento entre envios.
   */
  countReportsSince(key: { installId?: string; ip?: string }, since: Date): Promise<number>;
  /** Derecho de supresion sin cuenta: se borra por instalacion. */
  deleteReportsByInstall(installId: string): Promise<number>;
  findReports(query: ReportQuery): Promise<StoredReport[]>;
  markReviewed(ids: string[], at: Date): Promise<void>;
}
