// =============================================================================
// AI Console Panel — Monitor de razonamiento Multi-IA en tiempo real
// Reacciona automáticamente a cualquier análisis (Texto, Voz, Cámara, Imagen)
// =============================================================================

import {
  Brain, ShieldCheck, ShieldAlert, AlertTriangle, Loader2, Clock, Zap,
  Cpu, WifiOff, PowerOff, CheckCircle2, XCircle, HelpCircle,
} from 'lucide-react';
import type { ProviderProgressStatus } from '@/services/aiProviders';
import type { ProviderId } from '@/services/aiProviders';
import { getProviderConfig, saveProviderConfig } from '@/services/aiProviders';
import { useNadaStore } from '@/store/useNadaStore';

// ─── Meta & Config ─────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, { emoji: string; shortName: string; color: string; desc: string }> = {
  local:   { emoji: '💻', shortName: 'Local',    color: '#10B981', desc: 'En dispositivo · Offline' },
  groq:    { emoji: '⚡', shortName: 'Groq',     color: '#6366F1', desc: 'Llama 3.3 70B · Gratis' },
  gemini:  { emoji: '✨', shortName: 'Gemini',   color: '#3B82F6', desc: 'Google Gemini AI' },
  venice:  { emoji: '🛡️', shortName: 'Venice',   color: '#8B5CF6', desc: 'Privacidad · Free Tier' },
  claude:  { emoji: '🤖', shortName: 'Claude',   color: '#F59E0B', desc: 'Anthropic Claude' },
  bedrock: { emoji: '☁️', shortName: 'Bedrock',  color: '#EC4899', desc: 'AWS Bedrock Proxy' },
};

const VERDICT_CONFIG = {
  SEGURO:     { color: '#10B981', bg: 'rgba(16,185,129,0.12)', label: 'NORMAL',          icon: ShieldCheck  },
  SOSPECHOSO: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', label: 'POSIBLE PELIGRO', icon: AlertTriangle },
  PELIGROSO:  { color: '#EF4444', bg: 'rgba(239,68,68,0.12)',  label: 'PELIGROSO',       icon: ShieldAlert  },
};

const MAIN_PROVIDER_IDS: ProviderId[] = ['local', 'groq', 'gemini', 'venice'];

// ─── Status Dot ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ProviderProgressStatus }) {
  if (status === 'thinking') {
    return (
      <span className="flex items-center gap-1 text-[9px] font-bold text-indigo-400">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        Analizando...
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400">
        <CheckCircle2 className="w-2.5 h-2.5" />
        Listo
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[9px] font-bold text-rose-400">
        <XCircle className="w-2.5 h-2.5" />
        Error
      </span>
    );
  }
  if (status === 'no-key') {
    return (
      <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400">
        <WifiOff className="w-2.5 h-2.5" />
        Sin clave
      </span>
    );
  }
  if (status === 'disabled') {
    return (
      <span className="flex items-center gap-1 text-[9px] font-bold text-gray-500">
        <PowerOff className="w-2.5 h-2.5" />
        OFF
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[9px] font-bold text-gray-500">
      <HelpCircle className="w-2.5 h-2.5" />
      En espera
    </span>
  );
}

// ─── Individual AI Provider Column Card ────────────────────────────────────

