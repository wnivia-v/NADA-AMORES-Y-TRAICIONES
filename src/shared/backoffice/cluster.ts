// =============================================================================
// Agrupar reportes en algo sobre lo que se pueda actuar
//
// Mil reportes sueltos no son informacion, son ruido. Lo que convierte un monton
// de "esto estaba mal" en una tarea concreta es la pregunta: **¿que entrada del
// lexico esta detras de esto?**
//
// De ahi que se agrupe por (entrada, clase de error). Un grupo de quince falsos
// positivos que apuntan todos a `fin-send-money` no es "quince quejas": es una
// frase concreta que hay que amortiguar. Y quince falsos NEGATIVOS sin ninguna
// entrada detras no son un problema de una entrada, son vocabulario que falta.
//
// Se agrupa aqui, fuera del servidor y sin LLM: es aritmetica, y lo que hace el
// agente despues es lo dificil —escribir la regex— no lo facil.
// =============================================================================

/** Lo minimo de un reporte que hace falta para agrupar. */
export interface ReportLike {
  id: string;
  errorKind: string | null;
  lexiconIds: string[];
  lexiconVersion: string;
  content: string | null;
  note?: string | null;
  region: string;
  band: string;
  riskScore: number;
}

export interface Cluster {
  /** Entrada del lexico implicada, o null cuando no disparo ninguna. */
  lexiconId: string | null;
  errorKind: string;
  /** Cuantos reportes lo sostienen. Es la prioridad. */
  count: number;
  reportIds: string[];
  /** Ejemplos de texto, para que el agente y la persona vean de que se habla. */
  samples: { text: string; note?: string; region: string; score: number }[];
  /** Regiones donde aparece. Un problema de una sola region es otro problema. */
  regions: string[];
  /** Versiones del lexico en las que se ha visto. */
  lexiconVersions: string[];
}

export interface ClusterOptions {
  /** Solo reportes de esta version del lexico. Lo anterior puede estar arreglado. */
  lexiconVersion?: string;
  /** Cuantos reportes hacen falta para que un grupo merezca mirarse. */
  minCount?: number;
  maxSamples?: number;
}

/**
 * Agrupa reportes de error por (entrada, clase de error).
 *
 * Los aciertos no entran: confirmar que algo funciono no genera trabajo. Sirven
 * para otra cosa —saber si una version empeoro respecto a la anterior— y esa es
 * una metrica, no un grupo.
 *
 * Un reporte con varias entradas implicadas cuenta en TODOS sus grupos. No es
 * doble contabilidad: cuando cuatro entradas coinciden sobre un texto legitimo,
 * cualquiera de las cuatro puede ser la culpable, y es la persona quien decide
 * cual mirando los ejemplos.
 */
export function clusterReports(reports: ReportLike[], options: ClusterOptions = {}): Cluster[] {
  const minCount = options.minCount ?? 1;
  const maxSamples = options.maxSamples ?? 5;

  const relevant = reports.filter((r) => {
    if (!r.errorKind) return false;
    if (options.lexiconVersion && r.lexiconVersion !== options.lexiconVersion) return false;
    return true;
  });

  const groups = new Map<string, Cluster>();

  const push = (lexiconId: string | null, report: ReportLike) => {
    const key = `${lexiconId ?? '(ninguna)'}|${report.errorKind}`;
    const cluster = groups.get(key) ?? {
      lexiconId,
      errorKind: report.errorKind!,
      count: 0,
      reportIds: [],
      samples: [],
      regions: [],
      lexiconVersions: [],
    };

    cluster.count += 1;
    cluster.reportIds.push(report.id);
    if (!cluster.regions.includes(report.region)) cluster.regions.push(report.region);
    if (!cluster.lexiconVersions.includes(report.lexiconVersion)) {
      cluster.lexiconVersions.push(report.lexiconVersion);
    }
    if (report.content && cluster.samples.length < maxSamples) {
      cluster.samples.push({
        text: report.content,
        ...(report.note ? { note: report.note } : {}),
        region: report.region,
        score: report.riskScore,
      });
    }

    groups.set(key, cluster);
  };

  for (const report of relevant) {
    if (report.lexiconIds.length === 0) {
      // Sin ninguna entrada detras. En un falso NEGATIVO es la señal mas util
      // que existe: significa vocabulario que falta, no vocabulario que sobra.
      push(null, report);
      continue;
    }
    for (const lexiconId of report.lexiconIds) push(lexiconId, report);
  }

  return [...groups.values()]
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.count - a.count);
}

/** Resumen legible de un grupo, para el CLI y para el prompt del agente. */
export function describeCluster(cluster: Cluster): string {
  const que = cluster.lexiconId
    ? `la entrada ${cluster.lexiconId}`
    : 'ninguna entrada (vocabulario que falta)';
  const clase = cluster.errorKind === 'false-positive' ? 'falsos positivos' : 'falsos negativos';

  const lines = [
    `${cluster.count} ${clase} sobre ${que}  [regiones: ${cluster.regions.join(', ')}]`,
  ];
  for (const sample of cluster.samples) {
    lines.push(`    (${sample.score}/100) "${sample.text.slice(0, 100)}"`);
    if (sample.note) lines.push(`       nota: ${sample.note.slice(0, 80)}`);
  }
  return lines.join('\n');
}
