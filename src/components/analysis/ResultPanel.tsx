import { ShieldCheck, ShieldAlert, AlertTriangle, Zap, BookOpen, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { ScamAnalysis } from '@/store/useNadaStore';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';
import { FeedbackPrompt } from './FeedbackPrompt';

interface ResultPanelProps {
  result: ScamAnalysis;
}

export function ResultPanel({ result }: ResultPanelProps) {
  const { language } = useNadaStore();
  const t = translations[language];
  const [showDetails, setShowDetails] = useState(true);

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

  // Background tint based on verdict
  const cardBg = result.verdict === 'PELIGROSO'
    ? 'var(--dangerous-bg)'
    : result.verdict === 'SOSPECHOSO'
      ? 'var(--suspicious-bg)'
      : 'var(--safe-bg)';

  return (
    <div
      className="card p-5 space-y-4 fade-slide-in"
      style={{ borderColor: config.color, borderWidth: '1.5px' }}
    >
      {/* Verdict header */}
      <div
        className="flex items-center justify-between p-3 rounded-xl"
        style={{ background: cardBg }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${config.color} 15%, transparent)`, border: `1.5px solid ${config.color}` }}
          >
            <Icon className="w-5 h-5" style={{ color: config.color }} aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              {t.riskScore}
            </p>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-black ${config.badge}`}>
              {config.label}
            </span>
          </div>
        </div>

        {/* Risk score gauge */}
        <div className="text-right">
          <p
            className="text-3xl font-black font-mono leading-none"
            style={{ color: riskColor, textShadow: `0 0 20px color-mix(in srgb, ${riskColor} 50%, transparent)` }}
          >
            {result.riskScore}
          </p>
          <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>/100</p>
        </div>
      </div>

      {/* Risk bar */}
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${result.riskScore}%`,
            background: result.riskScore >= 70
              ? 'linear-gradient(90deg, var(--warning), var(--danger))'
              : result.riskScore >= 40
                ? 'linear-gradient(90deg, var(--success), var(--warning))'
                : 'var(--success)',
            boxShadow: `0 0 8px ${riskColor}`,
          }}
        />
      </div>

      {/* Explanation */}
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {result.explanation}
      </p>

      {/* Collapsible details */}
      {(result.tactics.length > 0 || result.recommendations.length > 0) && (
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer mb-3 transition-all hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            <ChevronDown
              className="w-3.5 h-3.5 transition-transform duration-200"
              style={{ transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
            {showDetails ? 'Ocultar detalles' : 'Ver detalles'}
          </button>

          {showDetails && (
            <div className="space-y-3">
              {/* Tactics */}
              {result.tactics.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Zap className="w-3 h-3" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                    <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {t.tactics}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.tactics.map((tactic) => (
                      <span
                        key={tactic}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
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
                  <div className="flex items-center gap-1.5 mb-2">
                    <BookOpen className="w-3 h-3" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                    <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {t.recommendations}
                    </p>
                  </div>
                  <ul className="space-y-1.5">
                    {result.recommendations.map((rec, i) => (
                      <li key={i} className="text-xs flex gap-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        <span className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
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

      {/* ¿Acerto? — la unica via por la que un error del sistema puede llegar
          a arreglarse. Se calla sola cuando no hay nada que juzgar. */}
      <FeedbackPrompt result={result} />

      {/* Source badge */}
      <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <span
          className="text-[10px] font-mono px-2.5 py-1 rounded-lg"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
        >
          Motor: {result.scanSource}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {new Date().toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
