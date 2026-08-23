// @vitest-environment node
//
// Node y no jsdom: aqui se habla con PostgreSQL de verdad.
//
// Sustituye a la bateria que corria sobre cuentas con correo. Las reglas que
// protegia siguen existiendo —el limite de ritmo, que un reporte de video no
// lleve contenido, que borrar borre— y sin cuentas hay una nueva que importa
// mas que ninguna: que rotar el identificador de instalacion no sirva para
// saltarse el limite. Es la unica defensa que queda contra el envenenamiento
// por volumen, porque la IP es lo unico que el cliente no puede poner.
//
// Corre DOS VECES, contra el almacen en memoria y contra la base real. Si no
// hay TEST_DATABASE_URL, la segunda vuelta se salta y se DICE: un test que
// desaparece en silencio es un test que un dia deja de existir.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';

import { handleFeedback, handleDeleteReports, validateReport } from '../../server/src/handlers/feedback';
import { MemoryStore } from '../../server/src/store/memory';
import { setStore, activeStore } from '../../server/src/store';
import type { Store } from '../../server/src/store/types';
import { REPORTS_PER_HOUR } from '../../server/src/auth/rateLimit';
import { parseDeviceContext } from '../shared/telemetry/types';

const DEVICE = {
  installId: '11111111-2222-4333-8444-555555555555',
  platform: 'android' as const,
  os: 'Android 14',
  deviceModel: 'Pixel 8',
  appVersion: '2.0.0',
  uiLanguage: 'es',
};

function reporteValido(overrides: Record<string, unknown> = {}) {
  return {
    surface: 'text',
    judgment: 'incorrect',
    errorKind: 'false-positive',
    shown: { band: 'PELIGROSO', riskScore: 82, alerted: true, corroborated: true, scanSource: 'hybrid' },
    trace: {
      drivers: [{ type: 'local-patterns', evidence: 0.7 }],
      lexiconIds: ['fin-send-money'], combos: [], dampened: [],
      localScore: 80, llmScore: 60, injectionHits: [],
    },
    content: 'mandame 300 euros',
    context: { region: 'es', language: 'es', appVersion: '2.0.0', lexiconVersion: 'abc12345' },
    ...overrides,
  };
}

function suiteDeReportes(nombre: string, preparar: () => Promise<{ store: Store; reset: () => Promise<void> }>) {
  describe(`almacen: ${nombre}`, () => {
    let reset: () => Promise<void>;

    beforeAll(async () => {
      const prepared = await preparar();
      setStore(prepared.store, nombre === 'postgres' ? 'postgres' : 'memoria');
      reset = prepared.reset;
    });

    beforeEach(async () => { await reset(); });

    describe('identidad sin cuenta', () => {
      it('un reporte con contexto guarda de que aparato salio', async () => {
        const res = await handleFeedback(reporteValido(), { ip: '10.0.0.1', device: DEVICE });
        expect(res.status).toBe(201);

        const [guardado] = await activeStore().findReports({});
        expect(guardado!.installId).toBe(DEVICE.installId);
        expect(guardado!.platform).toBe('android');
        expect(guardado!.deviceModel).toBe('Pixel 8');
        expect(guardado!.ip).toBe('10.0.0.1');
      });

      it('con la telemetria apagada el reporte SIGUE valiendo, sin contexto', async () => {
        // Apagar los datos del aparato no puede costar la contribucion: es una
        // puerta aparte justamente para eso.
        const res = await handleFeedback(reporteValido(), { ip: '10.0.0.2', device: null });
        expect(res.status).toBe(201);

        const [guardado] = await activeStore().findReports({});
        expect(guardado!.platform).toBeNull();
        expect(guardado!.deviceModel).toBeNull();
        // La IP se anota igual: la lee el servidor, no depende del ajuste.
        expect(guardado!.ip).toBe('10.0.0.2');
        // Y queda atado a la IP, para que cuente en algun limite.
        expect(guardado!.installId).toBe('ip:10.0.0.2');
      });
    });

    describe('limite de ritmo', () => {
      it('corta el envio masivo desde la misma instalacion', async () => {
        for (let i = 0; i < REPORTS_PER_HOUR; i++) {
          const r = await handleFeedback(reporteValido(), { ip: '10.0.0.3', device: DEVICE });
          expect(r.status).toBe(201);
        }
        const pasado = await handleFeedback(reporteValido(), { ip: '10.0.0.3', device: DEVICE });
        expect(pasado.status).toBe(429);
      });

      it('ROTAR el identificador no salta el limite: la IP sigue contando', async () => {
        // Esta es la regla que sostiene todo el modelo sin cuentas. El
        // identificador de instalacion se borra vaciando el almacenamiento, asi
        // que si el limite dependiera solo de el bastaria con eso entre envios.
        for (let i = 0; i < REPORTS_PER_HOUR; i++) {
          const nuevoCadaVez = {
            ...DEVICE,
            installId: `${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`,
          };
          const r = await handleFeedback(reporteValido(), { ip: '10.0.0.4', device: nuevoCadaVez });
          expect(r.status).toBe(201);
        }

        const otroMas = await handleFeedback(reporteValido(), {
          ip: '10.0.0.4',
          device: { ...DEVICE, installId: '99999999-2222-4333-8444-555555555555' },
        });
        expect(otroMas.status).toBe(429);
      });

      it('otra IP no arrastra el limite de la primera', async () => {
        for (let i = 0; i < REPORTS_PER_HOUR; i++) {
          await handleFeedback(reporteValido(), { ip: '10.0.0.5', device: null });
        }
        const distinta = await handleFeedback(reporteValido(), { ip: '10.0.0.6', device: null });
        expect(distinta.status).toBe(201);
      });
    });

    describe('§4.1 — un reporte de video no lleva contenido', () => {
      it('el servidor lo descarta aunque la peticion lo traiga', async () => {
        // El cliente corre en la maquina de otra persona: que el tipo lo impida
        // alli no basta, tiene que imponerse aqui.
        await handleFeedback(
          reporteValido({ surface: 'video', content: 'esto no deberia guardarse jamas' }),
          { ip: '10.0.0.7', device: DEVICE },
        );

        const [guardado] = await activeStore().findReports({});
        expect(guardado!.content).toBeNull();
      });
    });

    describe('derecho de supresion sin cuenta', () => {
      it('borra lo de esa instalacion y solo eso', async () => {
        const otra = { ...DEVICE, installId: '77777777-2222-4333-8444-555555555555' };
        await handleFeedback(reporteValido(), { ip: '10.0.0.8', device: DEVICE });
        await handleFeedback(reporteValido(), { ip: '10.0.0.9', device: otra });
        expect(await activeStore().findReports({})).toHaveLength(2);

        const res = await handleDeleteReports({ ip: '10.0.0.8', device: DEVICE });
        expect(res.status).toBe(200);
        expect((res.body as { deleted: number }).deleted).toBe(1);

        const quedan = await activeStore().findReports({});
        expect(quedan).toHaveLength(1);
        expect(quedan[0]!.installId).toBe(otra.installId);
      });

      it('sin identificador no se borra a ciegas', async () => {
        // Borrar "lo de esta IP" arrasaria con lo de toda una casa o un locutorio.
        await handleFeedback(reporteValido(), { ip: '10.0.0.10', device: DEVICE });
        const res = await handleDeleteReports({ ip: '10.0.0.10', device: null });

        expect(res.status).toBe(400);
        expect(await activeStore().findReports({})).toHaveLength(1);
      });
    });
  });
}

