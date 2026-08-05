import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, CameraOff, ScreenShare, AlertTriangle } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { visionService } from '@/services/visionService';
import { riskScorer } from '@/utils/riskScorer';
import { playAlertTone } from '@/utils/audioAlert';
import { notificationService } from '@/services/notificationService';
import { translations } from '@/utils/translations';
import type { ScamAnalysis } from '@/store/useNadaStore';

type CameraSource = 'own' | 'call';

// Deepfake alerts are re-evaluated every animation frame; without a cooldown
// a single ongoing deepfake would spam the alert log dozens of times a second.
const ALERT_COOLDOWN_MS = 20_000;

export function CameraAnalyzer() {
  const { language, addLog, addAlert, setAnalysisResult, updateShieldStatus } = useNadaStore();
  const t = translations[language];
  const [active, setActive] = useState(false);
  const [source, setSource] = useState<CameraSource>('call');
  const [status, setStatus] = useState('');
  const [deepfakeScore, setDeepfakeScore] = useState(0);
  const [lipSyncMeasured, setLipSyncMeasured] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastAlertAtRef = useRef(0);
  const hasResultRef = useRef(false); // true once the first frame has been analyzed
  const sourceRef = useRef<CameraSource>(source);
  const tRef = useRef(t);

  // Keep refs in sync with the latest rendered values so stable callbacks
  // (triggerDeepfakeAlert) always read the current source/language.
  sourceRef.current = source;
  tRef.current = t;

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setActive(false);
    setStatus('');
    setDeepfakeScore(0);
    setLipSyncMeasured(false);
    visionService.destroy();
    updateShieldStatus('video', { active: false, scanning: false });
    addLog('CAMARA: Detenida.', 'info');
  }, [addLog, updateShieldStatus]);

  const triggerDeepfakeAlert = useCallback((confidence: number, explanation: string) => {
    const now = Date.now();
    if (now - lastAlertAtRef.current < ALERT_COOLDOWN_MS) return;
    lastAlertAtRef.current = now;

    riskScorer.addSignal('video-deepfake', confidence, 2.0);

    const verdict: ScamAnalysis['verdict'] = confidence >= 70 ? 'PELIGROSO' : 'SOSPECHOSO';
    const result: ScamAnalysis = {
      verdict,
      riskScore: confidence,
      tactics: ['Deepfake / manipulacion de video'],
      explanation,
      scanSource: 'local',
      recommendations: [
        'Corta la llamada y verifica la identidad por otro canal (llamada telefonica al numero conocido).',
        'No compartas datos personales ni hagas transferencias mientras la sospecha este activa.',
      ],
    };

    setAnalysisResult(result);
    playAlertTone(verdict === 'PELIGROSO' ? 'high' : 'medium');
    notificationService.sendThreatAlert(verdict, confidence, result.tactics[0]);
    addAlert({
      verdict,
      riskScore: confidence,
      description: tRef.current.deepfakeDetected,
      detectedTactic: result.tactics[0] ?? null,
      app: sourceRef.current === 'call' ? tRef.current.cameraSourceCall : tRef.current.cameraSourceOwn,
    });
  }, [addAlert, setAnalysisResult]);

  const analyzeLoop = useCallback(() => {
    const loop = () => {
      if (!videoRef.current || !streamRef.current) return;
      const result = visionService.analyzeFrame(videoRef.current, performance.now());
      if (result) {
        hasResultRef.current = true;
        setDeepfakeScore(result.confidence);
        setLipSyncMeasured(result.signals.lipSyncMeasured);
        setStatus(result.isLikelyDeepfake ? `DEEPFAKE: ${result.explanation}` : 'Normal');
        updateShieldStatus('video', { scanning: true, lastScan: new Date().toLocaleTimeString() });

        if (result.isLikelyDeepfake) {
          triggerDeepfakeAlert(result.confidence, result.explanation);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [triggerDeepfakeAlert, updateShieldStatus]);

  const startCamera = useCallback(async () => {
    try {
      addLog('CAMARA: Inicializando...', 'system');
      const ok = await visionService.init();
      if (!ok) {
        addLog('CAMARA: No se pudo iniciar el detector facial.', 'error');
        return;
      }

      // "call" captures the video-call window/tab (the other person), which
      // is the actual fraud surface — your own webcam can't show you a
      // deepfake of yourself. "own" is kept for testing/self-checks.
      const stream = source === 'call'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: true });

      streamRef.current = stream;

      if (stream.getAudioTracks().length === 0) {
        addLog(`CAMARA: ${t.noAudioForLipSync}`, 'warning');
      }
      visionService.attachAudio(stream);

      // Screen-share / camera can be stopped from the browser's own UI, not
      // just our button — react to that so the shield status stays accurate.
      stream.getVideoTracks()[0]?.addEventListener('ended', stopCamera);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setActive(true);
      hasResultRef.current = false; // reset so warning doesn't flash from a prior session
      lastAlertAtRef.current = 0;
      updateShieldStatus('video', { active: true, scanning: true });
      addLog(`CAMARA: Deteccion deepfake activa (${source === 'call' ? t.cameraSourceCall : t.cameraSourceOwn}).`, 'success');
      analyzeLoop();
    } catch (e) {
      addLog('CAMARA: Error al acceder a la camara o compartir pantalla.', 'error');
    }
  }, [addLog, analyzeLoop, source, stopCamera, t, updateShieldStatus]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      visionService.destroy();
      updateShieldStatus('video', { active: false, scanning: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4 fade-slide-in">
      {!active && (
        <div className="card p-4">
          <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
            {t.cameraSourceLabel}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setSource('call')}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all"
              style={{
                background: source === 'call' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: source === 'call' ? 'var(--bg-primary)' : 'var(--text-secondary)',
              }}
              aria-pressed={source === 'call'}
            >
              <ScreenShare className="w-4 h-4" aria-hidden="true" />
              {t.cameraSourceCall}
            </button>
            <button
              onClick={() => setSource('own')}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all"
              style={{
                background: source === 'own' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: source === 'own' ? 'var(--bg-primary)' : 'var(--text-secondary)',
              }}
              aria-pressed={source === 'own'}
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              {t.cameraSourceOwn}
            </button>
          </div>
          {source === 'call' && (
            <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
              {t.cameraSourceCallHint}
            </p>
          )}
        </div>
      )}

      <div className="card p-4 overflow-hidden">
        <div className="relative aspect-video rounded-lg overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Camera className="w-12 h-12" style={{ color: 'var(--text-muted)' }} />
            </div>
          )}
          {active && deepfakeScore > 50 && (
            <div className="absolute top-2 right-2 px-3 py-1 rounded-full text-xs font-bold badge-dangerous">
              DEEPFAKE {deepfakeScore}%
            </div>
          )}
        </div>

        {/* Only show the warning once we've actually received a frame — prevents
            a false flash on startup while MediaPipe is still processing. */}
        {active && hasResultRef.current && !lipSyncMeasured && (
          <div className="flex items-center gap-2 mt-3">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warning)' }} />
            <p className="text-[10px]" style={{ color: 'var(--warning)' }}>
              {t.noAudioForLipSync}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between mt-4">
          {status && (
            <p className="text-xs font-mono truncate" style={{ color: deepfakeScore > 50 ? 'var(--danger)' : 'var(--success)' }}>
              {status}
            </p>
          )}
          <button
            onClick={active ? stopCamera : startCamera}
            className="btn-primary flex items-center gap-2 text-sm ml-auto"
          >
            {active ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
            {active ? t.stopCamera : t.startCamera}
          </button>
        </div>
      </div>
    </div>
  );
}
