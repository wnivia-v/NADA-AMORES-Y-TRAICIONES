// =============================================================================
// Validacion de la respuesta del modelo — cerrada por defecto
//
// La version anterior hacia esto:
//
//   verdict: parsed.verdict ?? 'SEGURO',
//   riskScore: Math.min(100, Math.max(0, parsed.riskScore ?? 0)),
//
// Es decir: un modelo manipulado que devolviera `{}` producia SEGURO con riesgo
// 0. El unico caso en el que un clasificador de seguridad no puede fallar era
// justo su valor por defecto. Y `tactics: "nada"` (un string en vez de un array)
// se esparcia caracter a caracter hasta la interfaz: ["n","a","d","a"].
//
// Aqui la regla es la contraria: si la respuesta no encaja, no hay respuesta.
// Devolver null hace que el pipeline caiga al camino local — patrones y
// clasificador en el dispositivo — que es un resultado honesto. Inventar un
// SEGURO no lo es.
// =============================================================================

import { hardenInput } from './normalize';
import type { ProviderSignal, SignalParseResult } from './types';

/** Tope de texto aceptado del modelo. Lo que llegue mas largo se recorta. */
const MAX_EXPLANATION = 600;
const MAX_TACTIC = 60;
const MAX_TACTICS = 12;
const MAX_RECOMMENDATIONS = 8;
const MAX_RECOMMENDATION = 300;
/** Una respuesta gigante no es una respuesta: es otra cosa. */
const MAX_RAW_BYTES = 20_000;

/**
 * Texto que viene del modelo y acaba en pantalla.
 *
 * Pasa por el mismo endurecimiento que la entrada: la explicacion la redacta un
 * modelo a partir del mensaje del atacante, asi que es texto influido por el
 * atacante y no merece mas confianza que el mensaje original.
 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return hardenInput(value).text.trim().slice(0, max);
}

function cleanStringArray(value: unknown, maxItems: number, maxLen: number): string[] {
  // Un string suelto NO se trata como iterable: ese fue el bug de ["n","a","d","a"].
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, maxLen);
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Extrae el objeto JSON de una respuesta que puede venir con markdown alrededor.
 *
 * Se toma el ULTIMO objeto de nivel superior, no el primero: el ataque de
 * falsificacion consiste en pegar un JSON propio dentro del mensaje analizado,
 * y si el modelo lo repite, aparece antes que su respuesta real. Cuando hay
 * duda, el analisis del modelo es lo ultimo que escribe.
 */
function extractJsonObject(raw: string): unknown | undefined {
  const trimmed = raw.trim();

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  let depth = 0;
  let start = -1;
  const candidates: string[] = [];

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(trimmed.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const parsed = tryParse(candidates[i] ?? '');
    if (parsed !== undefined && isPlainObject(parsed) && 'riskScore' in parsed) return parsed;
  }

  const last = candidates[candidates.length - 1];
  return last === undefined ? undefined : tryParse(last);
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convierte la respuesta cruda de un proveedor en una señal, o en nada.
 *
 * Nunca lanza y nunca rellena huecos con valores tranquilizadores. `riskScore`
 * es obligatorio y con tipo estricto: sin el no hay señal, punto.
 */
export function parseProviderSignal(raw: string | unknown): SignalParseResult {
  if (typeof raw === 'string' && raw.length > MAX_RAW_BYTES) {
    return { signal: null, rejection: 'oversized' };
  }

  const parsed = typeof raw === 'string' ? extractJsonObject(raw) : raw;
  if (parsed === undefined) return { signal: null, rejection: 'not-json' };
  if (!isPlainObject(parsed)) return { signal: null, rejection: 'not-object' };

  // riskScore: obligatorio, numerico de verdad, finito. Sin defecto.
  const rawScore = parsed['riskScore'];
  const score = typeof rawScore === 'number' ? rawScore : Number.NaN;
  if (!Number.isFinite(score)) return { signal: null, rejection: 'missing-risk-score' };
  // Fuera de rango es señal de que el modelo no entendio la escala; no se
  // recorta en silencio a 0 o 100, se descarta.
  if (score < 0 || score > 100) return { signal: null, rejection: 'risk-score-out-of-range' };

  // confidence: opcional. Su ausencia no es un fallo de seguridad — a diferencia
  // de riskScore, un valor medio conservador no vuelve inofensivo nada.
  const rawConfidence = parsed['confidence'];
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0.5;

  return {
    signal: {
      type: 'llm-risk',
      value: Math.round(score),
      confidence,
      timestamp: Date.now(),
      tactics: cleanStringArray(parsed['tactics'], MAX_TACTICS, MAX_TACTIC),
      explanation: cleanText(parsed['explanation'], MAX_EXPLANATION),
      recommendations: cleanStringArray(parsed['recommendations'], MAX_RECOMMENDATIONS, MAX_RECOMMENDATION),
    },
  };
}

/**
 * Banda de riesgo. La calcula el codigo, nunca el modelo (§4.1: "Fusion de
 * señales y decision — logica propia. Nunca la decide un LLM").
 *
 * Vive aqui para que cliente y servidor no puedan discrepar sobre los umbrales.
 * La ventana deslizante de la Fase 2 se apoyara en esto, no lo sustituira.
 */
export type RiskBand = 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';

export const RISK_THRESHOLDS = { suspicious: 40, dangerous: 70 } as const;

export function riskBand(score: number): RiskBand {
  if (score >= RISK_THRESHOLDS.dangerous) return 'PELIGROSO';
  if (score >= RISK_THRESHOLDS.suspicious) return 'SOSPECHOSO';
  return 'SEGURO';
}

export type { ProviderSignal, SignalParseResult };