describe('contexto del aparato: entrada no fiable', () => {
  it('acepta uno bien formado', () => {
    expect(parseDeviceContext(DEVICE)).toEqual(DEVICE);
  });

  it('el modelo puede faltar: en web casi nunca se sabe', () => {
    const sinModelo = { ...DEVICE, deviceModel: null };
    expect(parseDeviceContext(sinModelo)?.deviceModel).toBeNull();
  });

  it('rechaza un identificador que no sea UUID', () => {
    expect(parseDeviceContext({ ...DEVICE, installId: 'soy-quien-yo-diga' })).toBeNull();
  });

  it('rechaza una plataforma inventada', () => {
    expect(parseDeviceContext({ ...DEVICE, platform: 'mainframe' })).toBeNull();
  });

  it('rechaza campos desmesurados en vez de recortarlos', () => {
    // Recortar guardaria un valor que nadie envio. Cerrado por defecto, igual
    // que con la respuesta del modelo.
    expect(parseDeviceContext({ ...DEVICE, os: 'x'.repeat(500) })).toBeNull();
  });

  it('un contexto a medias se rechaza entero', () => {
    const { os: _os, ...sinSistema } = DEVICE;
    expect(parseDeviceContext(sinSistema)).toBeNull();
  });

  it('nada, texto y numeros no son un contexto', () => {
    for (const basura of [null, undefined, 'hola', 42, []]) {
      expect(parseDeviceContext(basura)).toBeNull();
    }
  });
});

describe('validateReport sigue cerrado', () => {
  it('un reporte sin veredicto no pasa', () => {
    const { shown: _shown, ...sinShown } = reporteValido();
    expect(validateReport(sinShown).ok).toBe(false);
  });
});

suiteDeReportes('memoria', async () => {
  const store = new MemoryStore();
  return { store, reset: async () => store.reset() };
});

const TEST_DB = process.env['TEST_DATABASE_URL'];

if (TEST_DB) {
  const { createPrismaStore } = await import('../../server/src/store/prisma');
  const prisma = createPrismaStore(TEST_DB);

  suiteDeReportes('postgres', async () => ({ store: prisma, reset: () => prisma.reset() }));

  afterAll(async () => { await prisma.disconnect(); });
} else {
  describe('almacen: postgres', () => {
    it.skip('SALTADO: sin TEST_DATABASE_URL no se prueba contra la base real', () => {});
  });
}
