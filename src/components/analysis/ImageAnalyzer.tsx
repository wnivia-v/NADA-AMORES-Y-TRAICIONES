import { useState, useRef } from 'react';
import { Upload, Image, X, Send } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { extractTextFromImage } from '@/services/ocrService';
import { analyzeText, isAnalysisAborted } from '@/services/geminiService';
import { ResultPanel } from './ResultPanel';

export function ImageAnalyzer() {
  const { language, isAnalyzing, analysisResult, setAnalyzing, setAnalysisResult, addLog } = useNadaStore();
  const [preview, setPreview] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [ocrProgress, setOcrProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      addLog('IMAGEN: Archivo no es una imagen.', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreview(dataUrl);
      setExtractedText('');
      setAnalysisResult(null);
      addLog(`IMAGEN: Cargada (${(file.size / 1024).toFixed(0)} KB)`, 'info');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPreview(ev.target?.result as string);
        setExtractedText('');
        setAnalysisResult(null);
        addLog(`IMAGEN: Drop cargado (${(file.size / 1024).toFixed(0)} KB)`, 'info');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!preview || isAnalyzing) return;
    setAnalyzing(true);
    setOcrProgress(language === 'es' ? 'Extrayendo texto con OCR...' : 'Extracting text with OCR...');
    addLog('IMAGEN: Iniciando OCR...', 'system');

    try {
      // Step 1: OCR
      const text = await extractTextFromImage(preview);
      setExtractedText(text);

      if (!text || text.length < 10) {
        addLog('IMAGEN: Poco o ningun texto detectado.', 'warning');
        setOcrProgress(language === 'es' ? 'No se detecto texto suficiente.' : 'Not enough text detected.');
        setAnalyzing(false);
        return;
      }

      addLog(`IMAGEN: OCR extrajo ${text.length} caracteres. Analizando...`, 'info');
      setOcrProgress(language === 'es' ? 'Analizando contenido...' : 'Analyzing content...');

      // Step 2: AI Analysis
      const result = await analyzeText(text, 'ui');
      setAnalysisResult(result);
      addLog(`IMAGEN: Veredicto [${result.verdict}] — Riesgo: ${result.riskScore}/100`, result.verdict === 'PELIGROSO' ? 'error' : result.verdict === 'SOSPECHOSO' ? 'warning' : 'success');
      setOcrProgress('');
    } catch (e) {
      setOcrProgress('');
      if (!isAnalysisAborted(e)) {
        addLog('IMAGEN: El analisis fallo. Esta imagen NO fue verificada.', 'error');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleClear = () => {
    setPreview(null);
    setExtractedText('');
    setOcrProgress('');
    setAnalysisResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4 fade-slide-in">
      <div className="card p-4">
        {/* Upload area */}
        {!preview ? (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]"
            style={{ borderColor: 'var(--border)' }}
          >
            <Upload className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {language === 'es' ? 'Sube una captura de pantalla' : 'Upload a screenshot'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {language === 'es' ? 'Arrastra o haz clic — WhatsApp, Telegram, SMS, email' : 'Drag or click — WhatsApp, Telegram, SMS, email'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Preview */}
            <div className="relative rounded-lg overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
              <img src={preview} alt="Preview" className="w-full max-h-64 object-contain" />
              <button
                onClick={handleClear}
                className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              >
                <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {/* OCR progress */}
            {ocrProgress && (
              <p className="text-xs font-mono text-center animate-pulse" style={{ color: 'var(--accent)' }}>
                {ocrProgress}
              </p>
            )}

            {/* Extracted text preview */}
            {extractedText && (
              <div className="p-3 rounded-lg max-h-24 overflow-y-auto" style={{ background: 'var(--bg-elevated)' }}>
                <p className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>
                  {language === 'es' ? 'Texto extraido:' : 'Extracted text:'}
                </p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {extractedText.slice(0, 300)}{extractedText.length > 300 ? '...' : ''}
                </p>
              </div>
            )}

            {/* Analyze button */}
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {isAnalyzing ? (
                <Image className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {isAnalyzing ? (language === 'es' ? 'Analizando...' : 'Analyzing...') : (language === 'es' ? 'Analizar imagen' : 'Analyze image')}
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {analysisResult && <ResultPanel result={analysisResult} />}
    </div>
  );
}