function AIColumnCard({
  providerId,
  event,
  onToggle,
}: {
  providerId: ProviderId;
  event: any;
  onToggle: (id: ProviderId) => void;
}) {
  const meta = PROVIDER_META[providerId] ?? { emoji: '🤖', shortName: providerId, color: '#6B7280', desc: '' };
  const config = getProviderConfig();
  const isEnabled = config.providers[providerId]?.enabled ?? true;

  const status: ProviderProgressStatus = isEnabled
    ? (event?.status ?? 'pending')
    : 'disabled';

  const verdict = event?.result?.verdict;
  const vConfig = verdict ? VERDICT_CONFIG[verdict as keyof typeof VERDICT_CONFIG] : null;

  return (
    <div
      className="flex flex-col rounded-xl p-2.5 transition-all duration-200"
      style={{
        background: isEnabled ? 'rgba(15, 23, 42, 0.75)' : 'rgba(15, 23, 42, 0.35)',
        border: `1px solid ${status === 'done' && vConfig ? vConfig.color + '50' : isEnabled ? meta.color + '35' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: status === 'done' && vConfig ? `0 0 15px ${vConfig.color}15` : 'none',
        opacity: isEnabled ? 1 : 0.45,
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm shrink-0 leading-none">{meta.emoji}</span>
          <div className="min-w-0">
            <span className="text-xs font-black truncate block" style={{ color: meta.color }}>
              {meta.shortName}
            </span>
            <StatusDot status={status} />
          </div>
        </div>

        {/* ON / OFF Toggle button */}
        <button
          onClick={() => onToggle(providerId)}
          className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black cursor-pointer transition-all hover:scale-105"
          style={{
            background: isEnabled ? `${meta.color}25` : 'rgba(255,255,255,0.08)',
            color: isEnabled ? meta.color : '#9CA3AF',
            border: `1px solid ${isEnabled ? `${meta.color}60` : 'rgba(255,255,255,0.1)'}`,
          }}
          title={isEnabled ? 'Desactivar esta IA' : 'Activar esta IA'}
        >
          {isEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Main Body */}
      <div className="flex-1 flex flex-col gap-1.5 min-h-[150px]">
        {/* Thinking State Skeleton */}
        {status === 'thinking' && (
          <div className="space-y-1.5 py-2 flex-1 justify-center flex flex-col">
            <div className="h-2 rounded animate-pulse" style={{ background: `${meta.color}30`, width: '90%' }} />
            <div className="h-2 rounded animate-pulse" style={{ background: `${meta.color}20`, width: '70%' }} />
            <div className="h-2 rounded animate-pulse" style={{ background: `${meta.color}15`, width: '80%' }} />
          </div>
        )}

        {/* No key state */}
        {status === 'no-key' && (
          <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] text-amber-400 mt-1">
            Configura la API key en <code>.env.local</code>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && !event?.result && (
          <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-[9px] text-rose-400 mt-1">
            {event?.error ?? 'Sin respuesta o timeout'}
          </div>
        )}

        {/* Idle pending */}
        {status === 'pending' && (
          <div className="flex-1 flex items-center justify-center text-[9.5px] text-gray-500 italic text-center p-2">
            Esperando interacción...
          </div>
        )}

        {/* Result returned */}
        {event?.result && vConfig && (
          <>
            {/* Score & Verdict bar */}
            <div
              className="flex items-center justify-between px-2 py-1 rounded-lg"
              style={{ background: vConfig.bg, border: `1px solid ${vConfig.color}40` }}
            >
              <div className="flex items-center gap-1">
                <vConfig.icon className="w-3 h-3 shrink-0" style={{ color: vConfig.color }} />
                <span className="text-[10px] font-black uppercase" style={{ color: vConfig.color }}>
                  {verdict}
                </span>
              </div>
              <span className="text-sm font-black font-mono" style={{ color: vConfig.color }}>
                {event.result.riskScore}<span className="text-[9px] font-normal opacity-60">/100</span>
              </span>
            </div>

            {/* Risk bar */}
            <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${event.result.riskScore}%`,
                  background: vConfig.color,
                }}
              />
            </div>

            {/* Razonamiento / Explicación completa */}
            <div className="flex-1 flex flex-col mt-0.5">
              <span className="text-[8px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">
                🧠 Razonamiento:
              </span>
              <div
                className="p-1.5 rounded bg-black/40 border border-white/5 text-[9.5px] leading-snug text-gray-200 overflow-y-auto max-h-[85px] whitespace-pre-wrap font-sans"
              >
                {event.result.explanation || 'Sin explicación detallada.'}
              </div>
            </div>

            {/* Tactics chips */}
            {event.result.tactics && event.result.tactics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {event.result.tactics.map((t: string) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 rounded text-[8px] font-bold"
                    style={{ background: `${meta.color}20`, color: meta.color, border: `1px solid ${meta.color}30` }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer / Duration */}
      {event?.durationMs !== undefined && event?.durationMs !== null && (
        <div className="flex items-center justify-between pt-1 mt-1 border-t border-white/5 text-[8px] text-gray-400 font-mono">
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {event.durationMs < 1000 ? `${event.durationMs}ms` : `${(event.durationMs / 1000).toFixed(1)}s`}
          </span>
          {verdict && <span style={{ color: vConfig?.color }}>{verdict}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Main AI Console Panel ──────────────────────────────────────────────────

export function AIConsolePanel() {
  const { multiAiEvents, multiAiActiveText, multiAiFinalProviderId, isAnalyzing } = useNadaStore();

  const handleToggleProvider = (id: ProviderId) => {
    const config = getProviderConfig();
    const updated = {
      ...config,
      providers: {
        ...config.providers,
        [id]: { ...config.providers[id], enabled: !config.providers[id]?.enabled },
      },
    };
    saveProviderConfig(updated);
    // Force re-render
    useNadaStore.setState({});
  };

  // Compute summary for top compact bar
  const eventsList = Object.values(multiAiEvents);
  const doneEvents = eventsList.filter((e) => e.status === 'done' && e.result);
  const counts = { SEGURO: 0, SOSPECHOSO: 0, PELIGROSO: 0 };
  for (const e of doneEvents) {
    if (e.result?.verdict) counts[e.result.verdict as keyof typeof counts]++;
  }
  const topVerdict = (Object.entries(counts) as [keyof typeof counts, number][])
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const avgRisk = doneEvents.length > 0
    ? Math.round(doneEvents.reduce((sum, e) => sum + (e.result?.riskScore ?? 0), 0) / doneEvents.length)
    : 0;

  const summaryConfig = topVerdict ? VERDICT_CONFIG[topVerdict as keyof typeof VERDICT_CONFIG] : null;

  return (
    <div className="space-y-2 max-w-full">
      {/* ── 1. ULTRA-COMPACT TOP RISK / SUMMARY BANNER ── */}
      <div
        className="rounded-xl px-3 py-1.5 flex items-center justify-between gap-3 border transition-all duration-300"
        style={{
          background: summaryConfig ? summaryConfig.bg : 'rgba(15, 23, 42, 0.6)',
          borderColor: summaryConfig ? summaryConfig.color + '40' : 'rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: summaryConfig ? summaryConfig.color + '20' : 'rgba(99,102,241,0.2)',
              border: `1px solid ${summaryConfig ? summaryConfig.color + '60' : 'rgba(99,102,241,0.4)'}`,
            }}
          >
            {summaryConfig ? (
              <summaryConfig.icon className="w-3.5 h-3.5" style={{ color: summaryConfig.color }} />
            ) : (
              <Brain className="w-3.5 h-3.5 text-indigo-400" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: summaryConfig?.color ?? '#A5B4FC' }}>
                {summaryConfig ? summaryConfig.label : 'MONITOR EN TIEMPO REAL'}
              </span>
              {summaryConfig && (
                <span className="text-xs font-mono font-black" style={{ color: summaryConfig.color }}>
                  {avgRisk}/100
                </span>
              )}
              {isAnalyzing && (
                <span className="text-[9px] text-indigo-400 font-bold flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Analizando interacción...
                </span>
              )}
            </div>
            <p className="text-[9.5px] text-gray-300 truncate">
              {multiAiActiveText ? (
                <>Texto en análisis: <span className="italic text-gray-200">"{multiAiActiveText.slice(0, 80)}..."</span></>
              ) : doneEvents.length > 0 ? (
                `${doneEvents.length} IAs respondieron. ${topVerdict === 'PELIGROSO' ? '⚠️ Patrón de estafa/extorsión detectado.' : 'Sin patrones de riesgo graves.'}`
              ) : (
                'Analizando interacciones en tiempo real. Realiza un análisis en Texto, Voz, Cámara o Imagen.'
              )}
            </p>
          </div>
        </div>

        {/* Counter badge */}
        <div className="shrink-0 flex items-center gap-2">
          {multiAiFinalProviderId && (
            <span className="hidden sm:inline-block text-[9px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Decisivo: {PROVIDER_META[multiAiFinalProviderId]?.shortName ?? multiAiFinalProviderId}
            </span>
          )}
          <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-black/40 text-gray-300 border border-white/10">
            {doneEvents.length}/4 IAs
          </span>
        </div>
      </div>

      {/* ── 2. 4-COLUMN AI PROVIDER GRID (RAZONAMIENTO EN TIEMPO REAL) ── */}
      <div>
        <div className="flex items-center justify-between mb-1 px-0.5 text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
          <span className="flex items-center gap-1 text-indigo-400">
            <Cpu className="w-3 h-3" /> Razonamiento individual por IA (4 Columnas)
          </span>
          <span>Pulsa ON/OFF para activar/desactivar cualquier IA</span>
        </div>

        {/* 4 COLUMNS GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {MAIN_PROVIDER_IDS.map((id) => (
            <AIColumnCard
              key={id}
              providerId={id}
              event={multiAiEvents[id]}
              onToggle={handleToggleProvider}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
