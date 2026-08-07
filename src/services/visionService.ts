// =============================================================================
// Vision Service — TensorFlow.js Biometric Deepfake Detection
// EAR (Eye Aspect Ratio), blink tracking, real lip-sync (mouth movement vs
// audio energy), jitter analysis
// =============================================================================

import { rms, correlate, lipSyncScoreFromCorrelation } from '@/utils/lipSync';

interface BiometricSignals {
  earLeft: number;
  earRight: number;
  blinkRate: number; // blinks per minute
  lipSyncScore: number; // 0-1 (1 = perfect sync)
  lipSyncMeasured: boolean; // false when there was no audio track to compare against
  jitterScore: number; // 0-1 (1 = very jittery, likely deepfake)
  headPoseStable: boolean;
}

interface DeepfakeResult {
  isLikelyDeepfake: boolean;
  confidence: number; // 0-100
  signals: BiometricSignals;
  explanation: string;
}

// Mouth landmark indices (MediaPipe FaceLandmarker 478-point mesh):
// inner lip top/bottom + outer corners, used for Mouth Aspect Ratio (MAR).
const MOUTH_TOP = 13;
const MOUTH_BOTTOM = 14;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;

// Rolling window of mouth/audio samples kept for correlation, roughly
// matching the 3s window used elsewhere for the deepfake heuristics.
const SYNC_SAMPLE_LIMIT = 90;

class VisionService {
  private landmarker: any = null;
  private blinkHistory: number[] = [];
  private frameCount = 0;
  private lastLandmarks: any = null;

  // Lip-sync: audio graph attached separately from the video stream, since
  // the caller may be capturing a call window (getDisplayMedia) or its own
  // mic (getUserMedia) — either way we just need an audio track to sample.
  private audioCtx: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioByteBuffer: Uint8Array<ArrayBuffer> | null = null;
  private marHistory: number[] = [];
  private energyHistory: number[] = [];

