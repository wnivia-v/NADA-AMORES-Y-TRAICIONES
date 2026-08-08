import { describe, it, expect } from 'vitest';
import { scanLocalPatterns, normalizeForMatching } from '@/utils/scamPatterns';

/**
 * Speech-to-text output is never clean, and neither is text typed in a hurry.
 * A threat must not slip through because an accent was dropped or the casing
 * differed — that would be the worst possible reason to miss a fraud attempt.
 */
describe('resilience to messy transcription', () => {
  it('normalizes accents, casing and stray whitespace', () => {
    expect(normalizeForMatching('MÁNDAME   la Plata')).toBe('mandame la plata');
  });

  it('detects the same threat with and without accents', () => {
    const withAccents = scanLocalPatterns('Necesito que me envíes dinero urgente');
    const without = scanLocalPatterns('Necesito que me envies dinero urgente');

    expect(without.riskScore).toBe(withAccents.riskScore);
    expect(without.riskScore).toBeGreaterThan(0);
  });

  it('detects a threat shouted in caps the same as in lowercase', () => {
    const shouted = scanLocalPatterns('SI NO PAGAS VOY A PUBLICAR TUS FOTOS INTIMAS');
    expect(shouted.riskScore).toBeGreaterThan(0);
    expect(shouted.tactics).toContain('Amenaza condicional (paga o si no)');
  });

  it('survives the run-on spacing a recognizer produces', () => {
    const spaced = scanLocalPatterns('publicare   tus    fotos  intimas   si no pagas');
    expect(spaced.tactics).toContain('Sextorsion');
  });
});

