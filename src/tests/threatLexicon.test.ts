import { describe, it, expect, beforeEach } from 'vitest';
import { scanLocalPatterns, normalizeForMatching } from '@/utils/scamPatterns';
import { learnFromThreat, matchLearnedPhrases, clearThreatMemory, threatMemorySize } from '@/services/threatMemory';
import { LEXICON, COMBOS } from '@/utils/threatLexicon';

describe('lexicon integrity', () => {
  it('gives every entry a unique id', () => {
    const ids = LEXICON.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes every pattern to match normalized text', () => {
    // Patterns run against accent-stripped lowercase text. An uppercase letter
    // or a bare accented vowel outside a character class would simply never
    // match, silently disabling that entry.
    for (const entry of LEXICON) {
      expect(entry.regex.source, `${entry.id} must not require uppercase`).not.toMatch(/(?<!\\)[A-Z]/);
    }
  });

  it('keeps every combo rule pointing at categories that exist', () => {
    const known = new Set(LEXICON.map((e) => e.category));
    for (const combo of COMBOS) {
      for (const category of combo.requires) {
        expect(known.has(category), `${combo.id} requires unused category ${category}`).toBe(true);
      }
    }
  });
});

/**
 * Verbatim transcripts and screenshots from real reports, every one of which
 * scored 0/100 "SEGURO" before the lexicon existed.
 */
describe('real reported cases', () => {
  it('flags a virtual-kidnapping phone scam', () => {
    const transcript =
      '¿Y usted me va a entregar mi muchacho de mano o qué? Escúchame, que la llamada no se corte. ' +
      '¿Cómo voy a ir al Banco Azteca? Pero no más tengo 200 pesos. No cuelgue, quédese en la línea.';
    const result = scanLocalPatterns(transcript);

    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.categories).toContain('secuestro-virtual');
    expect(result.categories).toContain('canal-pago-irrastreable');
    expect(result.categories).toContain('retencion-llamada');
    // The combination is the real tell — each part alone is innocent.
    expect(result.combos.length).toBeGreaterThan(0);
  });

  it('flags police impersonation with a fabricated case and a home threat', () => {
    const text =
      'Si nos blokea en 30 estamos en su domicilio. Le habla el comisario ramires de la ' +
      'comiseria tercera de merlo se le hase saber qe se le abrio una causa de pedofilia';
    const result = scanLocalPatterns(text);

    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.categories).toContain('suplantacion-autoridad');
    expect(result.categories).toContain('acusacion-falsa');
  });

  it('flags a bullying thread with an implicit femicide reference', () => {
    const result = scanLocalPatterns('Cerda Te gusta el mal trato X eso las matan Bye Pudrete Perra Mal educada');
    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.categories).toContain('amenaza-violencia');
    expect(result.categories).toContain('acoso-severo');
  });
});

describe('inducement to self-harm', () => {
  it('alerts on its own, without needing any other signal', () => {
    // The most dangerous thing this tool can encounter. It must never depend
    // on corroboration to be taken seriously.
    for (const text of ['matate', 'ojala te mueras', 'kill yourself', 'deberias matarte']) {
      expect(scanLocalPatterns(text).riskScore, text).toBeGreaterThanOrEqual(70);
    }
  });
});

describe('multilingual coverage', () => {
  it('detects the same scam shape in English', () => {
    const result = scanLocalPatterns('We have your daughter. Do not hang up. Send the money by Western Union right now.');
    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.categories).toContain('secuestro-virtual');
  });

  it('detects a money request in Portuguese', () => {
    expect(scanLocalPatterns('envie o dinheiro urgente').riskScore).toBeGreaterThan(0);
  });
});

describe('restraint on ordinary conversation', () => {
  it('does not alert on everyday messages', () => {
    // A tool that cries wolf trains its user to ignore it, so single innocent
    // signals must stay below the alert threshold.
    const ordinary = [
      'Hola, como estas? Nos vemos manana para el cafe.',
      'Voy al banco un rato y despues paso por tu casa.',
      'El juzgado queda cerca de mi trabajo.',
      'Te mando el informe cuando llegue.',
      'Mi amor, te amo mucho, que tengas lindo dia.',
      'No cuelgues que ya te paso con mi mama.',
    ];
    for (const text of ordinary) {
      expect(scanLocalPatterns(text).riskScore, text).toBeLessThan(40);
    }
  });
});

describe('threat memory', () => {
  beforeEach(() => clearThreatMemory());

  it('learns only from confirmed threats, never from uncertain ones', () => {
    const text = normalizeForMatching('deposita el dinero en el oxxo antes de las cinco');

    learnFromThreat(text, 'SOSPECHOSO');
    expect(threatMemorySize()).toBe(0);

    learnFromThreat(text, 'PELIGROSO');
    expect(threatMemorySize()).toBeGreaterThan(0);
  });

  it('recognises a repeat of a script it has seen before', () => {
    learnFromThreat(normalizeForMatching('deposita el dinero en el oxxo antes de las cinco'), 'PELIGROSO');

    const again = matchLearnedPhrases(normalizeForMatching('Hola, deposita el dinero en el oxxo antes de las cinco por favor'));
    expect(again.weight).toBeGreaterThan(0);
  });

  it('does not fire on unrelated text', () => {
    learnFromThreat(normalizeForMatching('deposita el dinero en el oxxo antes de las cinco'), 'PELIGROSO');
    expect(matchLearnedPhrases(normalizeForMatching('nos vemos manana en el parque')).weight).toBe(0);
  });

  it('refuses to learn generic filler phrases', () => {
    // Learning "que no se me" would match half of all Spanish conversation.
    learnFromThreat(normalizeForMatching('y que no se me lo de la que'), 'PELIGROSO');
    expect(threatMemorySize()).toBe(0);
  });

  it('can never push a message to PELIGROSO on memory alone', () => {
    // Learned phrases corroborate; they must not decide. Otherwise one wrong
    // verdict teaches phrases that manufacture more wrong verdicts.
    const text = normalizeForMatching('vamos a comer pizza con los chicos el sabado por la tarde');
    learnFromThreat(text, 'PELIGROSO');

    const scored = scanLocalPatterns('vamos a comer pizza con los chicos el sabado por la tarde');
    expect(scored.riskScore).toBeLessThan(70);
  });
});
