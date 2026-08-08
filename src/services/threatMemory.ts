// =============================================================================
// Threat memory — phrases learned from confirmed threats
//
// The hand-authored lexicon can only recognise wording someone thought to
// write down. This closes part of that gap: when a message is confirmed
// dangerous, the distinctive phrases in it are remembered, so the next message
// built from the same script is recognised instantly and offline — even if the
// cloud AI that made the original call is unreachable that time.
//
// ── Why this is deliberately conservative ────────────────────────────────────
//
// Learning from your own output is how a detector poisons itself. One wrong
// PELIGROSO teaches a phrase that then helps produce more wrong PELIGROSOs,
// and nobody notices until the tool cries wolf constantly and its users stop
// believing it. So:
//
//   - Only PELIGROSO verdicts teach. SOSPECHOSO is exactly the uncertain band
//     where a mistake is most likely, so it teaches nothing.
//   - Only multi-word phrases, and only ones that are not everyday Spanish.
//     A single word or a common connector would match half of all messages.
//   - Learned phrases carry a MODEST weight, capped, and can never on their
//     own push a message to PELIGROSO. They corroborate; they do not decide.
//   - The store is bounded and evicts the oldest, so a bad stretch ages out
//     instead of accumulating forever.
//
// Everything here is local to the device. Nothing is uploaded or shared.
// =============================================================================

const STORAGE_KEY = 'nada-threat-memory';
const MAX_PHRASES = 400;

/** Phrase length in words. Shorter is too generic; longer never repeats. */
const MIN_PHRASE_WORDS = 3;
const MAX_PHRASE_WORDS = 5;

/** Per-phrase contribution when matched. */
const PHRASE_WEIGHT = 8;

/**
 * Ceiling on the learned contribution.
 *
 * Below the SOSPECHOSO threshold on purpose: memory can raise suspicion and
 * corroborate the lexicon, but a verdict must never rest on it alone.
 */
const MAX_LEARNED_WEIGHT = 24;

/**
 * Words too common to carry meaning. A phrase built only from these matches
 * ordinary conversation, which is exactly how a learned store starts firing
 * on everything.
 */
const STOPWORDS = new Set([
  'que', 'de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'un', 'una', 'por', 'con', 'no', 'se',
  'su', 'lo', 'le', 'me', 'te', 'mi', 'tu', 'es', 'son', 'para', 'del', 'al', 'como', 'mas',
  'pero', 'si', 'ya', 'yo', 'esta', 'este', 'esto', 'muy', 'the', 'and', 'you', 'to', 'of', 'in',
  'is', 'it', 'for', 'on', 'that', 'this', 'with', 'be', 'are', 'was',
]);

interface StoredPhrase {
  phrase: string;
  /** ms epoch, for eviction. */
  seen: number;
}

let cache: StoredPhrase[] | null = null;

function load(): StoredPhrase[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (p): p is StoredPhrase =>
            !!p && typeof (p as StoredPhrase).phrase === 'string' && typeof (p as StoredPhrase).seen === 'number',
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(phrases: StoredPhrase[]): void {
  cache = phrases;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
  } catch {
    // Storage full or unavailable — memory still works for this session.
  }
}

/** True when a phrase carries enough non-generic content to be worth keeping. */
function isDistinctive(words: string[]): boolean {
  const meaningful = words.filter((w) => w.length > 2 && !STOPWORDS.has(w));
  // At least half the phrase must be meaningful, and it needs two content
  // words — one content word plus filler is not a script, it is a coincidence.
  return meaningful.length >= 2 && meaningful.length * 2 >= words.length;
}

function extractPhrases(normalizedText: string): string[] {
  const words = normalizedText.split(' ').filter(Boolean);
  const phrases = new Set<string>();

  for (let size = MIN_PHRASE_WORDS; size <= MAX_PHRASE_WORDS; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const slice = words.slice(i, i + size);
      if (isDistinctive(slice)) phrases.add(slice.join(' '));
    }
  }

  return [...phrases];
}

/**
 * Records the distinctive phrasing of a confirmed threat.
 *
 * `normalizedText` must already have gone through normalizeForMatching, so
 * what is stored matches what future scans compare against.
 */
export function learnFromThreat(normalizedText: string, verdict: string): void {
  // Only certainty teaches. SOSPECHOSO is the band where the system is least
  // sure, so learning there would compound its own mistakes.
  if (verdict !== 'PELIGROSO') return;

  const phrases = extractPhrases(normalizedText);
  if (phrases.length === 0) return;

  const existing = load();
  const known = new Set(existing.map((p) => p.phrase));
  const now = Date.now();

  const additions = phrases.filter((p) => !known.has(p)).map((phrase) => ({ phrase, seen: now }));
  if (additions.length === 0) return;

  // Oldest first, so slicing from the end keeps the most recent.
  const merged = [...existing, ...additions].slice(-MAX_PHRASES);
  persist(merged);
}

export interface LearnedMatch {
  weight: number;
  phrases: string[];
}

/** Scores `normalizedText` against remembered threat phrasing. */
export function matchLearnedPhrases(normalizedText: string): LearnedMatch {
  const stored = load();
  if (stored.length === 0) return { weight: 0, phrases: [] };

  const hits = stored.filter((p) => normalizedText.includes(p.phrase)).map((p) => p.phrase);
  if (hits.length === 0) return { weight: 0, phrases: [] };

  return {
    weight: Math.min(hits.length * PHRASE_WEIGHT, MAX_LEARNED_WEIGHT),
    phrases: hits,
  };
}

/** Diagnostics for the debug panel. */
export function threatMemorySize(): number {
  return load().length;
}

/** Lets the user wipe what the tool has learned on their device. */
export function clearThreatMemory(): void {
  persist([]);
}
