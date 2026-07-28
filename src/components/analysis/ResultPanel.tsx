import { ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import type { ScamAnalysis } from '@/store/useNadaStore';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';

interface ResultPanelProps {
  result: ScamAnalysis;
}

export function ResultPanel({ result }: ResultPanelProps) {
  const { language } = useNadaStore();
  const t = translations[language];

  const verdictConfig = {
    SEGURO: { icon: ShieldCheck, badge: 'badge-safe', label: t.safe },
    SOSPECHOSO: { icon: AlertTriangle, badge: 'badge-suspicious', label: t.suspicious },
    PELIGROSO: { icon: ShieldAlert, badge: 'badge-dangerous', label: t.dangerous },
  };

  const config = verdictConfig[result.verdict];
  const Icon = config.icon;

  return (
    <div className="card p-5 space-y-4 fade-slide-in">
      {/* Verdict header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className="w-6 h-6" style={{ color: result.verdict === 'SEGURO' ? 'var(--success)' : result.verdict === 'SOSPECHOSO' ? 'var(--warning)' : 'var(--danger)' }} />
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${config.badge}`}>
            {config.label}
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.riskScore}</p>
          <p className="text-2xl font-bold font-mono" style={{ color: result.riskScore >= 70 ? 'var(--danger)' : result.riskScore >= 40 ? 'var(--warning)' : 'var(--success)' }}>
            {result.riskScore}<span className="text-sm">/100</span>
          </p>
        </div>
      </div>

      {/* Risk bar */}
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${result.riskScore}%`,
            background: result.riskScore >= 70 ? 'var(--danger)' : result.riskScore >= 40 ? 'var(--warning)' : 'var(--success)',
          }}
        />
      </div>

      {/* Explanation */}
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {result.explanation}
      </p>

      {/* Tactics */}
      {result.tactics.length > 0 && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>{t.tactics}:</p>
          <div className="flex flex-wrap gap-1.5">
            {result.tactics.map((tactic) => (
              <span key={tactic} className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                {tactic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {result.recommendations.length > 0 && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>{t.recommendations}:</p>
          <ul className="space-y-1">
            {result.recommendations.map((rec, i) => (
              <li key={i} className="text-xs flex gap-2" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--accent)' }}>•</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Source badge */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
          Motor: {result.scanSource}
        </span>
      </div>
    </div>
  );
}