  async init(): Promise<boolean> {
    try {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
      );
      this.landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
      return true;
    } catch (e) {
      console.warn('[NADA] Vision init failed:', e);
      return false;
    }
  }

  /**
   * Connects an audio track (from the same call/camera stream) so lip-sync
   * can be measured against real audio energy instead of a fixed placeholder.
   * Safe to call with a stream that has no audio track — lip-sync then stays
   * explicitly "not measured" instead of guessing.
   */
  attachAudio(stream: MediaStream) {
    this.detachAudio();

    const [track] = stream.getAudioTracks();
    if (!track) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx();
      this.audioSource = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.audioSource.connect(this.analyser);
      // Explicit ArrayBuffer backing: TS 5.7+ types getByteTimeDomainData as
      // wanting Uint8Array<ArrayBuffer>, which `new Uint8Array(n)` alone
      // no longer satisfies (it infers ArrayBufferLike).
      this.audioByteBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    } catch (e) {
      console.warn('[NADA] Lip-sync audio attach failed:', e);
      this.detachAudio();
    }
  }

  detachAudio() {
    this.audioSource?.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => { });
    }
    this.audioCtx = null;
    this.audioSource = null;
    this.analyser = null;
    this.audioByteBuffer = null;
    this.marHistory = [];
    this.energyHistory = [];
  }

  analyzeFrame(videoElement: HTMLVideoElement, timestampMs: number): DeepfakeResult | null {
    if (!this.landmarker) return null;

    try {
      const results = this.landmarker.detectForVideo(videoElement, timestampMs);
      if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
        return null;
      }

      const landmarks = results.faceLandmarks[0];
      this.frameCount++;

      // Calculate EAR (Eye Aspect Ratio)
      const earLeft = this.calculateEAR(landmarks, 'left');
      const earRight = this.calculateEAR(landmarks, 'right');
      const avgEar = (earLeft + earRight) / 2;

      // Blink detection (EAR < 0.2 = closed)
      if (avgEar < 0.2) {
        this.blinkHistory.push(Date.now());
      }

      // Blink rate (last 60 seconds)
      const oneMinuteAgo = Date.now() - 60000;
      this.blinkHistory = this.blinkHistory.filter((t) => t > oneMinuteAgo);
      const blinkRate = this.blinkHistory.length;

      // Jitter analysis (landmark position variance)
      const jitterScore = this.calculateJitter(landmarks);

      // Real lip-sync: correlate mouth aspect ratio against audio energy
      const mar = this.calculateMAR(landmarks);
      const { score: lipSyncScore, measured: lipSyncMeasured } = this.updateLipSync(mar);

      // Head pose stability
      const headPoseStable = jitterScore < 0.3;

      const signals: BiometricSignals = {
        earLeft,
        earRight,
        blinkRate,
        lipSyncScore,
        lipSyncMeasured,
        jitterScore,
        headPoseStable,
      };

      // Deepfake heuristics
      const isLikelyDeepfake = this.evaluateDeepfake(signals);
      const confidence = this.calculateConfidence(signals);

      this.lastLandmarks = landmarks;

      const lipSyncNote = lipSyncMeasured
        ? `, sincronia labial ${lipSyncScore < 0.55 ? 'desincronizada' : 'normal'}`
        : ', sincronia labial sin verificar (sin audio)';

      return {
        isLikelyDeepfake,
        confidence,
        signals,
        explanation: isLikelyDeepfake
          ? `Anomalias biometricas: parpadeo ${blinkRate < 5 ? 'muy bajo' : 'irregular'}, jitter ${jitterScore > 0.5 ? 'alto' : 'medio'}${lipSyncNote}`
          : `Patrones biometricos normales${lipSyncNote}.`,
      };
    } catch {
      return null;
    }
  }

  private calculateEAR(landmarks: any[], side: 'left' | 'right'): number {
    // Simplified EAR using landmark indices
    const indices = side === 'left' ? [33, 160, 158, 133, 153, 144] : [362, 385, 387, 263, 373, 380];
    try {
      const p = indices.map((i) => landmarks[i]);
      if (p.some((pt) => !pt)) return 0.3;
      const vertical1 = Math.abs(p[1].y - p[5].y);
      const vertical2 = Math.abs(p[2].y - p[4].y);
      const horizontal = Math.abs(p[0].x - p[3].x);
      return (vertical1 + vertical2) / (2 * horizontal + 0.001);
    } catch {
      return 0.3;
    }
  }

  /** Mouth Aspect Ratio: vertical mouth opening relative to mouth width. */
  private calculateMAR(landmarks: any[]): number {
    try {
      const top = landmarks[MOUTH_TOP];
      const bottom = landmarks[MOUTH_BOTTOM];
      const left = landmarks[MOUTH_LEFT];
      const right = landmarks[MOUTH_RIGHT];
      if (!top || !bottom || !left || !right) return 0;
      const vertical = Math.abs(top.y - bottom.y);
      const horizontal = Math.abs(left.x - right.x) + 0.001;
      return vertical / horizontal;
    } catch {
      return 0;
    }
  }

  private sampleAudioEnergy(): number | null {
    if (!this.analyser || !this.audioByteBuffer) return null;
    this.analyser.getByteTimeDomainData(this.audioByteBuffer);
    return rms(this.audioByteBuffer);
  }

  /**
   * Feeds one mouth/audio sample pair into the rolling window and returns the
   * current lip-sync estimate. Returns unmeasured when there is no audio
   * track attached — this is the case that used to silently default to 0.9.
   */
  private updateLipSync(mar: number): { score: number; measured: boolean } {
    const energy = this.sampleAudioEnergy();
    if (energy === null) return { score: 0.75, measured: false };

    this.marHistory.push(mar);
    this.energyHistory.push(energy);
    if (this.marHistory.length > SYNC_SAMPLE_LIMIT) this.marHistory.shift();
    if (this.energyHistory.length > SYNC_SAMPLE_LIMIT) this.energyHistory.shift();

    const corr = correlate(this.marHistory, this.energyHistory);
    return lipSyncScoreFromCorrelation(corr);
  }

  private calculateJitter(landmarks: any[]): number {
    if (!this.lastLandmarks) return 0;
    let totalDiff = 0;
    const samplePoints = [1, 4, 6, 10, 152, 234, 454]; // Key face points
    for (const idx of samplePoints) {
      const curr = landmarks[idx];
      const prev = this.lastLandmarks[idx];
      if (curr && prev) {
        totalDiff += Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
      }
    }
    return Math.min(1, totalDiff / samplePoints.length * 50);
  }

  private evaluateDeepfake(signals: BiometricSignals): boolean {
    let score = 0;
    if (signals.blinkRate < 5 || signals.blinkRate > 40) score += 2;
    if (signals.jitterScore > 0.5) score += 2;
    // Only counts as evidence when we actually had audio to compare against —
    // an unmeasured lip-sync must never push the verdict toward "deepfake".
    if (signals.lipSyncMeasured && signals.lipSyncScore < 0.55) score += 2;
    if (!signals.headPoseStable) score += 1;
    return score >= 4;
  }

  private calculateConfidence(signals: BiometricSignals): number {
    let confidence = 0;
    if (signals.blinkRate < 5) confidence += 25;
    if (signals.blinkRate > 40) confidence += 20;
    if (signals.jitterScore > 0.5) confidence += 30;
    if (signals.lipSyncMeasured && signals.lipSyncScore < 0.55) confidence += 25;
    return Math.min(100, confidence);
  }

  destroy() {
    this.landmarker?.close();
    this.landmarker = null;
    this.blinkHistory = [];
    this.lastLandmarks = null;
    this.detachAudio();
  }
}

export const visionService = new VisionService();
