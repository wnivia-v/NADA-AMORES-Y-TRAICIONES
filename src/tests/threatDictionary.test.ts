import { describe, it, expect, beforeEach } from 'vitest';
import { scanDictionary, learnWordsFromThreat, clearLearnedDict, learnedDictSize, learnedDictStats } from '@/utils/threatDictionary';
import { scanLocalPatterns } from '@/utils/scamPatterns';

describe('Threat Dictionary', () => {
  beforeEach(async () => {
    await clearLearnedDict();
  });

  describe('Verbal Extortion & Threat Detection', () => {
    it('detects extortion with different verb conjugations', () => {
      const phrases = [
        'si no me pagas ahora te va a ir muy mal',
        'pagame la lana o vas a ver lo que te pasa',
        'si no depositas en oxxo atente a las consecuencias',
        'transfiere ya o te cobramos a la fuerza',
      ];

      for (const phrase of phrases) {
        const result = scanDictionary(phrase);
        expect(result.score).toBeGreaterThan(0);
        expect(result.categories).toContain('extorsion');
      }
    });

    it('detects spoken physical threat & location claim', () => {
      const phrase = 'sabemos donde vives te estamos vigilando te vamos a hacer dano';
      const result = scanDictionary(phrase);
      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(result.categories).toContain('amenaza-violencia');
    });
  });

  describe('Verbal Bullying & Harassment', () => {
    it('detects verbal abuse and insults', () => {
      const phrase = 'eres un idiota imbecil basura no sirves para nada pudrete';
      const result = scanDictionary(phrase);
      expect(result.score).toBeGreaterThanOrEqual(15);
      expect(result.categories).toContain('bullying');
    });

    it('detects severe harassment with public humiliation threat', () => {
      const phrase = 'te voy a arruinar la vida le voy a contar a todos todo el mundo se va a enterar';
      const result = scanDictionary(phrase);
      expect(result.score).toBeGreaterThan(0);
      expect(result.categories).toContain('bullying');
    });
  });

  describe('Verbal Sextortion & Blackmail', () => {
    it('detects spoken photo/video exposure blackmail', () => {
      const phrase = 'tengo tus fotos intimas y si no pagas se las mando a tu trabajo y a tu familia';
      const result = scanDictionary(phrase);
      expect(result.score).toBeGreaterThanOrEqual(25);
      expect(result.categories).toContain('sextorsion');
      expect(result.categories).toContain('extorsion');
    });
  });

  describe('Verbal Phishing & Data Harvesting', () => {
    it('detects spoken credential and PIN requests', () => {
      const phrase = 'pasame tu numero de tarjeta y la contrasena con el codigo de verificacion que te llego';
      const result = scanDictionary(phrase);
      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(result.categories).toContain('phishing-datos');
    });
  });

  describe('Virtual Kidnapping & Impersonation', () => {
    it('detects spoken kidnapping claims', () => {
      const phrase = 'tengo a tu hijo no cuelgues si quieres que lo soltamos necesitas depositar dinero';
      const result = scanDictionary(phrase);
      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.categories).toContain('secuestro-virtual');
    });

    it('detects police impersonation extortion', () => {
      const phrase = 'le habla el comisario ramirez se le abrio una causa tiene una orden de detencion';
      const result = scanDictionary(phrase);
      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(result.categories).toContain('suplantacion');
    });
  });

  describe('Safe Conversations', () => {
    it('gives zero or low score to everyday messages', () => {
      const safe = [
        'Hola como estas nos vemos manana para tomar un cafe',
        'Ya termine el informe de la oficina te lo envio por correo',
        'Voy a pasar por la tienda para comprar fruta y pan',
      ];

      for (const msg of safe) {
        const result = scanDictionary(msg);
        expect(result.score).toBeLessThan(15);
      }
    });
  });

  describe('Auto-Learning System', () => {
    it('learns new threat vocabulary and bigrams from confirmed threats', async () => {
      const threatText = 'escuchame atencion me vas a dar la criptomoneda desconocida o te busco';
      
      // Learn from confirmed threat
      await learnWordsFromThreat(threatText, ['extorsion']);

      const stats = learnedDictStats();
      expect(stats.total).toBeGreaterThan(0);

      // Rescan text that contains learned words/bigrams
      const testScan = scanDictionary('criptomoneda desconocida');
      expect(testScan.matchedWords.some(w => w.includes('criptomoneda') || w.includes('desconocida'))).toBe(true);
    });

    it('clears learned memory properly', async () => {
      await learnWordsFromThreat('palabraextranathreat palabraextraordinaria', ['extorsion']);
      expect(learnedDictSize()).toBeGreaterThan(0);

      await clearLearnedDict();
      expect(learnedDictSize()).toBe(0);
    });
  });

  describe('Integration with scanLocalPatterns', () => {
    it('combines dictionary score with pattern scanning', () => {
      const text = 'dame tu clave del banco o te va a ir muy mal';
      const result = scanLocalPatterns(text);

      expect(result.riskScore).toBeGreaterThan(30);
      expect(result.tactics.some(t => t.includes('diccionario') || t.includes('Phishing') || t.includes('Extorsion'))).toBe(true);
    });
  });
});
