import { useState } from 'react';
import { Bell, Trash2, ShieldAlert, Share2, ChevronDown, ChevronUp, Copy, Check, Download } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';
import type { AlertEntry } from '@/store/useNadaStore';

export function AlertsView() {
  const { language, alerts, clearAlerts } = useNadaStore();
  const t = translations[language];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleShare = async (alert: AlertEntry) => {
    const shareText = buildShareText(alert, language);

    if (navigator.share) {
      try {
        await navigator.share({
          title: `NADA: ${alert.verdict}`,
          text: shareText,
        });
      } catch {
        // User cancelled or share failed, fallback to clipboard
        await copyToClipboard(shareText, alert.id);
      }
    } else {
      await copyToClipboard(shareText, alert.id);
    }
  };

  const copyToClipboard = async (text: string, alertId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(alertId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  };

  const handleExport = (format: 'json' | 'csv') => {
    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'json') {
      content = JSON.stringify(alerts, null, 2);
      filename = `nada-alertas-${new Date().toISOString().slice(0, 10)}.json`;
      mimeType = 'application/json';
    } else {
      const headers = 'Timestamp,Verdict,RiskScore,Description,Tactic,Source\n';
      const rows = alerts.map((a) =>
        `"${a.timestamp}","${a.verdict}",${a.riskScore},"${a.description.replace(/"/g, '""')}","${a.detectedTactic ?? ''}","${a.app}"`
      ).join('\n');
      content = headers + rows;
      filename = `nada-alertas-${new Date().toISOString().slice(0, 10)}.csv`;
      mimeType = 'text/csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 fade-slide-in">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t.alertsTitle}</h2>
        {alerts.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer hover:scale-105 transition-transform"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              title={language === 'es' ? 'Exportar CSV' : 'Export CSV'}
            >
              <Download className="w-3 h-3" />
              CSV
            </button>
            <button
              onClick={clearAlerts}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border cursor-pointer hover:scale-105 transition-transform"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.clearAlerts}
            </button>
          </div>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="card p-12 text-center">
          <Bell className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t.noAlerts}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const badgeClass = alert.verdict === 'PELIGROSO' ? 'badge-dangerous' : alert.verdict === 'SOSPECHOSO' ? 'badge-suspicious' : 'badge-safe';
            const isExpanded = expandedId === alert.id;
            const isCopied = copiedId === alert.id;

            return (
              <div key={alert.id} className="card overflow-hidden">
                {/* Main row */}
                <div
                  className="p-4 cursor-pointer transition-all"
                  onClick={() => toggleExpand(alert.id)}
                >
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0" style={{ color: alert.verdict === 'PELIGROSO' ? 'var(--danger)' : 'var(--warning)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass}`}>
                          {alert.verdict}
                        </span>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {alert.timestamp}
                        </span>
                      </div>
                      <p className={`text-sm ${isExpanded ? '' : 'truncate'}`} style={{ color: 'var(--text-primary)' }}>
                        {alert.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {alert.app}
                        </span>
                        {alert.detectedTactic && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                            {alert.detectedTactic}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-sm font-bold font-mono" style={{ color: alert.riskScore >= 70 ? 'var(--danger)' : 'var(--warning)' }}>
                        {alert.riskScore}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t space-y-3 fade-slide-in" style={{ borderColor: 'var(--border)' }}>
                    {/* Risk bar */}
                    <div className="pt-3">
                      <div className="flex justify-between text-[10px] mb-1">
                        <span style={{ color: 'var(--text-muted)' }}>{t.riskScore}</span>
                        <span className="font-mono font-bold" style={{ color: alert.riskScore >= 70 ? 'var(--danger)' : 'var(--warning)' }}>
                          {alert.riskScore}/100
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${alert.riskScore}%`,
                            background: alert.riskScore >= 70 ? 'var(--danger)' : alert.riskScore >= 40 ? 'var(--warning)' : 'var(--success)',
                          }}
                        />
                      </div>
                    </div>

                    {/* Full description */}
                    <div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {alert.description}
                      </p>
                    </div>

                    {/* Detected tactic detail */}
                    {alert.detectedTactic && (
                      <div className="p-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                        <p className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-muted)' }}>
                          {language === 'es' ? 'Tactica detectada' : 'Detected tactic'}
                        </p>
                        <p className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                          {alert.detectedTactic}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShare(alert); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all hover:scale-105"
                        style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
                      >
                        {isCopied ? <Check className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
                        {isCopied
                          ? (language === 'es' ? 'Copiado' : 'Copied')
                          : (language === 'es' ? 'Compartir' : 'Share')}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(alert.description, alert.id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all hover:scale-105"
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                      >
                        <Copy className="w-3 h-3" />
                        {language === 'es' ? 'Copiar' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Build shareable text for an alert
function buildShareText(alert: AlertEntry, language: 'es' | 'en'): string {
  if (language === 'es') {
    return `⚠️ ALERTA NADA — ${alert.verdict}\n\n` +
      `Riesgo: ${alert.riskScore}/100\n` +
      `${alert.description}\n` +
      (alert.detectedTactic ? `Tactica: ${alert.detectedTactic}\n` : '') +
      `Fuente: ${alert.app}\n\n` +
      `Detectado por NADA — Proteccion contra estafas con IA`;
  }
  return `⚠️ NADA ALERT — ${alert.verdict}\n\n` +
    `Risk: ${alert.riskScore}/100\n` +
    `${alert.description}\n` +
    (alert.detectedTactic ? `Tactic: ${alert.detectedTactic}\n` : '') +
    `Source: ${alert.app}\n\n` +
    `Detected by NADA — AI-powered scam protection`;
}
