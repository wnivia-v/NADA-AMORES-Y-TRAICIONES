// =============================================================================
// Local Provider — runs entirely on the user's machine
//
// Why this exists, and why it is the default:
//
//   1. Cost. No API key, no account, no billing. NADA works the moment it is
//      installed, which matters because the people who need it are not going to
//      create a Firebase project first.
//   2. Privacy. A fraud victim's messages are evidence of a crime in progress.
//      Every cloud provider means shipping that text to a third party. This one
//      never sends it anywhere.
//   3. Availability. No network, no quota, no 429. It is the layer that still
//      works when everything else has failed.
//
// How it works: instead of asking a small local LLM to produce a JSON verdict
// (unreliable at this size), it embeds the text with a multilingual sentence
// model and compares it against the labeled corpus in src/data/scam-corpus.json
// using cosine similarity, then votes over the nearest labeled neighbours.
//
// That makes it a semantic generalisation of the regex layer: it catches
// rephrasings, missing accents and regional vocabulary that no fixed pattern
// covers, because "mandame plata ya" lands near "envia dinero urgente" in
// embedding space even though they share almost no characters.
//
// Honest limits: it can only recognise what the corpus describes. It does not
// reason about novel manipulation, and its ceiling rises only as the corpus
// grows. It is a strong floor, not a replacement for a frontier model.
// =============================================================================

import type { AIProvider } from './types';
import type { AnalysisRequest, ProviderAnswer } from '@/shared/llm/types';
import { answered, noAnswer } from '@/shared/llm/types';
import corpus from '@/data/scam-corpus.json';

/**
 * Este proveedor SI produce una etiqueta, y no contradice la regla de que un LLM
 * nunca decide: no es un LLM. Es un kNN sobre un corpus etiquetado a mano, o
 * sea la generalizacion semantica de la capa de patrones. Su etiqueta es un dato
 * medido contra el corpus, no la opinion de un modelo generativo.
 */
export type Verdict = 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';

/** Salida nativa del clasificador, antes de convertirse en señal. */
export interface LocalClassification {
  verdict: Verdict;
  riskScore: number;
  /** Cuota de voto que se llevo la clase ganadora (0-1). */
  confidence: number;
  tactics: string[];
  explanation: string;
  recommendations: string[];
}

interface CorpusCase {
  id: string;
  label: Verdict;
  category: string;
  text: string;
  note?: string;
}

const CASES = (corpus.cases as CorpusCase[]).filter((c) => c.text && c.label);

// Small, multilingual, quantized. ~120MB on first use, then cached by the
// browser/Electron so later runs are offline.
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

// ── Classifier parameters ────────────────────────────────────────────────────
//
// These are not guesses. They were chosen by sweeping the parameter space
// against the labeled corpus with leave-one-out evaluation (bench/local-sweep.mjs).
// Measured on 33 cases:
//
//   weighted mean, k=5, sim>=0.45   ->  exact 46%, false alarms 63%, 1 severe miss
//   softmax T=0.10, k=7, conf>=0.6  ->  exact 88%, false alarms  0%, 0 severe misses
//
// Re-run the sweep after changing the corpus; these values are fitted to it.

/** Nearest neighbours considered in the vote. */
const K = 7;

/**
 * Below this cosine similarity the nearest case is not really "about" the same
 * thing, so we decline rather than guess. Returning null lets the orchestrator
 * fall through to a cloud provider instead of emitting a confident wrong answer.
 */
const MIN_SIMILARITY = 0.45;

/**
 * Softmax temperature for neighbour weighting.
 *
 * The first implementation took a similarity-weighted mean of label scores. That
 * was the bug: with neighbour similarities all clustered around 0.5-0.67 the
 * weights were nearly equal, so every input drifted toward the mean of the
 * corpus. Because the corpus leans toward threats, almost everything landed in
 * the 41-55 band — just above the SOSPECHOSO threshold — producing a 63% false
 * alarm rate. Voting per class with sharpened weights fixes it.
 */
const TEMPERATURE = 0.1;

/**
 * Minimum share of the vote the winning class must hold.
 *
 * This is the honesty gate. On a split vote the provider declines instead of
 * picking a side, which is why its false-alarm rate is 0% on the corpus: it only
 * answers when the neighbourhood agrees. It answers roughly half the time, and
 * the regex layer plus any cloud provider cover the rest.
 */
const MIN_CONFIDENCE = 0.6;

type Embedder = (text: string) => Promise<Float32Array>;

let embedder: Embedder | null = null;
let embedderInit: Promise<Embedder | null> | null = null;
let corpusVectors: Float32Array[] | null = null;
let unavailableReason: string | null = null;

async function getEmbedder(): Promise<Embedder | null> {
  if (embedder) return embedder;
  if (embedderInit) return embedderInit;

  embedderInit = (async () => {
    try {
      // Lazy: keeps onnxruntime out of the initial bundle.
      const { pipeline } = await import('@huggingface/transformers');
      const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });

      embedder = async (text: string) => {
        // Mean pooling + L2 normalisation is what this model expects.
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return output.data as Float32Array;
      };
      return embedder;
    } catch (e) {
      unavailableReason = e instanceof Error ? e.message : String(e);
      console.warn('[NADA][local] Embedding model unavailable:', unavailableReason);
      embedderInit = null; // allow a retry later
      return null;
    }
  })();

  return embedderInit;
}

async function getCorpusVectors(embed: Embedder): Promise<Float32Array[]> {
  if (corpusVectors) return corpusVectors;
  const vectors: Float32Array[] = [];
  for (const c of CASES) {
    vectors.push(await embed(c.text));
  }
  corpusVectors = vectors;
  return vectors;
}

