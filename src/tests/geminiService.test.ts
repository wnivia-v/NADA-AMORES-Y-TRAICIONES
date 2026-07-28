import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI providers orchestrator
vi.mock('@/services/aiProviders', () => ({
  orchestrateAnalysis: vi.fn(),
}));

// Mock Safe Browsing
vi.mock('@/services/safeBrowsingService', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true, threats: [] }),
}));

// Mock scam database
vi.mock('@/services/scamDatabase', () => ({
  scamDatabase: {
    lookup: vi.fn().mockResolvedValue({ found: false }),
    store: vi.fn().mockResolvedValue(undefined),
  },
}));

import { analyzeText } from '@/services/geminiService';
import { orchestrateAnalysis } from '@/services/aiProviders';
import { checkUrlSafety } from '@/services/safeBrowsingService';
import { scamDatabase } from '@/services/scamDatabase';
import { riskScorer } from '@/utils/riskScorer';

describe('geminiService — analyzeText pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    riskScorer.clear();
  });

  describe('local-only mode (no AI available)', () => {
    beforeEach(() => {
      (orchestrateAnalysis as any).mockResolvedValue({ result: null, providerId: null });
    });

    it('returns SEGURO for safe text', async () => {
      const result = await analyzeText('Hola amigo, nos vemos manana.');
      expect(result.verdict).toBe('SEGURO');
      expect(result.scanSource).toBe('local');
      expect(result.riskScore).toBeLessThan(40);
    });

    it('detects scam patterns locally without AI', async () => {
      const result = await analyzeText('Envía dinero urgente a mi cuenta bitcoin ahora');
      expect(result.verdict).not.toBe('SEGURO');
      expect(result.scanSource).toBe('local');
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.tactics.length).toBeGreaterThan(0);
    });

    it('provides recommendations for threats', async () => {
      const result = await analyzeText('Dame tu número de cuenta y contraseña para verificar');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('hybrid mode (AI available)', () => {
    it('merges AI result with local patterns', async () => {
      (orchestrateAnalysis as any).mockResolvedValue({
        result: {
          verdict: 'PELIGROSO',
          riskScore: 85,
          tactics: ['Fraude financiero'],
          explanation: 'Solicitud de dinero con urgencia',
          recommendations: ['No envíes dinero.'],
        },
        providerId: 'gemini',
      });

      const result = await analyzeText('Transfiere ahora urgente a mi cuenta');
      expect(result.scanSource).toBe('hybrid');
      expect(result.riskScore).toBeGreaterThanOrEqual(70);
      expect(result.verdict).toBe('PELIGROSO');
      expect(result.tactics).toContain('Fraude financiero');
    });

    it('combines local tactics with AI tactics', async () => {
      (orchestrateAnalysis as any).mockResolvedValue({
        result: {
          verdict: 'SOSPECHOSO',
          riskScore: 50,
          tactics: ['Manipulacion emocional'],
          explanation: 'Test',
          recommendations: ['Cuidado'],
        },
        providerId: 'claude',
      });

      // This text matches local "Premio falso" pattern
      const result = await analyzeText('Felicidades ganador del sorteo reclama tu premio');
      expect(result.tactics).toContain('Manipulacion emocional'); // from AI
      expect(result.tactics).toContain('Premio falso'); // from local
    });
  });

  describe('scam database cache', () => {
    it('returns cached result when found in ScamDB', async () => {
      (scamDatabase.lookup as any).mockResolvedValue({
        found: true,
        record: {
          hash: 'abc123',
          verdict: 'PELIGROSO',
          riskScore: 90,
          tactics: ['Sextorsion'],
          source: 'gemini',
          timestamp: Date.now(),
        },
      });

      const result = await analyzeText('known scam text');
      expect(result.verdict).toBe('PELIGROSO');
      expect(result.riskScore).toBe(90);
      expect(result.scanSource).toBe('local'); // cache is "local" source
      // AI should NOT have been called
      expect(orchestrateAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('URL safety integration', () => {
    it('boosts risk score when unsafe URLs detected', async () => {
      (orchestrateAnalysis as any).mockResolvedValue({ result: null, providerId: null });
      (checkUrlSafety as any).mockResolvedValue({ safe: false, threats: ['MALWARE'] });

      const result = await analyzeText('Haz clic aqui: https://malware-site.ru/phish');
      expect(result.riskScore).toBeGreaterThan(0);
    });
  });
});
