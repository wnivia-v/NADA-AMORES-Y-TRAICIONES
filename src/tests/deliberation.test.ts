// =============================================================================
// El acta: que se puede afirmar sobre ella y que no
//
// Casi todo lo que se prueba aqui es sobre lo que el modulo se NIEGA a decir.
// Con dos respuestas no hay divergencia posible, y un modulo que la declarase
// estaria inventando; que ese silencio siga ahi es la mitad del valor.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  findSuspicions,
  participants,
  DIVERGENCE_POINTS,
  MIN_FOR_DIVERGENCE,
  type ProviderRun,
} from '@/shared/llm/deliberation';

function answered(id: string, value: number): ProviderRun {
  return {
    id,
    name: id,
    outcome: 'answered',
    ms: 10,
    signal: {
      type: 'llm-risk',
      value,
      confidence: 0.8,
      timestamp: 0,
      tactics: [],
      explanation: '',
      recommendations: [],
    },
  };
}

function failed(id: string, detail = 'HTTP 502'): ProviderRun {
  return { id, name: id, outcome: 'failed', ms: 30, signal: null, transport: 'http-error', detail };
}

describe('acta de deliberacion — indicios', () => {
  describe('divergencia', () => {
    it('con DOS respuestas no dice nada, aunque sean opuestas', () => {
      // Si una dice 5 y otra 95, no hay forma de saber cual se aparta. Marcar a
      // cualquiera de las dos seria elegir a cara o cruz.
      const runs = [answered('a', 5), answered('b', 95)];
      expect(findSuspicions(runs, false)).toEqual([]);
      expect(MIN_FOR_DIVERGENCE).toBe(3);
    });

    it('con tres, señala a la que se aparta y deja en paz a las que coinciden', () => {
      const runs = [answered('a', 90), answered('b', 88), answered('c', 10)];
      const found = findSuspicions(runs, false);

      expect(found).toHaveLength(1);
      expect(found[0]!.provider).toBe('c');
      expect(found[0]!.kind).toBe('diverges-low');
      // La nota trae los numeros: sin ellos no es comprobable.
      expect(found[0]!.note).toContain('10');
      expect(found[0]!.note).toContain('88');
    });

    it('tambien señala a la que ve MAS riesgo que el resto', () => {
      const runs = [answered('a', 10), answered('b', 12), answered('c', 95)];
      const found = findSuspicions(runs, false);
      expect(found.map((s) => s.kind)).toEqual(['diverges-high']);
    });

    it('no marca desacuerdos normales por debajo del umbral', () => {
      const runs = [answered('a', 60), answered('b', 70), answered('c', 60 + DIVERGENCE_POINTS - 1)];
      expect(findSuspicions(runs, false)).toEqual([]);
    });

    it('cuando el texto traia inyeccion, la nota de la que ve MENOS riesgo lo dice', () => {
      const runs = [answered('a', 90), answered('b', 92), answered('c', 5)];

      const limpio = findSuspicions(runs, false);
      expect(limpio[0]!.note).not.toContain('inyeccion');

      const conInyeccion = findSuspicions(runs, true);
      expect(conInyeccion[0]!.note).toContain('inyeccion');
      expect(conInyeccion[0]!.note).toContain('obedecio');
      // Sigue siendo indicio: no afirma que la atacaran.
      expect(conInyeccion[0]!.note).toContain('revisar');
    });
  });

  describe('respuesta fuera de esquema', () => {
    it('se señala siempre, aunque conteste una sola IA', () => {
      const runs: ProviderRun[] = [
        { id: 'x', name: 'x', outcome: 'rejected', ms: 20, signal: null, rejection: 'not-json' },
      ];
      const found = findSuspicions(runs, false);
      expect(found).toHaveLength(1);
      expect(found[0]!.kind).toBe('schema-rejected');
      expect(found[0]!.note).toContain('not-json');
    });
  });

  describe('quien se calla', () => {
    it('se marca solo si hubo al menos dos que si contestaron', () => {
      // Con una sola respuesta, callarse no distingue a nadie: pudo caerse la red.
      expect(findSuspicions([answered('a', 50), failed('b')], false)).toEqual([]);

      const found = findSuspicions([answered('a', 50), answered('b', 55), failed('c')], false);
      expect(found).toHaveLength(1);
      expect(found[0]!.kind).toBe('went-quiet');
      expect(found[0]!.provider).toBe('c');
    });

    it('una que se ABSTIENE no es una que falla', () => {
      const runs: ProviderRun[] = [
        answered('a', 50),
        answered('b', 55),
        { id: 'c', name: 'c', outcome: 'abstained', ms: 8, signal: null, detail: 'sin vecino parecido' },
      ];
      expect(findSuspicions(runs, false)).toEqual([]);
    });
  });

  it('participants deja fuera solo a las apagadas', () => {
    const runs: ProviderRun[] = [
      answered('a', 50),
      { id: 'b', name: 'b', outcome: 'disabled', ms: null, signal: null },
      { id: 'c', name: 'c', outcome: 'unavailable', ms: null, signal: null },
    ];
    expect(participants(runs).map((r) => r.id)).toEqual(['a', 'c']);
  });
});
