import { useState, useCallback } from 'react';
import { ShieldCheck, ShieldOff, Clipboard, Monitor, Mic, AlertTriangle, ImageIcon, MicOff } from 'lucide-react';
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
};

export function ConsumerHome() {
  const {
    language, isProtectionActive, setProtectionActive,
    shieldStatus, threatsToday, historyCount, setActiveTab,
    addLog, setAnalysisResult,
  } = useNadaStore();
  const t = translations[language];

  // Quick voice from home screen
  const [listening, setListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  const toggleVoice = useCallback(() => {
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

  // True when some enabled provider is reachable AND still has quota left.
  // A provider whose free tier is exhausted is not "available" in any sense the
  // user cares about.
  const anyProviderAvailable = hasWorkingProvider();

  return (
    <div className="space-y-6 fade-slide-in">
      {/* Degraded mode banner */}
      {!anyProviderAvailable && (
        <div
          className="card p-3 flex items-center gap-3"
          style={{ borderColor: 'var(--warning)' }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--warning)' }} />
          <div>
            <p className="text-xs font-bold" style={{ color: 'var(--warning)' }}>
              {t.localMode}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {t.localModeDesc}
            </p>
          </div>
        </div>
      )}

      {/* Main protection toggle */}
      <div className="card p-8 text-center">
        <div className="relative inline-block mb-4">
          <div
            className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto transition-all duration-500 ${
              isProtectionActive ? 'pulse-ring' : ''
            }`}
            style={{
              background: isProtectionActive ? 'var(--accent-light)' : 'var(--bg-elevated)',
              boxShadow: isProtectionActive ? `0 0 40px var(--accent-glow)` : 'none',
            }}
          >
            {isProtectionActive ? (
              <ShieldCheck className="w-12 h-12" style={{ color: 'var(--accent)' }} />
            ) : (
              <ShieldOff className="w-12 h-12" style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
        </div>

        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          {isProtectionActive ? t.protectionOn : t.protectionOff}
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          {t.homeSubtitle}
        </p>

        <button
          onClick={() => setProtectionActive(!isProtectionActive)}
          className={`px-6 py-3 rounded-xl font-bold text-sm cursor-pointer transition-all hover:scale-105 ${
            isProtectionActive ? '' : 'btn-primary'
          }`}
          style={isProtectionActive ? { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' } : undefined}
        >
          {isProtectionActive ? t.deactivateProtection : t.activateProtection}
        </button>
      </div>

      {/* Quick action: analyze screenshot */}
      <button
        onClick={() => setActiveTab('debug')}
        className="card p-4 w-full flex items-center gap-3 cursor-pointer transition-all hover:scale-[1.02]"
        style={{ borderColor: 'var(--accent)' }}
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-light)' }}>
          <ImageIcon className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        </div>
        <div className="text-left">
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {t.analyzeScreenshot}
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {t.analyzeScreenshotDesc}
          </p>
        </div>
      </button>

      {/* Shield status cards */}
      <div>
        <h3 className="text-sm font-bold mb-3 px-1" style={{ color: 'var(--text-muted)' }}>
          {t.shields}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {(['clipboard', 'screen', 'voice'] as ShieldId[]).map((id) => {
            const Icon = shieldIcons[id];
            const status = shieldStatus[id];
            const label = t[id];

            // Voice card is interactive — lets you activate listening from home
            if (id === 'voice') {
              return (
                <button
                  key={id}
                  onClick={toggleVoice}
                  className="card p-4 text-center cursor-pointer"
                  style={{ borderColor: listening ? 'var(--danger)' : status.active ? 'var(--accent)' : 'var(--border)' }}
                  aria-label={listening ? t.stopListening : t.tapToListen}
                >
                  {listening
                    ? <MicOff className="w-5 h-5 mx-auto mb-2 animate-pulse" style={{ color: 'var(--danger)' }} />
                    : <Mic className="w-5 h-5 mx-auto mb-2" style={{ color: status.active ? 'var(--accent)' : 'var(--text-muted)' }} />
                  }
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
                  <p className="text-[10px] mt-1" style={{ color: listening ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {listening ? t.stopListening : t.tapToListen}
                  </p>
                </button>
              );
            }

            // Screen card shows a helpful message about needing the desktop app
            if (id === 'screen') {
              const isElectron = typeof (window as any).electronAPI !== 'undefined';
              return (
                <div
                  key={id}
                  className="card p-4 text-center"
                  style={{ borderColor: status.active ? 'var(--accent)' : 'var(--border)' }}
                >
                  <Icon className="w-5 h-5 mx-auto mb-2" style={{ color: status.active ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
                  <p className="text-[10px] mt-1" style={{ color: status.active ? 'var(--success)' : 'var(--text-muted)' }}>
                    {status.active ? (status.scanning ? t.scanning : t.active) : (isElectron ? t.inactive : '⬇ .exe')}
                  </p>
                </div>
              );
            }

            // Clipboard card (default)
            return (
              <div
                key={id}
                className="card p-4 text-center"
                style={{ borderColor: status.active ? 'var(--accent)' : 'var(--border)' }}
              >
                <Icon className="w-5 h-5 mx-auto mb-2" style={{ color: status.active ? 'var(--accent)' : 'var(--text-muted)' }} />
                <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
                <p className="text-[10px] mt-1" style={{ color: status.active ? 'var(--success)' : 'var(--text-muted)' }}>
                  {status.active ? (status.scanning ? t.scanning : t.active) : t.inactive}
                </p>
              </div>
            );
          })}
        </div>

        {/* Voice transcript preview */}
        {listening && voiceTranscript && (
          <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {voiceTranscript.slice(-120)}
          </div>
        )}

        {/* Screen shield explanation in web mode */}
        {!((window as any).electronAPI) && (
          <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
            {t.screenNeedsDesktop}
          </p>
        )}
      </div>

      {/* Threat trend chart */}
      <ThreatChart />

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold font-mono" style={{ color: 'var(--accent)' }}>{historyCount}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t.totalScans}
          </p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold font-mono" style={{ color: threatsToday > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {threatsToday}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t.threatsToday}
          </p>
        </div>
      </div>
    </div>
  );
}
