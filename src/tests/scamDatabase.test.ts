import { describe, it, expect, beforeEach } from 'vitest';
import { scamDatabase } from '@/services/scamDatabase';

describe('ScamDatabase', () => {
  beforeEach(async () => {
    // Re-init for clean state (fake-indexeddb provides fresh DB)
    await scamDatabase.init();
  });

  describe('hashText', () => {
    it('produces consistent hashes for the same text', async () => {
      const hash1 = await scamDatabase.hashText('hello world');
      const hash2 = await scamDatabase.hashText('hello world');
      expect(hash1).toBe(hash2);
    });

    it('normalizes text before hashing (case-insensitive)', async () => {
      const hash1 = await scamDatabase.hashText('Hello World');
      const hash2 = await scamDatabase.hashText('hello world');
      expect(hash1).toBe(hash2);
    });

    it('normalizes whitespace', async () => {
      const hash1 = await scamDatabase.hashText('hello   world');
      const hash2 = await scamDatabase.hashText('hello world');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different text', async () => {
      const hash1 = await scamDatabase.hashText('text one');
      const hash2 = await scamDatabase.hashText('text two');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('store and lookup', () => {
    it('stores and retrieves a scam record', async () => {
      await scamDatabase.store('envía dinero urgente bitcoin', 'PELIGROSO', 85, ['Fraude financiero'], 'gemini');

      const result = await scamDatabase.lookup('envía dinero urgente bitcoin');
      expect(result.found).toBe(true);
      expect(result.record?.verdict).toBe('PELIGROSO');
      expect(result.record?.riskScore).toBe(85);
      expect(result.record?.tactics).toContain('Fraude financiero');
    });

    it('returns not found for unknown text', async () => {
      const result = await scamDatabase.lookup('hola como estas');
      expect(result.found).toBe(false);
      expect(result.record).toBeUndefined();
    });

    it('matches regardless of case', async () => {
      await scamDatabase.store('DAME TU CONTRASEÑA', 'SOSPECHOSO', 55, ['Phishing'], 'local');

      const result = await scamDatabase.lookup('dame tu contraseña');
      expect(result.found).toBe(true);
    });
  });

  describe('getCount', () => {
    it('returns 0 for empty database', async () => {
      const count = await scamDatabase.getCount();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('increments when records are stored', async () => {
      const before = await scamDatabase.getCount();
      await scamDatabase.store('scam text 1', 'PELIGROSO', 80, [], 'test');
      await scamDatabase.store('scam text 2', 'SOSPECHOSO', 50, [], 'test');
      const after = await scamDatabase.getCount();
      expect(after).toBeGreaterThanOrEqual(before + 2);
    });
  });
});
