import { visionService } from './visionService';
import { riskScorer } from '@/utils/riskScorer';
import { playAlertTone } from '@/utils/audioAlert';
import { notificationService } from './notificationService';
import type { ScamAnalysis } from '@/store/useNadaStore';

// =============================================================================
// Video Shield — Singleton Orchestrator
// Owns the MediaStream + analysis loop so a deepfake-detection session
// survives navigating away from the camera view, the same way voice
// monitoring lives in protectionEngine instead of inside VoiceAnalyzer.
// =============================================================================

export type CameraSource = 'own' | 'call';

interface VideoShieldCallbacks {
  onAlert: (alert: { verdict: ScamAnalysis['verdict']; riskScore: number; description: string; detectedTactic: string | null; app: string }) => void;
  onAnalysisResult: (result: ScamAnalysis) => void;
  onShieldStatusChange: (status: Record<string, unknown>) => void;
  onFrame: (deepfakeScore: number, lipSyncMeasured: boolean) => void;
  onLog: (message: string, type: 'info' | 'success' | 'warning' | 'error' | 'system') => void;
  labelForSource: (source: CameraSource) => string;
  getDeepfakeDetectedLabel: () => string;
}

// Deepfake alerts are re-evaluated every animation frame; without a cooldown
// a single ongoing deepfake would spam the alert log dozens of times a second.
const ALERT_COOLDOWN_MS = 20_000;

class VideoShieldService {
  private callbacks: VideoShieldCallbacks | null = null;
  private stream: MediaStream | null = null;
  // Detached from the DOM on purpose: the capture loop must keep running
  // even while CameraAnalyzer (and its own <video> preview) isn't mounted.
  private videoEl: HTMLVideoElement | null = null;
  private rafId = 0;
  private source: CameraSource = 'call';
  private lastAlertAt = 0;

  init(callbacks: VideoShieldCallbacks) {
    this.callbacks = callbacks;
  }

  isActive(): boolean {
    return !!this.stream;
  }

  getSource(): CameraSource {
    return this.source;
  }

  /** Mirrors the live stream into a visible <video> element for preview only — capture keeps running regardless. */
  attachPreview(el: HTMLVideoElement) {
    if (this.stream) {
      el.srcObject = this.stream;
      void el.play().catch(() => {});
    }
  }

  async start(source: CameraSource): Promise<boolean> {
    if (this.stream) return true;

    this.callbacks?.onLog('CAMARA: Inicializando...', 'system');
    const ok = await visionService.init();
    if (!ok) {
      this.callbacks?.onLog('CAMARA: No se pudo iniciar el detector facial.', 'error');
      return false;
    }

    try {
      // "call" captures the video-call window/tab (the other person), which
      // is the actual fraud surface — your own webcam can't show you a
      // deepfake of yourself. "own" is kept for testing/self-checks.
      const stream = source === 'call'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: true });

      this.stream = stream;
      this.source = source;
      this.lastAlertAt = 0;

      if (stream.getAudioTracks().length === 0) {
        this.callbacks?.onLog('CAMARA: Sin audio — no se puede verificar la sincronia labial.', 'warning');
      }
      visionService.attachAudio(stream);

      // Detached decode source: doesn't need to be in the DOM to feed frames
      // to MediaPipe, so the analysis loop is independent of any component.
      this.videoEl = document.createElement('video');
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      this.videoEl.srcObject = stream;
      await this.videoEl.play();

      // Screen-share / camera can be stopped from the browser's own UI, not
      // just our button — react to that so shield status stays accurate.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop());

      this.callbacks?.onShieldStatusChange({ active: true, scanning: true });
      this.callbacks?.onLog(`CAMARA: Deteccion deepfake activa (${this.callbacks?.labelForSource(source)}).`, 'success');
      this.loop();
      return true;
    } catch {
      this.callbacks?.onLog('CAMARA: Error al acceder a la camara o compartir pantalla.', 'error');
      return false;
    }
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.videoEl?.pause();
    this.videoEl = null;
    visionService.destroy();
    this.callbacks?.onShieldStatusChange({ active: false, scanning: false });
    this.callbacks?.onFrame(0, false);
    this.callbacks?.onLog('CAMARA: Detenida.', 'info');
  }

  private loop = () => {
    if (!this.videoEl || !this.stream) return;
    const result = visionService.analyzeFrame(this.videoEl, performance.now());
    if (result) {
      this.callbacks?.onFrame(result.confidence, result.signals.lipSyncMeasured);
      this.callbacks?.onShieldStatusChange({ scanning: true, lastScan: new Date().toLocaleTimeString() });

      if (result.isLikelyDeepfake) {
        this.triggerDeepfakeAlert(result.confidence, result.explanation);
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private triggerDeepfakeAlert(confidence: number, explanation: string) {
    const now = Date.now();
    if (now - this.lastAlertAt < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt = now;

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

    this.callbacks?.onAnalysisResult(result);
    playAlertTone(verdict === 'PELIGROSO' ? 'high' : 'medium');
    notificationService.sendThreatAlert(verdict, confidence, result.tactics[0]);
    this.callbacks?.onAlert({
      verdict,
      riskScore: confidence,
      description: this.callbacks?.getDeepfakeDetectedLabel() ?? 'Posible deepfake detectado',
      detectedTactic: result.tactics[0] ?? null,
      app: this.callbacks?.labelForSource(this.source) ?? 'Video',
    });
  }
}

export const videoShieldService = new VideoShieldService();
