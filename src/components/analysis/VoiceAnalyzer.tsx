import { useCallback } from 'react';
import { Mic, MicOff, AlertTriangle } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { protectionEngine } from '@/services/protectionEngine';
import { translations } from '@/utils/translations';
import { ResultPanel } from './ResultPanel';

// Thin view: all capture/recognition lifecycle lives in protectionEngine so
// it survives navigating away from this screen. This component only reads
// shared state and asks the engine to start/stop — it does not own
// speechService directly (that used to create a second, out-of-sync copy of
// "listening" alongside ConsumerHome's own toggle).
export function VoiceAnalyzer() {
  const {
    language, analysisResult, shieldStatus,
    voiceTranscript, voiceRealtimeVerdict, voiceSpeechActive, voiceError,
  } = useNadaStore();
  const t = translations[language];
  const listening = shieldStatus.voice.active;

  const handleToggle = useCallback(() => {
    if (listening) {
      protectionEngine.stopVoiceMonitoring();
    } else {
      void protectionEngine.startVoiceMonitoring();
    }
  }, [listening]);

  return (
    <div className="space-y-4 fade-slide-in">
      <div className="card p-6 text-center">
        <button
          onClick={handleToggle}
          className="w-20 h-20 rounded-full mx-auto flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-105"
          style={{
            background: listening ? 'var(--accent-light)' : 'var(--bg-elevated)',
            border: `2px solid ${listening ? 'var(--success)' : 'var(--border)'}`,
            color: listening ? 'var(--success)' : 'var(--text-muted)',
            boxShadow: listening ? (voiceSpeechActive ? '0 0 30px var(--success)' : '0 0 14px var(--accent-glow)') : 'none',
          }}
          aria-label={listening ? t.stopListening : t.startListening}
          aria-pressed={listening}
        >
          {listening ? <MicOff className="w-8 h-8" aria-hidden="true" /> : <Mic className="w-8 h-8" aria-hidden="true" />}
        </button>
        <p className="mt-4 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {listening ? t.stopListening : t.startListening}
        </p>

        {/* Mic error — set by protectionEngine when the recognizer actually
            dies (permission denied, no mic, unsupported browser), instead of
            the UI silently claiming "listening" for a dead session. */}
        {voiceError && !listening && (
          <div
            className="mt-3 p-3 rounded-lg text-sm font-medium"
            style={{ background: 'rgba(255,70,70,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
          >
            {voiceError}
          </div>
        )}

        {/* Real-time status indicator — the pulse only lights up on actual
            detected speech (Web Speech API onspeechstart/onspeechend), so it
            is real proof of listening instead of an assumption. */}
        {listening && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: voiceSpeechActive ? 'var(--success)' : 'var(--text-muted)', animation: voiceSpeechActive ? 'pulse 1s infinite' : undefined }}
            />
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {voiceSpeechActive ? t.voiceHearingYou : t.liveAnalysis}
            </span>
          </div>
        )}

        {/* Real-time verdict badge */}
        {listening && voiceRealtimeVerdict && voiceRealtimeVerdict.verdict !== 'SEGURO' && (
          <div
            className="mt-3 p-3 rounded-lg flex items-center gap-2"
            style={{
              background: voiceRealtimeVerdict.verdict === 'PELIGROSO' ? 'rgba(255,70,70,0.1)' : 'rgba(255,170,0,0.1)',
              border: `1px solid ${voiceRealtimeVerdict.verdict === 'PELIGROSO' ? 'var(--danger)' : 'var(--warning)'}`,
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: voiceRealtimeVerdict.verdict === 'PELIGROSO' ? 'var(--danger)' : 'var(--warning)' }} />
            <div className="text-left">
              <p className="text-[10px] font-bold" style={{ color: voiceRealtimeVerdict.verdict === 'PELIGROSO' ? 'var(--danger)' : 'var(--warning)' }}>
                {voiceRealtimeVerdict.verdict} — {voiceRealtimeVerdict.riskScore}/100
              </p>
              <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                {voiceRealtimeVerdict.tactics[0] ?? t.suspiciousPattern}
              </p>
            </div>
          </div>
        )}

        {voiceTranscript && (
          <div className="mt-4 p-3 rounded-lg text-left text-sm max-h-32 overflow-y-auto" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
            <p className="text-xs font-mono mb-1" style={{ color: 'var(--text-muted)' }}>
              {t.transcript}
            </p>
            {voiceTranscript}
          </div>
        )}
      </div>

      {analysisResult && <ResultPanel result={analysisResult} />}
    </div>
  );
}
