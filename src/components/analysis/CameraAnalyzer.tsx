import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { visionService } from '@/services/visionService';
import { translations } from '@/utils/translations';

export function CameraAnalyzer() {
  const { language, addLog } = useNadaStore();
  const t = translations[language];
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('');
  const [deepfakeScore, setDeepfakeScore] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const startCamera = useCallback(async () => {
    try {
      addLog('CAMARA: Inicializando...', 'system');
      const ok = await visionService.init();
      if (!ok) {
        addLog('CAMARA: No se pudo iniciar el detector facial.', 'error');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setActive(true);
      addLog('CAMARA: Deteccion deepfake activa.', 'success');
      analyzeLoop();
    } catch (e) {
      addLog('CAMARA: Error al acceder a la camara.', 'error');
    }
  }, [addLog]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
    setStatus('');
    setDeepfakeScore(0);
    visionService.destroy();
    addLog('CAMARA: Detenida.', 'info');
  }, [addLog]);

  const analyzeLoop = useCallback(() => {
    const loop = () => {
      if (!videoRef.current || !streamRef.current) return;
      const result = visionService.analyzeFrame(videoRef.current, performance.now());
      if (result) {
        setDeepfakeScore(result.confidence);
        setStatus(result.isLikelyDeepfake ? `DEEPFAKE: ${result.explanation}` : 'Normal');
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      visionService.destroy();
    };
  }, []);

  return (
    <div className="space-y-4 fade-slide-in">
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