function cosine(a: Float32Array, b: Float32Array): number {
  // Vectors are already normalised, so the dot product is the cosine.
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/** Representative risk score per class, used for the UI gauge and blending. */
const SCORE_FOR: Record<Verdict, number> = {
  SEGURO: 10,
  SOSPECHOSO: 55,
  PELIGROSO: 88,
};

interface Neighbour {
  case: CorpusCase;
  similarity: number;
}

/** Exported for testing: turns nearest neighbours into a verdict. */
export function classifyFromNeighbours(neighbours: Neighbour[]): LocalClassification | null {
  if (neighbours.length === 0) return null;

  const considered = neighbours.slice(0, K);
  const best = considered[0]!;
  if (best.similarity < MIN_SIMILARITY) return null;

  // Per-class vote with softmax-sharpened weights, relative to the best match so
  // the exponent stays numerically stable.
  const weightByLabel = new Map<Verdict, number>();
  let totalWeight = 0;
  for (const n of considered) {
    const w = Math.exp((n.similarity - best.similarity) / TEMPERATURE);
    weightByLabel.set(n.case.label, (weightByLabel.get(n.case.label) ?? 0) + w);
    totalWeight += w;
  }

  let verdict: Verdict = 'SEGURO';
  let winningWeight = -1;
  for (const [label, w] of weightByLabel) {
    if (w > winningWeight) {
      winningWeight = w;
      verdict = label;
    }
  }

  const confidence = totalWeight > 0 ? winningWeight / totalWeight : 0;
  // Split neighbourhood: decline so a cloud provider or the regex layer decides.
  if (confidence < MIN_CONFIDENCE) return null;

  const riskScore = SCORE_FOR[verdict];

  // Tactics come only from neighbours that voted for the winning threat class,
  // so a SEGURO neighbour never contributes a scary label.
  const tactics =
    verdict === 'SEGURO'
      ? []
      : [...new Set(considered.filter((n) => n.case.label === verdict).map((n) => n.case.category))];

  const pct = Math.round(best.similarity * 100);
  const explanation =
    verdict === 'SEGURO'
      ? `Analisis local: el mensaje se parece a ejemplos que no son estafa (coincidencia ${pct}%).`
      : `Analisis local: se parece a un caso conocido de "${best.case.category}" (coincidencia ${pct}%).`;

  const recommendations =
    verdict === 'PELIGROSO'
      ? [
          'No envies dinero ni datos de tu tarjeta a esta persona.',
          'No sigas ningun enlace de este mensaje.',
          'Habla con alguien de confianza antes de responder.',
        ]
      : verdict === 'SOSPECHOSO'
        ? [
            'Verifica quien te escribe por otro medio que tu conozcas.',
            'No compartas datos personales todavia.',
          ]
        : ['El mensaje no coincide con estafas conocidas, pero mantente alerta.'];

  return { verdict, riskScore, confidence, tactics, explanation, recommendations };
}

export const localProvider: AIProvider = {
  id: 'local',
  name: 'Local (en tu dispositivo, sin costo)',
  cost: 'free-local',
  // No quota: nothing leaves the machine.

  requires: 'local-model',

  isAvailable(): boolean {
    // Availability is optimistic: the model is fetched on first use and cached.
    // We only report false once we know initialisation failed.
    return CASES.length > 0 && unavailableReason === null;
  },

  /**
   * Aqui no hay prompt que valga: este proveedor clasifica por similitud, no
   * siguiendo instrucciones. Que sea inmune a la inyeccion de prompt por
   * construccion es justamente lo que lo hace el suelo del sistema.
   */
  async analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<ProviderAnswer> {
    if (signal?.aborted) return noAnswer({ transport: 'network', detail: 'cancelado' });

    const embed = await getEmbedder();
    if (!embed) {
      return noAnswer({ transport: 'model-init', detail: unavailableReason ?? 'sin modelo de embeddings' });
    }
    if (signal?.aborted) return noAnswer({ transport: 'network', detail: 'cancelado' });

    try {
      const vectors = await getCorpusVectors(embed);
      if (signal?.aborted) return noAnswer({ transport: 'network', detail: 'cancelado' });

      const queryVector = await embed(request.text);
      if (signal?.aborted) return noAnswer({ transport: 'network', detail: 'cancelado' });

      const scored: Neighbour[] = CASES.map((c, i) => ({
        case: c,
        similarity: cosine(queryVector, vectors[i]!),
      }));

      scored.sort((a, b) => b.similarity - a.similarity);
      const classification = classifyFromNeighbours(scored);

      // Abstenerse NO es lo mismo que fallar, y la vista tecnica tiene que
      // poder distinguirlo: este proveedor calla cuando el vecino mas parecido
      // no se parece lo suficiente. Es la respuesta correcta, no una averia.
      if (!classification) {
        return noAnswer({ detail: 'sin vecino bastante parecido en el corpus' });
      }

      return answered({
        type: 'llm-risk',
        value: classification.riskScore,
        confidence: classification.confidence,
        timestamp: Date.now(),
        tactics: classification.tactics,
        explanation: classification.explanation,
        recommendations: classification.recommendations,
      });
    } catch (e) {
      if (signal?.aborted) return noAnswer({ transport: 'network', detail: 'cancelado' });
      return noAnswer({
        transport: 'model-init',
        detail: e instanceof Error ? e.name : 'error de clasificacion',
      });
    }
  },
};

/** Test helper: drops the cached model and corpus vectors. */
export function resetLocalProvider() {
  embedder = null;
  embedderInit = null;
  corpusVectors = null;
  unavailableReason = null;
}
