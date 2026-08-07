import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CameraOff, ScreenShare, AlertTriangle } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { videoShieldService, type CameraSource } from '@/services/videoShieldService';
import { translations } from '@/utils/translations';

// Thin view: capture + analysis lifecycle lives in videoShieldService so a
// running deepfake-detection session survives navigating away from this
// screen, the same way voice monitoring lives in protectionEngine.
export function CameraAnalyzer() {
  const { language, shieldStatus, videoDeepfakeScore, videoLipSyncMeasured } = useNadaStore();
  const t = translations[language];
  const active = shieldStatus.video.active;
  const [source, setSource] = useState<CameraSource>(videoShieldService.getSource());
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // If a session is already running (started from another tab, or before
  // this component was mounted), attach the preview immediately instead of
  // showing an inactive camera icon while it's actually protecting.
  useEffect(() => {
    if (active && videoRef.current) {
      videoShieldService.attachPreview(videoRef.current);
    }
  }, [active]);

  const startCamera = useCallback(async () => {
    setStarting(true);
    const ok = await videoShieldService.start(source);
    setStarting(false);
    if (ok && videoRef.current) {
      videoShieldService.attachPreview(videoRef.current);
    }
  }, [source]);

  const stopCamera = useCallback(() => {
    videoShieldService.stop();
  }, []);

  const status = active
    ? (videoDeepfakeScore > 50 ? `DEEPFAKE: ${videoDeepfakeScore}%` : 'Normal')
    : '';

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
          {active && videoDeepfakeScore > 50 && (
            <div className="absolute top-2 right-2 px-3 py-1 rounded-full text-xs font-bold badge-dangerous">
              DEEPFAKE {videoDeepfakeScore}%
            </div>
          )}
        </div>

        {active && !videoLipSyncMeasured && (
          <div className="flex items-center gap-2 mt-3">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warning)' }} />
            <p className="text-[10px]" style={{ color: 'var(--warning)' }}>
              {t.noAudioForLipSync}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between mt-4">
          {status && (
            <p className="text-xs font-mono truncate" style={{ color: videoDeepfakeScore > 50 ? 'var(--danger)' : 'var(--success)' }}>
              {status}
            </p>
          )}
          <button
            onClick={active ? stopCamera : startCamera}
            disabled={starting}
            className="btn-primary flex items-center gap-2 text-sm ml-auto disabled:opacity-60"
          >
            {active ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
            {active ? t.stopCamera : (starting ? t.analyzing : t.startCamera)}
          </button>
        </div>
      </div>
    </div>
  );
}
