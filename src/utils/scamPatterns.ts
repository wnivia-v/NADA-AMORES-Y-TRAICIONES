// =============================================================================
// Local threat detection — lexicon-driven, no network, no model, no API key
//
// This layer is deliberately dumb and deliberately always available. With no
// cloud provider configured it is the only component that forms an opinion,
// because the on-device classifier declines whenever it is unsure. Two real
// reports — a virtual-kidnapping call and a police-impersonation extortion —
// came back "0/100, no threats found" precisely because this layer had
// nothing to say and nothing else spoke up.
//
// The vocabulary and the combination rules live in threatLexicon.ts; this file
// is the scoring engine over them.
// =============================================================================

import { LEXICON, COMBOS, type ThreatCategory } from './threatLexicon';
import { matchLearnedPhrases } from '@/services/threatMemory';

interface PatternMatch {
  category: string;
  pattern: string;
  weight: number;
}

export interface LocalScanResult {
  riskScore: number;
  tactics: string[];
  matches: PatternMatch[];
  /** Threat categories hit, for combination scoring and for learning. */
  categories: ThreatCategory[];
  /** Combination rules that fired, in plain language. */
  combos: string[];
}

/**
 * Flattens the text so patterns match how something was SAID, not how it was
 * spelled.
 *
 * Speech-to-text output is never clean: engines drop accents inconsistently
 * ("mandame" vs "mándame"), vary capitalisation, and pad with extra spaces —
 * and a real user typing in a hurry does the same, while OCR invents its own
 * mistakes. Matching raw text meant a threat could go unflagged purely because
 * of a missing accent, which is the worst possible reason to miss one.
 *
 * Accent stripping is safe for these patterns: they spell accented vowels as
 * classes like [ií], and the bare vowel is in every class.
 */
export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFD')
    // Combining diacritics left behind by NFD (also turns ñ into n, which the
    // [nñ] classes already accept).
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Count of distinct, non-overlapping matches for a pattern in the text. */
function countMatches(regex: RegExp, text: string): number {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return (text.match(new RegExp(regex.source, flags)) ?? []).length;
}

export function scanLocalPatterns(text: string): LocalScanResult {
  const matches: PatternMatch[] = [];
  const categories = new Set<ThreatCategory>();
  const combos: string[] = [];
  let totalWeight = 0;

  const haystack = normalizeForMatching(text);

  for (const entry of LEXICON) {
    let hitWeight = 0;

    if (entry.repeatable) {
      const count = countMatches(entry.regex, haystack);
      if (count === 0) continue;
      // Abuse escalates: one insult in an otherwise normal message is not
      // harassment, five in a row unmistakably is. A flat weight cannot tell
      // those apart, so repeatable entries scale with how many distinct hits
      // land — capped, so a rant cannot dominate the whole score.
      hitWeight = entry.weight * Math.min(count, entry.repeatCap ?? count);
    } else {
      if (!entry.regex.test(haystack)) continue;
      hitWeight = entry.weight;
    }

    matches.push({ category: entry.label, pattern: entry.regex.source, weight: hitWeight });
    categories.add(entry.category);
    totalWeight += hitWeight;
  }

  // Combination bonuses. A scam is a shape — pressure, an untraceable payment,
  // isolation — and each part alone is ordinary conversation. Scoring the
  // shape is what catches scripts whose individual words look harmless.
  for (const combo of COMBOS) {
    if (combo.requires.every((c) => categories.has(c))) {
      totalWeight += combo.bonus;
      combos.push(combo.label);
    }
  }

  // Phrases learned from previously confirmed threats. Modest weight by
  // design — see threatMemory for why this cannot be trusted like the
  // hand-authored lexicon.
  const learned = matchLearnedPhrases(haystack);
  if (learned.weight > 0) {
    matches.push({ category: 'Coincide con una amenaza vista antes', pattern: 'learned', weight: learned.weight });
    totalWeight += learned.weight;
  }

  const riskScore = Math.min(100, Math.round(totalWeight * 1.2));
  const tactics = [...matches.map((m) => m.category), ...combos];

  return { riskScore, tactics, matches, categories: [...categories], combos };
}
