import { ShieldCheck, ShieldAlert, AlertTriangle, Zap, BookOpen, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { ScamAnalysis } from '@/store/useNadaStore';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';

interface ResultPanelProps {
  result: ScamAnalysis;
}

export function ResultPanel({ result }: ResultPanelProps) {
  const { language } = useNadaStore();
  const t = translations[language];
  const [showDetails, setShowDetails] = useState(false);

  const verdictConfig = {
    SEGURO:     { icon: ShieldCheck, badge: 'badge-safe',      color: 'var(--success)', label: t.safe,       emoji: '✅' },
    SOSPECHOSO: { icon: AlertTriangle, badge: 'badge-suspicious', color: 'var(--warning)', label: t.suspicious, emoji: '⚠️' },
    PELIGROSO:  { icon: ShieldAlert, badge: 'badge-dangerous',  color: 'var(--danger)',  label: t.dangerous,  emoji: '🚨' },
  };

  const config = verdictConfig[result.verdict];
  const Icon = config.icon;
  const riskColor = result.riskScore >= 70
    ? 'var(--danger)'
    : result.riskScore >= 40
      ? 'var(--warning)'
      : 'var(--success)';

  const cardBg = result.verdict === 'PELIGROSO'
    ? 'var(--dangerous-bg)'
    : result.verdict === 'SOSPECHOSO'
      ? 'var(--suspicious-bg)'
      : 'var(--safe-bg)';

  return (
    <div
      className="card p-3 space-y-2 fade-slide-in rounded-xl border"
      style={{ borderColor: config.color, borderWidth: '1px' }}
    >
      {/* Compact Header */}
      <div
        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
        style={{ background: cardBg }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${config.color} 15%, transparent)`, border: `1px solid ${config.color}` }}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: config.color }} aria-hidden="true" />
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${config.badge}`}>
            {config.label}
          </span>
          <span className="text-[10px] font-mono text-muted">
            Motor: {result.scanSource}
          </span>
        </div>

        {/* Compact score pill */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-sm font-black font-mono leading-none"
            style={{ color: riskColor }}
          >
            {result.riskScore}<span className="text-[9px] font-normal opacity-60">/100</span>
          </span>
        </div>
      </div>

      {/* Mini risk bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${result.riskScore}%`,
            background: result.riskScore >= 70
              ? 'linear-gradient(90deg, var(--warning), var(--danger))'
              : result.riskScore >= 40
                ? 'linear-gradient(90deg, var(--success), var(--warning))'
                : 'var(--success)',
          }}
        />
      </div>

      {/* Concise Explanation */}
      <p className="text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>
        {result.explanation}
      </p>

      {/* Collapsible details toggle */}
      {(result.tactics.length > 0 || result.recommendations.length > 0) && (
        <div className="pt-0.5">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-[10px] font-bold cursor-pointer transition-all hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            <ChevronDown
              className="w-3 h-3 transition-transform duration-200"
              style={{ transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
            {showDetails ? 'Ocultar tácticas y consejos' : 'Ver tácticas y consejos'}
          </button>

          {showDetails && (
            <div className="space-y-2 mt-2 pt-2 border-t border-white/5">
              {/* Tactics */}
              {result.tactics.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Zap className="w-2.5 h-2.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                      {t.tactics}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {result.tactics.map((tactic) => (
                      <span
                        key={tactic}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-light)' }}
                      >
                        {tactic}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {result.recommendations.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <BookOpen className="w-2.5 h-2.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                      {t.recommendations}
                    </p>
                  </div>
                  <ul className="space-y-1">
                    {result.recommendations.map((rec, i) => (
                      <li key={i} className="text-[11px] flex gap-1.5 leading-snug" style={{ color: 'var(--text-secondary)' }}>
                        <span className="shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold mt-0.5" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                          {i + 1}
                        </span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
