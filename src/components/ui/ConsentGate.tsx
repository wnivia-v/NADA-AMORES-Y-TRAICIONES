import { useState } from 'react';
import { ShieldCheck, Send, Smartphone, ExternalLink } from 'lucide-react';

import { currentPack, recordConsent } from '@/services/policyService';
import { translations } from '@/utils/translations';
import type { Language } from '@/store/useNadaStore';

// =============================================================================
// Pantalla de consentimiento (§4.4, Modo B)
//
// Dos ambitos separados, y la separacion es el punto:
//
//   - PROTECCION es lo que hace falta para que la app haga su trabajo. Nada
//     sale del dispositivo por este ambito.
//   - REPORTES es lo unico que permite que un texto salga. Viene APAGADO y hay
//     que encenderlo a mano.
//
// Juntarlos en un solo boton los debilitaria los dos: legalmente, un
// consentimiento que condiciona el servicio a aceptar un tratamiento que el
// servicio no necesita no es libre; y en la practica, "acepta todo o vete"
// consigue que la gente acepte sin leer.
//
// La frase sobre mensajes de terceros esta puesta donde se lee y no en un
// enlace. Quien enciende los reportes esta entregando conversaciones de otras
// personas que no han consentido nada, y eso hay que decirlo con esas palabras
// antes de que toque el interruptor, no despues en un PDF.
// =============================================================================

interface ConsentGateProps {
  language: Language;
  onDone: () => void;
}

export function ConsentGate({ language, onDone }: ConsentGateProps) {
  const t = translations[language];
  const pack = currentPack();

  const [age, setAge] = useState(false);
  const [reports, setReports] = useState(false);
  const [telemetry, setTelemetry] = useState(false);

  // La proteccion es lo que se viene a usar; el consentimiento se recoge, pero
  // no tiene sentido ofrecerla apagada — apagada no hay producto. Lo que si es
  // una eleccion real, y por eso tiene interruptor, es contribuir reportes.
  const canContinue = age;

  const accept = () => {
    recordConsent({
      ageConfirmed: age,
      // La telemetria no puede viajar sin reporte al que acompañar: si alguien
      // desmarca la contribucion, se apaga con ella.
      scopes: { protection: true, reports, telemetry: reports && telemetry },
    });
    onDone();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{ background: 'var(--bg-base)' }}>
      <div className="card p-6 max-w-md w-full space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: 'var(--text-primary)' }}>{t.consentTitle}</h1>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t.consentIntro}
          </p>
        </div>

        <Block
          icon={<ShieldCheck className="w-4 h-4" style={{ color: 'var(--success)' }} aria-hidden="true" />}
          title={t.consentProtectionTitle}
          body={t.consentProtectionBody}
        />

        <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={reports}
              onChange={(e) => setReports(e.target.checked)}
              className="mt-1 shrink-0"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                <Send className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                {t.consentReportsTitle}
              </span>
              <span className="block text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {t.consentReportsBody}
              </span>
              {/* Lo dice aqui, no en un enlace. */}
              <span className="block text-xs mt-1.5 font-semibold leading-relaxed" style={{ color: 'var(--warning)' }}>
                {t.consentThirdParty}
              </span>
            </span>
          </label>

          {/* Casilla PROPIA, y no una linea dentro de la anterior.
              Aceptar los terminos no puede arrastrar de tapadillo el envio de
              datos del aparato: si van juntos, quien acepta lo primero no ha
              elegido lo segundo. Se puede contribuir sin esto. */}
          {reports && (
            <label
              className="flex items-start gap-3 cursor-pointer pt-2 border-t"
              style={{ borderColor: 'var(--border)' }}
            >
              <input
                type="checkbox"
                checked={telemetry}
                onChange={(e) => setTelemetry(e.target.checked)}
                className="mt-1 shrink-0"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  <Smartphone className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                  {t.consentTelemetryTitle}
                </span>
                <span className="block text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {t.consentTelemetryBody}
                </span>
              </span>
            </label>
          )}
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="mt-1 shrink-0" />
          <span className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t.consentAge.replace('{age}', String(pack.minimumAge))}
          </span>
        </label>

        {(pack.privacyNoticeUrl || pack.supervisoryAuthority) && (
          <div className="text-[11px] space-y-1 pt-1" style={{ color: 'var(--text-muted)' }}>
            {pack.privacyNoticeUrl && (
              <a
                href={pack.privacyNoticeUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 underline"
              >
                {t.consentPrivacyNotice}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
            {pack.supervisoryAuthority && (
              <p>{t.consentAuthority.replace('{authority}', pack.supervisoryAuthority)}</p>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={!canContinue}
          onClick={accept}
          className="w-full py-3 rounded-xl font-bold text-sm disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--bg-base)' }}
        >
          {t.consentContinue}
        </button>

        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
          {t.consentChangeLater}
        </p>
      </div>
    </div>
  );
}

function Block({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <p className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
        {icon}
        {title}
      </p>
      <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
    </div>
  );
}
