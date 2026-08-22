import { describe, it, expect, beforeEach } from 'vitest';

import {
  consentNeeded,
  consentVersionFor,
  grantConsent,
  mayShareReports,
  parseConsent,
  withdrawScope,
  CONSENT_TEXT_VERSION,
} from '@/shared/policy/consent';
import { STRICT_DEFAULT_PACK, type JurisdictionPack } from '@/shared/policy/jurisdiction';
import { packFor, knownRegions } from '../../server/src/policy';

const pack: JurisdictionPack = { ...STRICT_DEFAULT_PACK, region: 'es', historyRetentionDays: 90 };

const consentimientoCompleto = grantConsent(pack, {
  ageConfirmed: true,
  scopes: { protection: true, reports: true },
});

describe('los dos ambitos son decisiones distintas', () => {
  it('se puede usar la proteccion sin contribuir reportes', () => {
    // Un consentimiento que condiciona el servicio a aceptar un tratamiento que
    // el servicio no necesita no es libre. Y proteger a alguien no requiere que
    // sus conversaciones salgan del movil.
    const solo = grantConsent(pack, { ageConfirmed: true, scopes: { protection: true } });
    expect(consentNeeded(pack, solo)).toBe(false);
    expect(mayShareReports(pack, solo)).toBe(false);
  });

  it('los reportes solo se encienden con un true explicito', () => {
    for (const valor of [undefined, null, 'si', 1, {}] as unknown[]) {
      const c = grantConsent(pack, {
        ageConfirmed: true,
        scopes: { protection: true, reports: valor as boolean },
      });
      expect(c.scopes.reports).toBe(false);
    }
    expect(mayShareReports(pack, consentimientoCompleto)).toBe(true);
  });

  it('retirar los reportes no apaga la proteccion', () => {
    const retirado = withdrawScope(consentimientoCompleto, 'reports');
    expect(mayShareReports(pack, retirado)).toBe(false);
    expect(consentNeeded(pack, retirado)).toBe(false);
    expect(retirado.scopes.protection).toBe(true);
  });
});

describe('cuando hay que volver a preguntar', () => {
  it('sin consentimiento, siempre', () => {
    expect(consentNeeded(pack, null)).toBe(true);
    expect(mayShareReports(pack, null)).toBe(false);
  });

  it('si cambia el texto aceptado', () => {
    const viejo = { ...consentimientoCompleto, version: 'version-anterior:es' };
    expect(consentNeeded(pack, viejo)).toBe(true);
    // Y hasta que no se vuelva a aceptar, no sale nada del dispositivo.
    expect(mayShareReports(pack, viejo)).toBe(false);
  });

  it('si cambia la jurisdiccion', () => {
    // Aceptar bajo el pack español no es aceptar bajo otro: puede traer otro
    // aviso, otra autoridad y otro canal de derechos.
    const otraRegion: JurisdictionPack = { ...pack, region: 'mx' };
    expect(consentNeeded(otraRegion, consentimientoCompleto)).toBe(true);
    expect(consentVersionFor(otraRegion)).toBe(`${CONSENT_TEXT_VERSION}:mx`);
  });

  it('si no se declaro la edad', () => {
    const sinEdad = grantConsent(pack, { ageConfirmed: false, scopes: { protection: true } });
    expect(consentNeeded(pack, sinEdad)).toBe(true);
  });

  it('si el pack exige consentimiento explicito y falta el ambito basico', () => {
    const sinProteccion = grantConsent(pack, { ageConfirmed: true, scopes: { reports: true } });
    expect(consentNeeded(pack, sinProteccion)).toBe(true);
    expect(mayShareReports(pack, sinProteccion)).toBe(false);
  });
});

describe('lo que viene del almacenamiento local no es de fiar', () => {
  it('lo que no encaja se descarta y se vuelve a preguntar', () => {
    for (const basura of [null, 'texto', 42, {}, { version: 1 }, { version: 'x', region: 'es' }]) {
      expect(parseConsent(basura)).toBeNull();
    }
  });

  it('un registro manipulado no puede conceder lo que no dice', () => {
    // localStorage lo edita cualquiera con acceso al dispositivo.
    const manipulado = parseConsent({
      version: consentVersionFor(pack), region: 'es', grantedAt: '2026-01-01T00:00:00Z',
      ageConfirmed: 'si', scopes: { protection: 'claro', reports: 'venga' },
    });
    expect(manipulado?.ageConfirmed).toBe(false);
    expect(manipulado?.scopes.reports).toBe(false);
    expect(mayShareReports(pack, manipulado)).toBe(false);
  });

  it('un registro legitimo sobrevive al viaje', () => {
    const ida = JSON.parse(JSON.stringify(consentimientoCompleto));
    expect(parseConsent(ida)).toEqual(consentimientoCompleto);
  });
});

describe('jurisdiction pack servido (§4.4)', () => {
  it('una region desconocida cae al estricto, no al permisivo', () => {
    for (const region of ['xx', '', null, '   ', 'no-existe']) {
      const p = packFor(region);
      expect(p.region).toBe('default');
      expect(p.requiresExplicitConsent).toBe(true);
      expect(p.historyRetentionDays).toBe(0);
    }
  });

  it('una region conocida trae su capa fina', () => {
    const es = packFor('ES');
    expect(es.region).toBe('es');
    expect(es.supervisoryAuthority).toContain('AEPD');
    expect(es.historyRetentionDays).toBe(90);
  });

  it('la edad minima es la misma en todas partes: es una decision de producto', () => {
    // Las leyes de proteccion de datos fijan otra cosa distinta —la edad a la
    // que alguien puede consentir— y mezclarlas seria un error facil de cometer
    // y dificil de detectar.
    const edades = knownRegions().map((r) => packFor(r).minimumAge);
    expect(new Set(edades).size).toBe(1);
    expect(edades[0]).toBe(18);
  });

  it('los datos de contacto salen del entorno, no del codigo', () => {
    // Sin configurar se sirven como null y la app lo enseña como lo que es: un
    // canal sin montar. Inventarse una direccion en el repositorio seria peor.
    delete process.env['RIGHTS_CONTACT_EMAIL'];
    delete process.env['PRIVACY_NOTICE_URL'];
    expect(packFor('es').rightsChannel.email).toBeNull();
    expect(packFor('es').privacyNoticeUrl).toBeNull();

    process.env['RIGHTS_CONTACT_EMAIL'] = 'derechos@ejemplo.test';
    expect(packFor('es').rightsChannel.email).toBe('derechos@ejemplo.test');
    delete process.env['RIGHTS_CONTACT_EMAIL'];
  });
});

describe('retencion: un fallo de red no borra datos', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('sin pack servido no hay corte de retencion', async () => {
    const { resetPolicyForTests, retentionCutoff, loadPolicy } = await import('@/services/policyService');
    resetPolicyForTests();

    // Sin backend configurado, loadPolicy cae al estricto. El estricto dice
    // "cero retencion", pero aplicarlo aqui significaria borrar el historial de
    // alguien porque no habia red.
    await loadPolicy();
    expect(retentionCutoff()).toBeNull();
  });
});
