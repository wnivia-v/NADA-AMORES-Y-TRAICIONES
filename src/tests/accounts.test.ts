// @vitest-environment node
//
// Node y no jsdom: aqui se habla con PostgreSQL de verdad.
//
// La bateria entera corre DOS VECES, contra el almacen en memoria y contra la
// base de datos real. Es lo que hace que "verificado" signifique lo mismo en los
// dos sitios: no hay dos juegos de tests que puedan divergir sin que nadie se
// entere, hay uno solo aplicado a las dos implementaciones.
//
// Si no hay TEST_DATABASE_URL, la vuelta de PostgreSQL se salta y se DICE. Un
// test que se salta en silencio es un test que un dia deja de existir.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';

import {
  handleRegister, handleVerify, handleLogin, handleLogout,
  handleDeleteAccount, authenticate,
} from '../../server/src/handlers/accounts';
import { handleFeedback, validateReport } from '../../server/src/handlers/feedback';
import { MemoryStore } from '../../server/src/store/memory';
import { setStore, activeStore } from '../../server/src/store';
import type { Store } from '../../server/src/store/types';
import { hashToken, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../../server/src/auth/credentials';
import { loginLimiter, registerLimiter, REPORTS_PER_HOUR } from '../../server/src/auth/rateLimit';

const ctx = { clientKey: 'test', verifyUrlBase: 'http://localhost/verificar' };

/** La bateria completa, aplicada a un almacen cualquiera. */
function suiteDeCuentas(nombre: string, preparar: () => Promise<{ store: Store; reset: () => Promise<void> }>) {
  describe(`almacen: ${nombre}`, () => {
    let reset: () => Promise<void>;

    beforeAll(async () => {
      const prepared = await preparar();
      setStore(prepared.store, nombre === 'postgres' ? 'postgres' : 'memoria');
      reset = prepared.reset;
    });

    beforeEach(async () => {
      await reset();
      loginLimiter.reset();
      registerLimiter.reset();
    });

  

  /** Registra, verifica y entra. Devuelve el token de sesion. */
  async function cuentaLista(email = 'alguien@ejemplo.test'): Promise<string> {
    await handleRegister({ email, password: 'una frase larga de verdad', region: 'es' }, ctx);

    const account = await activeStore().accountByEmail(email);
    // El token real solo existe dentro del registro; aqui se marca verificada
    // directamente porque lo que se esta probando es otra cosa.
    await activeStore().markVerified(account!.id, new Date());

    const login = await handleLogin({ email, password: 'una frase larga de verdad' }, ctx);
    return (login.body as { token: string }).token;
  }

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

  describe('contraseñas', () => {
    it('la misma contraseña da hashes distintos: cada una lleva su sal', async () => {
      const a = await hashPassword('la misma frase de siempre');
      const b = await hashPassword('la misma frase de siempre');
      expect(a.hash).not.toBe(b.hash);
      expect(await verifyPassword('la misma frase de siempre', a)).toBe(true);
      expect(await verifyPassword('la misma frase de siempre', b)).toBe(true);
    });

    it('una contraseña equivocada no pasa, y una entrada rara no revienta', async () => {
      const digest = await hashPassword('frase correcta y larga');
      expect(await verifyPassword('otra cosa', digest)).toBe(false);
      expect(await verifyPassword('', { hash: 'no-es-hex', salt: '' })).toBe(false);
    });
  });

  describe('registro', () => {
    it('rechaza contraseñas cortas diciendo por que', async () => {
      const res = await handleRegister({ email: 'a@b.test', password: 'corta' }, ctx);
      expect(res.status).toBe(400);
      expect(String((res.body as { error: string }).error)).toContain(String(MIN_PASSWORD_LENGTH));
    });

    it('NO revela si un correo ya esta registrado', async () => {
      // En una app de seguridad personal, un formulario que distingue "existe" de
      // "no existe" permite averiguar si una persona concreta usa NADA. Puede
      // estar usandola precisamente para huir de quien pregunta.
      const primero = await handleRegister({ email: 'x@ejemplo.test', password: 'frase larga valida' }, ctx);
      const repetido = await handleRegister({ email: 'x@ejemplo.test', password: 'otra frase distinta' }, ctx);

      expect(repetido.status).toBe(primero.status);
      expect(repetido.body).toEqual(primero.body);
    });

    it('el registro repetido no pisa la cuenta existente', async () => {
      await handleRegister({ email: 'y@ejemplo.test', password: 'frase larga original' }, ctx);
      const antes = await activeStore().accountByEmail('y@ejemplo.test');
      await handleRegister({ email: 'y@ejemplo.test', password: 'frase del atacante' }, ctx);
      const despues = await activeStore().accountByEmail('y@ejemplo.test');

      // Si el segundo registro sobrescribiera la contraseña, cualquiera podria
      // apropiarse de una cuenta ajena con solo saber el correo.
      expect(despues?.passwordHash).toBe(antes?.passwordHash);
    });

    it('corta el registro en bucle', async () => {
      for (let i = 0; i < 5; i += 1) {
        await handleRegister({ email: `n${i}@ejemplo.test`, password: 'frase larga valida' }, ctx);
      }
      const res = await handleRegister({ email: 'ultimo@ejemplo.test', password: 'frase larga valida' }, ctx);
      expect(res.status).toBe(429);
    });
  });

  describe('login y sesion', () => {
    it('el mismo error para correo inexistente y contraseña equivocada', async () => {
      await handleRegister({ email: 'real@ejemplo.test', password: 'frase larga valida' }, ctx);

      const noExiste = await handleLogin({ email: 'nadie@ejemplo.test', password: 'lo que sea largo' }, ctx);
      const malaClave = await handleLogin({ email: 'real@ejemplo.test', password: 'equivocada pero larga' }, ctx);

      expect(noExiste.status).toBe(401);
      expect(malaClave.status).toBe(401);
      expect(noExiste.body).toEqual(malaClave.body);
    });

    it('el token de sesion NO se guarda tal cual', async () => {
      const token = await cuentaLista('sesion@ejemplo.test');
      // Quien lea la base de datos no puede suplantar a nadie con lo que hay
      // dentro: tiene el hash, no el token.
      expect(await activeStore().sessionByHash(token)).toBeNull();
      expect(await activeStore().sessionByHash(hashToken(token))).not.toBeNull();
    });

    it('una sesion caducada no vale, y se limpia al detectarla', async () => {
      const token = await cuentaLista('caduca@ejemplo.test');
      const hash = hashToken(token);
      const sesion = (await activeStore().sessionByHash(hash))!;
      await activeStore().createSession({ ...sesion, expiresAt: new Date(Date.now() - 1000) });

      expect(await authenticate(token)).toBeNull();
      expect(await activeStore().sessionByHash(hash)).toBeNull();
    });

    it('un token inventado no autentica', async () => {
      expect(await authenticate('inventado')).toBeNull();
      expect(await authenticate(null)).toBeNull();
    });

    it('salir invalida la sesion, y salir dos veces no falla', async () => {
      const token = await cuentaLista('salir@ejemplo.test');
      expect(await handleLogout(token)).toEqual({ status: 204, body: null });
      expect(await authenticate(token)).toBeNull();
      expect((await handleLogout(token)).status).toBe(204);
    });

    it('frena la fuerza bruta contra una cuenta', async () => {
      await handleRegister({ email: 'fuerza@ejemplo.test', password: 'frase larga valida' }, ctx);
      for (let i = 0; i < 8; i += 1) {
        await handleLogin({ email: 'fuerza@ejemplo.test', password: `intento numero ${i}` }, ctx);
      }
      const res = await handleLogin({ email: 'fuerza@ejemplo.test', password: 'frase larga valida' }, ctx);
      expect(res.status).toBe(429);
    });
  });

  describe('verificacion de correo', () => {
    it('un token invalido o caducado no verifica nada', async () => {
      expect((await handleVerify({ token: 'inventado' })).status).toBe(400);
      expect((await handleVerify({})).status).toBe(400);
    });

    it('el token es de un solo uso', async () => {
      await activeStore().createAccount({
        id: 'cuenta-1', email: 'v@ejemplo.test', passwordHash: 'x', passwordSalt: 'y',
        verifiedAt: null, createdAt: new Date(), region: 'es',
      });
      await activeStore().createVerification({
        tokenHash: hashToken('token-bueno'), accountId: 'cuenta-1',
        createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      });

      expect((await handleVerify({ token: 'token-bueno' })).status).toBe(200);
      // Un token filtrado no se puede reintentar.
      expect((await handleVerify({ token: 'token-bueno' })).status).toBe(400);
    });
  });

  describe('reportes: quien puede escribir en el corpus', () => {
    it('sin verificar el correo no se acepta ninguno', async () => {
      // Es lo que hace que envenenar el corpus cueste algo: sin verificacion, mil
      // cuentas son mil formularios; con ella, son mil buzones.
      const res = await handleFeedback(reporteValido(), { accountId: 'x', verified: false });
      expect(res.status).toBe(403);
    });

    it('con cuenta verificada se guarda', async () => {
      const token = await cuentaLista('reporta@ejemplo.test');
      const auth = (await authenticate(token))!;
      const res = await handleFeedback(reporteValido(), auth);

      expect(res.status).toBe(201);
      expect(await activeStore().findReports({})).toHaveLength(1);
    });

    it('corta el envio masivo', async () => {
      const token = await cuentaLista('masivo@ejemplo.test');
      const auth = (await authenticate(token))!;

      for (let i = 0; i < REPORTS_PER_HOUR; i += 1) {
        expect((await handleFeedback(reporteValido(), auth)).status).toBe(201);
      }
      expect((await handleFeedback(reporteValido(), auth)).status).toBe(429);
    });
  });

  describe('el cliente no es una frontera de confianza', () => {
    it('un reporte de VIDEO pierde el contenido aunque la peticion lo traiga', () => {
      // §4.1 se impone aqui. El cliente ya lo hace, pero el cliente corre en la
      // maquina de otra persona: puede estar modificado o la peticion puede estar
      // fabricada a mano.
      const result = validateReport(reporteValido({
        surface: 'video',
        content: 'esto no deberia guardarse jamas',
      }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.report.content).toBeNull();
    });

    it('lo que no encaja se rechaza entero, no se guarda a medias', () => {
      const casos: [Record<string, unknown>, string][] = [
        [{ surface: 'telepatia' }, 'surface'],
        [{ judgment: 'quiza' }, 'judgment'],
        [{ shown: { band: 'REGULAR', riskScore: 10 } }, 'shown.band'],
        [{ shown: { band: 'SEGURO', riskScore: 900 } }, 'shown.riskScore'],
        [{ trace: { localScore: -5 } }, 'trace.localScore'],
        [{ context: { lexiconVersion: '' } }, 'context.lexiconVersion'],
      ];

      for (const [override, campo] of casos) {
        const result = validateReport(reporteValido(override));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.failure.field).toBe(campo);
      }
    });

    it('un acierto no puede traer clase de error, ni un fallo venir sin ella', () => {
      expect(validateReport(reporteValido({ judgment: 'correct' })).ok).toBe(false);
      expect(validateReport(reporteValido({ judgment: 'correct', errorKind: null })).ok).toBe(true);
      expect(validateReport(reporteValido({ errorKind: null })).ok).toBe(false);
    });

    it('las listas y los textos se acotan', () => {
      const result = validateReport(reporteValido({
        content: 'x'.repeat(99_000),
        note: 'y'.repeat(9_000),
        trace: { ...reporteValido().trace, lexiconIds: Array.from({ length: 500 }, (_, i) => `id-${i}`) },
      }));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.report.content!.length).toBe(4000);
        expect(result.report.note!.length).toBe(500);
        expect(result.report.lexiconIds.length).toBe(64);
      }
    });
  });

  describe('derecho de supresion', () => {
    it('borrar la cuenta se lleva TODO lo que colgaba de ella', async () => {
      const token = await cuentaLista('borrame@ejemplo.test');
      const auth = (await authenticate(token))!;
      await handleFeedback(reporteValido(), auth);

      expect(await activeStore().findReports({})).toHaveLength(1);

      const res = await handleDeleteAccount(auth);
      expect(res.status).toBe(204);

      // Ni cuenta, ni sesion, ni reportes. Una sola llamada, no siete sitios que
      // recordar dentro de dos años.
      expect(await activeStore().accountByEmail('borrame@ejemplo.test')).toBeNull();
      expect(await activeStore().sessionByHash(hashToken(token))).toBeNull();
      expect(await activeStore().findReports({})).toHaveLength(0);
      expect(await authenticate(token)).toBeNull();
    });
  });

  });
}

suiteDeCuentas('memoria', async () => {
  const store = new MemoryStore();
  return { store, reset: async () => store.reset() };
});

const TEST_DB = process.env['TEST_DATABASE_URL'];

if (TEST_DB) {
  const { createPrismaStore } = await import('../../server/src/store/prisma');
  const prisma = createPrismaStore(TEST_DB);

  suiteDeCuentas('postgres', async () => ({
    store: prisma,
    reset: () => prisma.reset(),
  }));

  afterAll(async () => {
    await prisma.disconnect();
  });
} else {
  describe('almacen: postgres', () => {
    it.skip('SALTADO: sin TEST_DATABASE_URL no se prueba contra la base real', () => {
      // Se salta RUIDOSAMENTE a proposito. Un test que desaparece en silencio
      // cuando falta una variable de entorno es un test que un dia ya no existe.
    });
  });
}
