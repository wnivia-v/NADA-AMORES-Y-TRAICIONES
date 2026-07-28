import { useState } from 'react';
import { Send, RotateCcw } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { analyzeText, isAnalysisAborted } from '@/services/geminiService';
import { translations } from '@/utils/translations';
import { ResultPanel } from './ResultPanel';

export function TextAnalyzer() {
  const { language, isAnalyzing, analysisResult, setAnalyzing, setAnalysisResult, addLog, resetSession } = useNadaStore();
  const t = translations[language];
  const [text, setText] = useState('');

  const handleAnalyze = async () => {
    if (!text.trim() || isAnalyzing) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    addLog(`TEXTO: Analizando ${text.length} caracteres...`, 'system');

    try {
      const result = await analyzeText(text, 'ui');
      setAnalysisResult(result);
      addLog(`VEREDICTO: [${result.verdict}] — Riesgo: ${result.riskScore}/100`, result.verdict === 'PELIGROSO' ? 'error' : result.verdict === 'SOSPECHOSO' ? 'warning' : 'success');
    } catch (e) {
      // Superseded by a newer request: discard silently, keep the spinner off.
      if (!isAnalysisAborted(e)) {
        addLog('ERROR: Fallo en el analisis. Este texto NO fue verificado.', 'error');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4 fade-slide-in">
      <div className="card p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.pasteText}
          className="w-full h-40 bg-transparent resize-none outline-none text-sm leading-relaxed"
          style={{ color: 'var(--text-primary)' }}
          disabled={isAnalyzing}
        />
        <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            {text.length} chars
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => { setText(''); resetSession(); }}
              className="p-2 rounded-lg border cursor-pointer hover:scale-105 transition-transform min-w-[44px] min-h-[44px] flex items-center justify-center"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              aria-label="Reset"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={handleAnalyze}
              disabled={!text.trim() || isAnalyzing}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {isAnalyzing ? t.analyzing : t.analyzeBtn}
            </button>
          </div>
        </div>
      </div>

      {analysisResult && <ResultPanel result={analysisResult} />}
    </div>
  );
}
