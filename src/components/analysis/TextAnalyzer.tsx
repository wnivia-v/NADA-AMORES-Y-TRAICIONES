import { useState, useRef } from 'react';
import { Send, RotateCcw, Clipboard, Loader2 } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { analyzeText, isAnalysisAborted } from '@/services/geminiService';
import { translations } from '@/utils/translations';
import { ResultPanel } from './ResultPanel';

export function TextAnalyzer() {
  const { language, isAnalyzing, analysisResult, setAnalyzing, setAnalysisResult, addLog, resetSession } = useNadaStore();
  const t = translations[language];
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleAnalyze = async () => {
    if (!text.trim() || isAnalyzing) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    addLog(`TEXTO: Analizando ${text.length} caracteres...`, 'system');

    try {
      const result = await analyzeText(text, 'ui');
      setAnalysisResult(result);
      addLog(
        `VEREDICTO: [${result.verdict}] — Riesgo: ${result.riskScore}/100`,
        result.verdict === 'PELIGROSO' ? 'error' : result.verdict === 'SOSPECHOSO' ? 'warning' : 'success',
      );
    } catch (e) {
      if (!isAnalysisAborted(e)) {
        addLog('ERROR: Fallo en el analisis. Este texto NO fue verificado.', 'error');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePaste = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText.trim()) {
        setText(clipText.trim());
        textareaRef.current?.focus();
      }
    } catch {
      addLog('TEXTO: No se pudo leer el portapapeles.', 'warning');
    }
  };

  const handleReset = () => {
    setText('');
    resetSession();
    textareaRef.current?.focus();
  };

  const charCount = text.length;
  const charColor = charCount > 1000 ? 'var(--warning)' : charCount > 2000 ? 'var(--danger)' : 'var(--text-muted)';

  return (
    <div className="space-y-4 fade-slide-in">
      {/* Input card */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Texto a analizar
          </p>
          <button
            onClick={handlePaste}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all hover:scale-105 active:scale-95"
            style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
            title="Pegar del portapapeles"
          >
            <Clipboard className="w-3 h-3" />
            Pegar
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAnalyze();
          }}
          placeholder={t.pasteText || 'Pega aquí el mensaje sospechoso...'}
          rows={6}
          className="w-full bg-transparent resize-none text-sm leading-relaxed border-0 focus:ring-0 focus:outline-none"
          style={{
            color: 'var(--text-primary)',
            caretColor: 'var(--accent)',
          }}
          disabled={isAnalyzing}
          aria-label="Texto para analizar"
        />

        <div
          className="flex items-center justify-between pt-3 mt-2 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono" style={{ color: charColor }}>
              {charCount.toLocaleString()} chars
            </span>
            {!isAnalyzing && text.trim() && (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Ctrl+Enter para analizar
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="p-2.5 rounded-xl border cursor-pointer hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}
              aria-label="Reset"
              title="Limpiar"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              onClick={handleAnalyze}
              disabled={!text.trim() || isAnalyzing}
              className="btn-primary flex items-center gap-2 text-sm py-2.5 px-5"
              aria-label={isAnalyzing ? 'Analizando...' : 'Analizar texto'}
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="w-4 h-4" aria-hidden="true" />
              )}
              {isAnalyzing ? t.analyzing : t.analyzeBtn}
            </button>
          </div>
        </div>
      </div>

      {/* Analyzing skeleton */}
      {isAnalyzing && (
        <div className="card p-5 space-y-3 fade-slide-in">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Analizando con IA...
            </span>
          </div>
          <div className="space-y-2">
            <div className="shimmer h-3 w-full" />
            <div className="shimmer h-3 w-4/5" />
            <div className="shimmer h-3 w-3/5" />
          </div>
        </div>
      )}

      {/* Result */}
      {analysisResult && !isAnalyzing && <ResultPanel result={analysisResult} />}
    </div>
  );
}
