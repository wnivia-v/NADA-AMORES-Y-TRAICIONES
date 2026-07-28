// =============================================================================
// Vision Service — TensorFlow.js Biometric Deepfake Detection
// EAR (Eye Aspect Ratio), blink tracking, lip sync, jitter analysis
// =============================================================================

interface BiometricSignals {
  earLeft: number;
  earRight: number;
  blinkRate: number; // blinks per minute
  lipSyncScore: number; // 0-1 (1 = perfect sync)
  jitterScore: number; // 0-1 (1 = very jittery, likely deepfake)
  headPoseStable: boolean;
}

interface DeepfakeResult {
  isLikelyDeepfake: boolean;
  confidence: number; // 0-100
  signals: BiometricSignals;
  explanation: string;
}

class VisionService {
  private landmarker: any = null;
  private blinkHistory: number[] = [];
  private frameCount = 0;
  private lastLandmarks: any = null;

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

      // Lip sync placeholder (would compare with audio)
      const lipSyncScore = 0.9;

      // Head pose stability
      const headPoseStable = jitterScore < 0.3;

      const signals: BiometricSignals = {
        earLeft,
        earRight,
        blinkRate,
        lipSyncScore,
        jitterScore,
        headPoseStable,
      };

      // Deepfake heuristics
      const isLikelyDeepfake = this.evaluateDeepfake(signals);
      const confidence = this.calculateConfidence(signals);

      this.lastLandmarks = landmarks;

      return {
        isLikelyDeepfake,
        confidence,
        signals,
        explanation: isLikelyDeepfake
          ? `Anomalias biometricas: parpadeo ${blinkRate < 5 ? 'muy bajo' : 'irregular'}, jitter ${jitterScore > 0.5 ? 'alto' : 'medio'}`
          : 'Patrones biometricos normales.',
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
    if (signals.lipSyncScore < 0.6) score += 2;
    if (!signals.headPoseStable) score += 1;
    return score >= 4;
  }

  private calculateConfidence(signals: BiometricSignals): number {
    let confidence = 0;
    if (signals.blinkRate < 5) confidence += 25;
    if (signals.blinkRate > 40) confidence += 20;
    if (signals.jitterScore > 0.5) confidence += 30;
    if (signals.lipSyncScore < 0.6) confidence += 25;
    return Math.min(100, confidence);
  }

  destroy() {
    this.landmarker?.close();
    this.landmarker = null;
    this.blinkHistory = [];
    this.lastLandmarks = null;
  }
}

export const visionService = new VisionService();