describe('scanLocalPatterns', () => {
  describe('safe messages', () => {
    it('returns low risk for normal conversation', () => {
      const result = scanLocalPatterns('Hola, como estas? Nos vemos manana para el cafe.');
      expect(result.riskScore).toBeLessThan(40);
      expect(result.tactics).toHaveLength(0);
    });

    it('returns 0 for empty text', () => {
      const result = scanLocalPatterns('');
      expect(result.riskScore).toBe(0);
      expect(result.matches).toHaveLength(0);
    });

    it('returns low risk for regular work message', () => {
      const result = scanLocalPatterns('Te envio el reporte del proyecto. Revisalo cuando puedas.');
      expect(result.riskScore).toBeLessThan(40);
    });
  });

  describe('financial fraud detection', () => {
    it('detects urgent transfer requests', () => {
      const result = scanLocalPatterns('Transfiere ahora mismo a mi cuenta, es urgente!');
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.tactics.length).toBeGreaterThan(0);
    });

    it('detects money solicitation', () => {
      const result = scanLocalPatterns('Necesito que envies dinero por Western Union urgente');
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.tactics.length).toBeGreaterThan(0);
    });

    it('detects crypto scams', () => {
      const result = scanLocalPatterns('Invierte en bitcoin ahora, inversion segura garantizada al 100%');
      expect(result.riskScore).toBeGreaterThan(20);
    });

    it('detects bank data phishing', () => {
      const result = scanLocalPatterns('Necesito tu numero de cuenta y clave para verificar');
      expect(result.riskScore).toBeGreaterThanOrEqual(20);
    });
  });

  describe('romance scam detection', () => {
    it('detects romance + money pattern', () => {
      const result = scanLocalPatterns('Te amo mi amor, necesito que me envies dinero para el boleto');
      expect(result.riskScore).toBeGreaterThanOrEqual(30);
      expect(result.tactics).toContain('Romance + dinero');
    });

    it('detects fake emergency', () => {
      const result = scanLocalPatterns('Estoy en el hospital tuve un accidente necesito dinero urgente');
      expect(result.riskScore).toBeGreaterThanOrEqual(25);
      expect(result.tactics).toContain('Emergencia falsa');
    });

    it('detects military romance scam', () => {
      const result = scanLocalPatterns('Soy militar en plataforma petrolera y no puedo acceder a mi cuenta');
      expect(result.riskScore).toBeGreaterThanOrEqual(20);
    });
  });

  describe('coercion and threats', () => {
    it('detects sextortion', () => {
      const result = scanLocalPatterns('Publicare tus fotos intimas si no pagas');
      expect(result.riskScore).toBeGreaterThanOrEqual(30);
      expect(result.tactics).toContain('Sextorsion');
    });

    it('detects fake legal threats', () => {
      const result = scanLocalPatterns('Te vamos a poner una demanda y iras a la carcel si no pagas');
      expect(result.riskScore).toBeGreaterThanOrEqual(20);
      expect(result.tactics).toContain('Amenaza legal falsa');
    });
  });

  describe('coercion and threats — generalized (not tied to sextortion/legal wording)', () => {
    it('detects a generic pay-or-else conditional threat', () => {
      const result = scanLocalPatterns('Escuchame bien, si no colaboras vas a tener problemas graves');
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.tactics).toContain('Amenaza condicional (paga o si no)');
    });

    it('detects intimidation phrasing without a specific threat type', () => {
      const result = scanLocalPatterns('Ultima advertencia, te vas a arrepentir de esto');
      expect(result.tactics).toContain('Amenaza / coaccion');
    });

    it('detects threats to personal safety', () => {
      const result = scanLocalPatterns('Sabemos donde vives, algo te va a pasar si no haces lo que decimos');
      expect(result.riskScore).toBeGreaterThanOrEqual(30);
      expect(result.tactics).toContain('Amenaza a la seguridad personal');
    });

    it('flags offensive language as a low-weight contributing signal, not a verdict on its own', () => {
      const insultOnly = scanLocalPatterns('Eres un idiota, ya no quiero hablar contigo');
      expect(insultOnly.riskScore).toBeLessThan(40);
      expect(insultOnly.tactics).toContain('Lenguaje agresivo u ofensivo');

      // The same insult alongside a coercion pattern should push the combined
      // score into SOSPECHOSO territory instead of being diluted.
      const insultPlusThreat = scanLocalPatterns('Idiota, si no pagas vas a tener problemas');
      expect(insultPlusThreat.riskScore).toBeGreaterThanOrEqual(40);
    });

    it('flags a real bullying message with no financial signal as dangerous, not safe', () => {
      // A real screenshot that used to score 0/100: pure insults and rejection,
      // zero money/urgency/impersonation content — this app is supposed to
      // catch acoso/bullying, not just financial scams.
      const text = 'Cerda Te gusta el mal trato eso las matan Bye Pudrete Cerda Perra Mal educada';
      const result = scanLocalPatterns(text);
      expect(result.riskScore).toBeGreaterThanOrEqual(40);
      expect(result.tactics).toContain('Lenguaje agresivo u ofensivo');
      expect(result.tactics).toContain('Acoso / hostigamiento severo');
    });

    it('scales harassment weight with repetition, up to a cap', () => {
      const one = scanLocalPatterns('idiota');
      const many = scanLocalPatterns('idiota perra cerda zorra puta fea asquerosa');
      expect(many.riskScore).toBeGreaterThan(one.riskScore);
    });
  });

  describe('impersonation', () => {
    it('detects entity impersonation', () => {
      const result = scanLocalPatterns('El banco te contacta para verificar tu identidad inmediatamente');
      expect(result.riskScore).toBeGreaterThan(0);
    });

    it('detects fake tech support', () => {
      const result = scanLocalPatterns('Soporte tecnico de Microsoft detectamos un virus en tu equipo');
      expect(result.riskScore).toBeGreaterThanOrEqual(20);
      expect(result.tactics).toContain('Soporte tecnico falso');
    });

    it('detects fake prizes', () => {
      const result = scanLocalPatterns('Felicidades eres el ganador de la loteria! Reclama tu premio');
      expect(result.riskScore).toBeGreaterThanOrEqual(18);
      expect(result.tactics).toContain('Premio falso');
    });
  });

  describe('data harvesting', () => {
    it('detects credential requests', () => {
      const result = scanLocalPatterns('Dame tu contrasena para verificar tu cuenta');
      expect(result.riskScore).toBeGreaterThanOrEqual(15);
    });

    it('detects identity theft attempts', () => {
      const result = scanLocalPatterns('Enviame una selfie con tu identificacion para verificar');
      expect(result.riskScore).toBeGreaterThanOrEqual(25);
      expect(result.tactics).toContain('Robo de identidad');
    });
  });

  describe('combined patterns (high risk)', () => {
    it('detects multiple tactics for high risk score', () => {
      const text = 'Te amo mi amor, envía dinero urgente ahora mismo a mi cuenta bitcoin. Es la ultima oportunidad, no le digas a nadie.';
      const result = scanLocalPatterns(text);
      expect(result.riskScore).toBeGreaterThanOrEqual(60);
      expect(result.tactics.length).toBeGreaterThanOrEqual(3);
    });
  });
});
