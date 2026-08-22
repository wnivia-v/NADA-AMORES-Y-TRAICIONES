// =============================================================================
// Parametros del motor de fusion
//
// Todo lo ajustable vive aqui, en un solo sitio, porque la regla del proyecto
// es que ningun peso cambia sin un antes/despues medido — y para medir hace
// falta poder barrer los parametros sin tocar la logica.
//
// Los valores de partida se eligieron con bench/fusion.ts sobre el fixture de
// secuencias. Si cambias uno, vuelve a correr el banco y pega el resultado.
// =============================================================================

import type { SignalType } from './types';

/**
 * Longitud de la ventana deslizante.
 *
 * El brief pide 15-30 s. Se toma el extremo alto: el escudo de voz analiza un
 * fragmento cada 15 s, asi que una ventana de 20 s a menudo contendria un solo
 * fragmento y la corroboracion seria imposible por construccion. Con 30 s caben
 * dos, que es el minimo para que "dos señales independientes" signifique algo
 * en una llamada en curso.
 */
export const DEFAULT_WINDOW_MS = 30_000;

/**
 * Peso por tipo de señal: cuanto te fias de esta fuente cuando acierta.
 *
 * No es "cuanta importancia tiene la amenaza" — eso ya va en `value`. Es cuanto
 * credito merece la fuente. Una coincidencia exacta de hash contra una estafa ya
 * confirmada (scam-db) es practicamente un hecho; la opinion de un LLM sobre un
 * texto ambiguo, no tanto.
 */
export const DEFAULT_SOURCE_WEIGHTS: Record<SignalType, number> = {
  'scam-db': 1.0,
  'explicit-threat': 1.0,
  'unsafe-urls': 0.95,
  'local-patterns': 0.9,
  'llm-risk': 0.85,
  deepfake: 0.8,
  // Algo por debajo de la biometria. La deteccion de bucle es determinista
  // —o los frames repiten o no repiten— pero tiene un falso positivo real y
  // conocido: un plano muy estatico, con la persona quieta y el fondo fijo,
  // produce firmas casi identicas sin que nadie este engañando a nadie.
  'video-loop': 0.75,
  // Deliberadamente bajo. Un intento de manipular al analizador es indicio de
  // intencion, no prueba de estafa: empuja la puntuacion sin llegar a sostenerla.
  'injection-attempt': 0.5,
};

/** Umbrales de banda. Compartidos con el limite del LLM para no discrepar. */
export const DEFAULT_THRESHOLDS = { suspicious: 40, dangerous: 70 } as const;

/**
 * Evidencia minima para que una señal cuente como corroboracion.
 *
 * Sin este suelo, dos señales irrelevantes (un 5 y un 8) contarian como
 * "corroborado" y la regla se volveria un tramite.
 *
 * Medido: bench/fusion-sweep.ts da meseta entre 0.05 y 0.15, y a partir de 0.20
 * empieza a dejar amenazas sin avisar. Se toma 0.10 y no 0.15 para no dejar el
 * valor por defecto pegado al borde de la meseta, donde el primer caso nuevo
 * del fixture lo tumbaria.
 */
export const DEFAULT_MIN_EVIDENCE = 0.1;

/**
 * Decaimiento dentro de la ventana.
 *
 * La ventana ya es el corte duro: fuera de ella la señal no existe. Dentro solo
 * se atenua suavemente, de 1.0 a este valor en el borde, para que lo reciente
 * pese mas sin que lo de hace 25 s se evapore justo cuando serviria para
 * corroborar.
 */
export const DEFAULT_EDGE_DECAY = 0.5;

export interface FusionConfig {
  windowMs: number;
  sourceWeights: Record<SignalType, number>;
  thresholds: { suspicious: number; dangerous: number };
  minEvidence: number;
  edgeDecay: number;
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  windowMs: DEFAULT_WINDOW_MS,
  sourceWeights: DEFAULT_SOURCE_WEIGHTS,
  thresholds: DEFAULT_THRESHOLDS,
  minEvidence: DEFAULT_MIN_EVIDENCE,
  edgeDecay: DEFAULT_EDGE_DECAY,
};

/**
 * Lista CERRADA de categorias que pueden alertar por si solas.
 *
 * El principio del proyecto dice que ninguna alerta salta por una señal aislada,
 * y es un buen principio: es la causa principal de falsos positivos. Pero
 * aplicarlo sin excepciones desharia una correccion que se hizo tras dos fallos
 * reales — mensajes que nombraban un delito y la direccion de la victima se
 * quedaban en "0/100, no se detectaron patrones" porque la media los hundia.
 *
 * De ahi esta lista. Es corta y cerrada a proposito: son categorias donde una
 * sola aparicion ya es inequivoca y grave, y donde esperar a una segunda señal
 * significa esperar a que pase algo. Ampliarla es reabrir el Problema A, asi que
 * cada entrada nueva necesita su medicion en bench/fusion.ts.
 *
 * Fuera quedan a proposito las categorias de fraude comun (phishing, peticion de
 * dinero, empleo falso): son graves, pero aparecen tambien cuando alguien
 * reenvia una estafa para preguntar si lo es, y ahi la corroboracion es
 * exactamente lo que hace falta.
 */
export const EXPLICIT_THREAT_CATEGORIES = [
  'amenaza-violencia',
  'sextorsion',
  'extorsion',
  'secuestro-virtual',
  'induccion-autolesion',
  'acusacion-falsa',
  'acoso-severo',
] as const;

export type ExplicitThreatCategory = (typeof EXPLICIT_THREAT_CATEGORIES)[number];

const EXPLICIT_SET: ReadonlySet<string> = new Set(EXPLICIT_THREAT_CATEGORIES);

export function isExplicitThreatCategory(category: string): boolean {
  return EXPLICIT_SET.has(category);
}
