import { useState } from 'react';
import { Lock, Trash2, Mail, ExternalLink } from 'lucide-react';

import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';
import {
  currentPack,
  mayShareReports,
  revoke,
  forgetConsent,
} from '@/services/policyService';
import { feedbackService } from '@/services/feedbackService';

// =============================================================================
// Privacidad y datos — la parte de §4.4 que el usuario puede tocar
//
// Retirar tiene que ser tan facil como conceder, y ademas PARCIAL: dejar de
// contribuir reportes no puede obligar a nadie a dejar de usar la proteccion.
// Por eso hay un boton para lo primero y otro, aparte, para borrarlo todo.
//
// El borrado local es real y es inmediato — vacia la cola de reportes, el
// historial de alertas y el consentimiento — pero solo alcanza a ESTE
// dispositivo. Cuando existan cuentas habra que enlazar aqui el borrado del
// lado del servidor, y hasta entonces conviene no dar a entender que ya lo hace.
// =============================================================================

export function PrivacyPanel() {
  const { language, clearAlerts } = useNadaStore();
  const t = translations[language];
  const pack = currentPack();

  const [sharing, setSharing] = useState(() => mayShareReports());
  const [deleted, setDeleted] = useState(false);

  const stopSharing = () => {
    revoke('reports');
    setSharing(false);
  };

  const deleteLocal = async () => {
    await feedbackService.clear();
    feedbackService.resetDrafts();
    clearAlerts();
    forgetConsent();
    setSharing(false);
    setDeleted(true);
  };

  return (
    <div className="card p-4 space-y-3">
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
        <Lock className="w-4 h-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        {t.privacyTitle}
      </p>

      <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
        <p>{sharing ? t.privacyReportsOn : t.privacyReportsOff}</p>
        <p style={{ color: 'var(--text-muted)' }}>
          {t.privacyRegion}: <span className="font-mono">{pack.region}</span>
        </p>
        <p style={{ color: 'var(--text-muted)' }}>
          {pack.historyRetentionDays > 0
            ? t.privacyRetention.replace('{days}', String(pack.historyRetentionDays))
            : t.privacyRetentionNone}
        </p>
      </div>

      {(pack.rightsChannel.email || pack.rightsChannel.url) && (
        <div className="text-xs">
          <p className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>{t.privacyRights}</p>
          {pack.rightsChannel.email && (
            <a href={`mailto:${pack.rightsChannel.email}`} className="flex items-center gap-1.5 underline" style={{ color: 'var(--accent)' }}>
              <Mail className="w-3 h-3" aria-hidden="true" />
              {pack.rightsChannel.email}
            </a>
          )}
          {pack.rightsChannel.url && (
            <a href={pack.rightsChannel.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 underline" style={{ color: 'var(--accent)' }}>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              {pack.rightsChannel.url}
            </a>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        {sharing && (
          <button
            type="button"
            onClick={stopSharing}
            className="text-xs font-semibold py-2 rounded-lg"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            {t.privacyStopSharing}
          </button>
        )}

        <button
          type="button"
          onClick={() => void deleteLocal()}
          className="text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5"
          style={{ background: 'var(--dangerous-bg)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          {t.privacyDeleteLocal}
        </button>

        {deleted && (
          <p className="text-xs text-center" style={{ color: 'var(--success)' }}>{t.privacyDeleted}</p>
        )}
      </div>
    </div>
  );
}
