import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { speechService } from '@/services/speechService';
import { analyzeVoiceFragment, cancelAnalysis, isAnalysisAborted } from '@/services/geminiService';
import { translations } from '@/utils/translations';
import { ResultPanel } from './ResultPanel';
import type { ScamAnalysis } from '@/store/useNadaStore';

const REALTIME_INTERVAL_MS = 15000; // Analyze every 15 seconds

export function VoiceAnalyzer() {
  const { language, analysisResult, setAnalyzing, setAnalysisResult, addLog } = useNadaStore();
  const t = translations[language];
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [realtimeVerdict, setRealtimeVerdict] = useState<ScamAnalysis | null>(null);
  const [fragmentCount, setFragmentCount] = useState(0);

  // Refs for real-time analysis
  const transcriptRef = useRef('');
  const lastAnalyzedRef = useRef('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep transcript ref in sync
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // Real-time analysis loop
  const startRealtimeAnalysis = useCallback(() => {
    intervalRef.current = setInterval(async () => {
      const currentText = transcriptRef.current;
      // Only analyze if there's new content since last check
      if (currentText.length > 20 && currentText !== lastAnalyzedRef.current) {
        lastAnalyzedRef.current = currentText;
        setFragmentCount((c) => c + 1);

        try {
          // Analyze the latest portion (last ~200 chars for speed)
          const fragment = currentText.length > 200
            ? currentText.slice(-200)
            : currentText;

          const result = await analyzeVoiceFragment(fragment, 'voice');
          setRealtimeVerdict(result);

          if (result.verdict !== 'SEGURO') {
            addLog(`VOZ LIVE [${result.verdict}]: ${result.riskScore}/100 — ${result.tactics[0] ?? 'patron detectado'}`, result.verdict === 'PELIGROSO' ? 'error' : 'warning');
          }
        } catch (e) {
          // A superseded fragment is normal here; a real failure means this
          // stretch of the call went unchecked and the user should know.
          if (!isAnalysisAborted(e)) {
            addLog('VOZ: Un fragmento no pudo analizarse.', 'warning');
          }
        }
      }
    }, REALTIME_INTERVAL_MS);
  }, [addLog]);

  const stopRealtimeAnalysis = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRealtimeAnalysis();
      speechService.stop();
      cancelAnalysis('voice');
    };
  }, [stopRealtimeAnalysis]);

  const handleToggle = useCallback(() => {
    if (listening) {
      speechService.stop();
      stopRealtimeAnalysis();
      setListening(false);
      addLog('VOZ: Escucha detenida.', 'info');

      // Final analysis of accumulated transcript
      const finalTranscript = transcriptRef.current;
      if (finalTranscript.length > 20) {
        setAnalyzing(true);
        analyzeVoiceFragment(finalTranscript, 'voice')
          .then((result) => {
            setAnalysisResult(result);
            addLog(`VEREDICTO VOZ FINAL: [${result.verdict}] — ${result.riskScore}/100`, result.verdict === 'PELIGROSO' ? 'error' : 'success');
          })
          .catch((e) => {
            if (!isAnalysisAborted(e)) {
              addLog('VOZ: El analisis final fallo. La conversacion NO fue verificada.', 'error');
            }
          })
          .finally(() => setAnalyzing(false));
      }
    } else {
      setTranscript('');
      setMicError(null);
      setAnalysisResult(null);
      setRealtimeVerdict(null);
      setFragmentCount(0);
      lastAnalyzedRef.current = '';
      addLog('VOZ: Iniciando escucha con analisis en tiempo real...', 'system');

      speechService.start(
        (text, isFinal) => {
          // Show interim results too so users see it's working
          if (isFinal) {
            setTranscript((prev) => prev + ' ' + text);
          } else {
            // Update ref with interim so real-time loop can use it
            transcriptRef.current = transcriptRef.current + ' ' + text;
          }
        },
        language === 'es' ? 'es-ES' : 'en-US',
        (error) => {
          let msg = 'Error de microfono.';
          if (error === 'not-allowed') msg = '❌ Permiso de microfono denegado. Habilita el microfono en el navegador.';
          else if (error === 'no-microphone') msg = '❌ No se encontro microfono. Conecta uno e intenta de nuevo.';
          else if (error === 'not-supported') msg = '❌ Este navegador no soporta reconocimiento de voz. Usa Chrome.';
          else if (error === 'network') msg = '⚠️ Error de red en reconocimiento de voz. Verifica tu conexion.';
          setMicError(msg);
          setListening(false);
          stopRealtimeAnalysis();
          addLog(`VOZ ERROR: ${msg}`, 'error');
        }
      );

      setListening(true);
      startRealtimeAnalysis();
    }
  }, [listening, language, addLog, setAnalyzing, setAnalysisResult, startRealtimeAnalysis, stopRealtimeAnalysis]);

  return (
    <div className="space-y-4 fade-slide-in">
      <div className="card p-6 text-center">
        <button
          onClick={handleToggle}
          className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center cursor-pointer transition-all duration-300 ${
            listening ? 'animate-pulse' : 'hover:scale-105'
          }`}
          style={{
            background: listening ? 'var(--danger)' : 'var(--accent)',
            color: 'var(--bg-primary)',
            boxShadow: listening ? '0 0 30px var(--danger)' : '0 0 20px var(--accent-glow)',
          }}
          aria-label={listening ? t.stopListening : t.startListening}
          aria-pressed={listening}
        >
          {listening ? <MicOff className="w-8 h-8" aria-hidden="true" /> : <Mic className="w-8 h-8" aria-hidden="true" />}
        </button>
        <p className="mt-4 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {listening ? t.stopListening : t.startListening}
        </p>

        {/* Mic error message */}
        {micError && !listening && (
          <div
            className="mt-3 p-3 rounded-lg text-sm font-medium"
            style={{ background: 'rgba(255,70,70,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
          >
            {micError}
          </div>
        )}

        {/* Real-time status indicator */}
        {listening && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--success)' }} />
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {`${t.liveAnalysis} — ${fragmentCount} ${t.fragments}`}
            </span>
          </div>
        )}

        {/* Real-time verdict badge */}
        {listening && realtimeVerdict && realtimeVerdict.verdict !== 'SEGURO' && (
          <div
            className="mt-3 p-3 rounded-lg flex items-center gap-2"
            style={{
              background: realtimeVerdict.verdict === 'PELIGROSO' ? 'rgba(255,70,70,0.1)' : 'rgba(255,170,0,0.1)',
              border: `1px solid ${realtimeVerdict.verdict === 'PELIGROSO' ? 'var(--danger)' : 'var(--warning)'}`,
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: realtimeVerdict.verdict === 'PELIGROSO' ? 'var(--danger)' : 'var(--warning)' }} />
            <div className="text-left">
              <p className="text-[10px] font-bold" style={{ color: realtimeVerdict.verdict === 'PELIGROSO' ? 'var(--danger)' : 'var(--warning)' }}>
                {realtimeVerdict.verdict} — {realtimeVerdict.riskScore}/100
              </p>
              <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                {realtimeVerdict.tactics[0] ?? t.suspiciousPattern}
              </p>
            </div>
          </div>
        )}

        {transcript && (
          <div className="mt-4 p-3 rounded-lg text-left text-sm max-h-32 overflow-y-auto" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
            <p className="text-xs font-mono mb-1" style={{ color: 'var(--text-muted)' }}>
              {t.transcript}
            </p>
            {transcript}
          </div>
        )}
      </div>

      {analysisResult && <ResultPanel result={analysisResult} />}
    </div>
  );
}
