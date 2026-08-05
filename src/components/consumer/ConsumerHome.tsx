import { useState, useCallback } from 'react';
import {
  ShieldCheck, ShieldOff, Clipboard, Monitor, Mic, AlertTriangle,
  Scan, MicOff, TrendingUp, TrendingDown, Activity, Camera,
} from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { hasWorkingProvider } from '@/services/aiProviders';
import { speechService } from '@/services/speechService';
import { analyzeVoiceFragment, isAnalysisAborted } from '@/services/geminiService';
import { translations } from '@/utils/translations';
import { ThreatChart } from '@/components/ui/ThreatChart';
import type { ShieldId } from '@/store/useNadaStore';

const shieldIcons: Record<ShieldId, typeof Clipboard> = {
  clipboard: Clipboard,
  screen: Monitor,
  voice: Mic,
  video: Camera,
};

export function ConsumerHome() {
  const {
    language, isProtectionActive, setProtectionActive,
    shieldStatus, threatsToday, historyCount, setActiveTab, setActiveMode,
    addLog, setAnalysisResult,
  } = useNadaStore();
  const t = translations[language];

  const [listening, setListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  const toggleVoice = useCallback(() => {
    if (!speechService.isSupported()) {
      addLog('VOZ: Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.', 'error');
      return;
    }

    if (listening) {
      speechService.stop();
      setListening(false);
      addLog('VOZ: Escucha detenida desde Inicio.', 'info');
      if (voiceTranscript.length > 20) {
        analyzeVoiceFragment(voiceTranscript, 'voice')
          .then((result) => setAnalysisResult(result))
          .catch((e) => { if (!isAnalysisAborted(e)) addLog('VOZ: Fallo al analizar.', 'error'); });
      }
      setVoiceTranscript('');
    } else {
      setVoiceTranscript('');
      addLog('VOZ: Escucha iniciada desde Inicio.', 'system');
      speechService.start((text, isFinal) => {
        if (isFinal) setVoiceTranscript((prev) => prev + ' ' + text);
      }, language === 'es' ? 'es-ES' : 'en-US');
      setListening(true);
    }
  }, [listening, voiceTranscript, language, addLog, setAnalysisResult]);

  const anyProviderAvailable = hasWorkingProvider();
  const activeShields = Object.values(shieldStatus).filter((s) => s.active).length;

  return (
    <div className="space-y-5 fade-slide-in pb-4">

      {/* Degraded mode banner */}
      {!anyProviderAvailable && (
        <div className="card p-3.5 flex items-center gap-3" style={{ borderColor: 'var(--warning)' }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(245,158,11,0.12)' }}>
            <AlertTriangle className="w-4 h-4" style={{ color: 'var(--warning)' }} />
          </div>
          <div>
            <p className="text-xs font-bold" style={{ color: 'var(--warning)' }}>{t.localMode}</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.localModeDesc}</p>
          </div>
        </div>
      )}

      {/* ── HERO: Protection toggle ────────────────────────────────────────── */}
      <div
        className="card p-6 text-center relative overflow-hidden"
        style={{
          borderColor: isProtectionActive ? 'var(--accent)' : 'var(--border)',
          background: isProtectionActive
            ? 'linear-gradient(145deg, var(--bg-card) 0%, var(--accent-light) 100%)'
            : 'var(--gradient-card)',
        }}
      >
        {/* Decorative glow blob */}
        {isProtectionActive && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 60% 50% at 50% 20%, var(--accent-light) 0%, transparent 70%)',
            }}
          />
        )}

        {/* Shield icon */}
        <div className="relative inline-block mb-4">
          <div
            className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto transition-all duration-500 ${isProtectionActive ? 'pulse-ring' : ''}`}
            style={{
              background: isProtectionActive
                ? 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)'
                : 'var(--bg-elevated)',
              boxShadow: isProtectionActive ? `0 0 48px var(--accent-glow)` : 'none',
            }}
          >
            {isProtectionActive ? (
              <ShieldCheck className="w-12 h-12 text-white" />
            ) : (
              <ShieldOff className="w-12 h-12" style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
        </div>

        <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
          {isProtectionActive ? t.protectionOn : t.protectionOff}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
          {t.homeSubtitle}
        </p>

        <button
          onClick={() => setProtectionActive(!isProtectionActive)}
          className={`px-6 py-3 rounded-xl font-bold text-sm cursor-pointer transition-all hover:scale-105 active:scale-95 ${
            isProtectionActive ? '' : 'btn-primary'
          }`}
          style={
            isProtectionActive
              ? { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
              : undefined
          }
        >
          {isProtectionActive ? t.deactivateProtection : t.activateProtection}
        </button>

        {/* Active shields count */}
        {isProtectionActive && (
          <p className="text-[10px] mt-3 font-mono" style={{ color: 'var(--accent)' }}>
            {activeShields} escudo{activeShields !== 1 ? 's' : ''} activo{activeShields !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* ── Quick action: open analyzer ─────────────────────────────────────── */}
      <button
        onClick={() => setActiveTab('debug')}
        className="card p-4 w-full flex items-center gap-4 cursor-pointer text-left transition-all hover:scale-[1.01]"
        style={{ borderColor: 'var(--accent)', borderWidth: '1.5px' }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--gradient-hero)', boxShadow: '0 4px 12px var(--accent-glow)' }}
        >
          <Scan className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {t.analyzeScreenshot}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {t.analyzeScreenshotDesc}
          </p>
        </div>
        <div
          className="px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          Analizar
        </div>
      </button>

      {/* ── Shields grid ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            {t.shields}
          </h3>
          <Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
        </div>

        <div className="grid grid-cols-4 gap-2">
          {(['clipboard', 'screen', 'voice', 'video'] as ShieldId[]).map((id) => {
            const Icon = shieldIcons[id];
            const status = shieldStatus[id];
            const label = t[id];
            const isVoice = id === 'voice';
            const isActive = isVoice ? listening : status.active;
            const isScanning = status.scanning;

            // Video card navigates to the camera analyzer — it needs an
            // explicit screen/camera share prompt, so it can't run silently
            // in the background like clipboard/screen.
            if (id === 'video') {
              return (
                <button
                  key={id}
                  onClick={() => { setActiveMode('CAMARA'); setActiveTab('debug'); }}
                  className="card p-3 text-center cursor-pointer"
                  style={{ borderColor: status.active ? 'var(--accent)' : 'var(--border)' }}
                  aria-label={label}
                >
                  <Icon className="w-5 h-5 mx-auto mb-2" style={{ color: status.active ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
                  <p className="text-[10px] mt-1" style={{ color: status.active ? 'var(--success)' : 'var(--text-muted)' }}>
                    {status.active ? (status.scanning ? t.scanning : t.active) : t.tapToListen}
                  </p>
                </button>
              );
            }

            const cardContent = (
              <>
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-2.5 transition-all"
                  style={{
                    background: isActive
                      ? 'var(--accent-light)'
                      : 'var(--bg-elevated)',
                    boxShadow: isActive ? '0 0 12px var(--accent-glow)' : 'none',
                  }}
                >
                  {isVoice && listening
                    ? <MicOff className="w-4 h-4 animate-pulse" style={{ color: 'var(--danger)' }} />
                    : <Icon className="w-4 h-4" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
                  }
                </div>
                <p className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{label}</p>
                <p
                  className="text-[10px] mt-0.5"
                  style={{
                    color: isVoice
                      ? (listening ? 'var(--danger)' : 'var(--text-muted)')
                      : (isActive ? 'var(--success)' : 'var(--text-muted)'),
                  }}
                >
                  {isVoice
                    ? (listening ? t.stopListening : t.tapToListen)
                    : (isActive ? (isScanning ? t.scanning : t.active) : t.inactive)
                  }
                </p>
              </>
            );

            if (isVoice) {
              return (
                <button
                  key={id}
                  onClick={toggleVoice}
                  className="card p-3 text-center cursor-pointer"
                  style={{ borderColor: listening ? 'var(--danger)' : isActive ? 'var(--accent)' : 'var(--border)' }}
                  aria-label={listening ? t.stopListening : t.tapToListen}
                >
                  {cardContent}
                </button>
              );
            }

            return (
              <div
                key={id}
                className="card p-3 text-center"
                style={{ borderColor: isActive ? 'var(--accent)' : 'var(--border)' }}
              >
                {cardContent}
              </div>
            );
          })}
        </div>

        {/* Voice transcript preview */}
        {listening && voiceTranscript && (
          <div
            className="mt-3 p-3 rounded-xl text-xs leading-relaxed fade-slide-in"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderLeft: '2px solid var(--accent)' }}
          >
            {voiceTranscript.slice(-150)}
          </div>
        )}
      </div>

      {/* ── Threat chart ────────────────────────────────────────────────────── */}
      <ThreatChart />

      {/* ── Quick stats ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          </div>
          <p className="text-2xl font-black font-mono" style={{ color: 'var(--accent)' }}>
            {historyCount.toLocaleString()}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {t.totalScans}
          </p>
        </div>
        <div className="card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            {threatsToday > 0
              ? <TrendingUp className="w-3.5 h-3.5" style={{ color: 'var(--danger)' }} />
              : <TrendingDown className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
            }
          </div>
          <p
            className="text-2xl font-black font-mono"
            style={{ color: threatsToday > 0 ? 'var(--danger)' : 'var(--success)' }}
          >
            {threatsToday}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {t.threatsToday}
          </p>
        </div>
      </div>
    </div>
  );
}
