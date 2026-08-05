import { analyzeText, cancelAnalysis, isAnalysisAborted } from './geminiService';
import { extractTextFromCanvas, extractTextFromImage } from './ocrService';
import { playAlertTone } from '@/utils/audioAlert';
import { notificationService } from './notificationService';
import type { ScamAnalysis, ShieldId, Verdict } from '@/store/useNadaStore';

// =============================================================================
// Protection Engine — Singleton Orchestrator
// Manages clipboard, screen, and voice shields in background
// With rate limiting, OCR screen scanning, audio alerts, and push notifications
// =============================================================================

export type { ShieldId };
export type { ShieldStatus } from '@/store/useNadaStore';

interface EngineCallbacks {
  onAlert: (alert: { verdict: Verdict; riskScore: number; description: string; detectedTactic: string | null; app: string }) => void;
  onAnalysisResult: (result: ScamAnalysis) => void;
  onShieldStatusChange: (shield: ShieldId, status: Record<string, unknown>) => void;
  onNotification: (title: string, body: string) => void;
  onLog: (message: string, type: 'info' | 'success' | 'warning' | 'error' | 'system') => void;
}

class ProtectionEngine {
  private callbacks: EngineCallbacks | null = null;
  private running = false;
  private clipboardInterval: ReturnType<typeof setInterval> | null = null;
  private screenInterval: ReturnType<typeof setInterval> | null = null;
  private lastClipboardText = '';

  /**
   * Persists the last clipboard text so a page reload does not re-analyze
   * the same content the user already saw an alert for.
   */
  private loadLastClipboard(): string {
    try { return sessionStorage.getItem('nada-last-clipboard') ?? ''; }
    catch { return ''; }
  }
  private saveLastClipboard(text: string) {
    this.lastClipboardText = text;
    try { sessionStorage.setItem('nada-last-clipboard', text); }
    catch { /* noop */ }
  }

  // Rate limiting for clipboard analysis.
  //
  // These intervals are set by the free-tier quota, not by how fast we could
  // poll. The Gemini free tier allows ~15 requests/minute; the previous values
  // (3s polling with a 5s cooldown, plus screen OCR every 15s) could reach
  // ~16 RPM on their own and burn the daily allowance in minutes. Exceeding it
  // returns 429, which degrades every verdict to local-only without telling
  // anyone. Clipboard changes are user-driven and bursty, so a 12s floor costs
  // almost nothing in practice.
  private lastClipboardAnalysisTime = 0;
  private readonly CLIPBOARD_COOLDOWN_MS = 12_000;
  private readonly CLIPBOARD_POLL_MS = 3000; // cheap local read, no API cost
  private readonly SCREEN_INTERVAL_MS = 60_000; // OCR + AI, the expensive lane
  private clipboardAnalysisQueue: string | null = null;
  private clipboardDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Electron screen-capture listener must be registered only once
  private screenCaptureListenerBound = false;

  init(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
    this.bindScreenCaptureListener();
    this.log('Motor de proteccion inicializado.', 'system');
  }

  /**
   * Binds the Electron screen-capture listener exactly once.
   *
   * This used to live in startScreenMonitor(), so every protection toggle
   * stacked another listener and a single capture fanned out into N concurrent
   * OCR + analysis runs.
   */
  private bindScreenCaptureListener() {
    if (this.screenCaptureListenerBound) return;
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.onScreenCapture) return;

    electronAPI.onScreenCapture((dataUrl: string) => {
      if (!this.running) return;
      void this.analyzeScreenCapture(dataUrl);
    });
    this.screenCaptureListenerBound = true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.log('Proteccion ACTIVADA — Escudos en segundo plano.', 'success');

    this.startClipboardMonitor();
    this.startScreenMonitor();
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.clipboardInterval) {
      clearInterval(this.clipboardInterval);
      this.clipboardInterval = null;
    }
    if (this.screenInterval) {
      clearInterval(this.screenInterval);
      this.screenInterval = null;
    }
    if (this.clipboardDebounceTimer) {
      clearTimeout(this.clipboardDebounceTimer);
      this.clipboardDebounceTimer = null;
    }
    this.clipboardAnalysisQueue = null;

    // Drop any in-flight background analysis so results cannot land after the
    // user has switched protection off.
    cancelAnalysis('clipboard');
    cancelAnalysis('screen');

    this.callbacks?.onShieldStatusChange('clipboard', { active: false, scanning: false });
    this.callbacks?.onShieldStatusChange('screen', { active: false, scanning: false });
    this.callbacks?.onShieldStatusChange('voice', { active: false, scanning: false });
    this.log('Proteccion DESACTIVADA.', 'warning');
  }

  // ── Clipboard Shield (with rate limiting) ─────────────────────
  private startClipboardMonitor() {
    this.callbacks?.onShieldStatusChange('clipboard', { active: true });
    this.lastClipboardText = this.loadLastClipboard();

    this.clipboardInterval = setInterval(() => {
      if (!this.running) return;
      this.checkClipboard();
    }, this.CLIPBOARD_POLL_MS);
  }

  private async checkClipboard() {
    try {
      // Web API clipboard (requires focus)
      const text = await navigator.clipboard.readText().catch(() => '');
      if (!text || text === this.lastClipboardText || text.length < 15) return;

      this.saveLastClipboard(text);

      // Rate limiting: debounce rapid clipboard changes
      const now = Date.now();
      const timeSinceLastAnalysis = now - this.lastClipboardAnalysisTime;

      if (timeSinceLastAnalysis < this.CLIPBOARD_COOLDOWN_MS) {
        // Queue the text and debounce
        this.clipboardAnalysisQueue = text;
        if (this.clipboardDebounceTimer) clearTimeout(this.clipboardDebounceTimer);
        this.clipboardDebounceTimer = setTimeout(() => {
          if (this.clipboardAnalysisQueue && this.running) {
            this.performClipboardAnalysis(this.clipboardAnalysisQueue);
            this.clipboardAnalysisQueue = null;
          }
        }, this.CLIPBOARD_COOLDOWN_MS - timeSinceLastAnalysis);
        return;
      }

      await this.performClipboardAnalysis(text);
    } catch {
      // Clipboard not available (no focus or permission)
    }
  }

  private async performClipboardAnalysis(text: string) {
    this.lastClipboardAnalysisTime = Date.now();
    this.callbacks?.onShieldStatusChange('clipboard', { scanning: true });
    this.log(`CLIPBOARD: Analizando ${text.length} caracteres...`, 'info');

    try {
      const result = await analyzeText(text, 'clipboard');
      const now = new Date().toLocaleTimeString();
      this.callbacks?.onShieldStatusChange('clipboard', { scanning: false, lastScan: now, lastThreatLevel: result.verdict });

      if (result.verdict !== 'SEGURO') {
        this.triggerThreatAlert(result, 'Texto sospechoso detectado en portapapeles', 'Portapapeles');
      }
    } catch (e) {
      this.callbacks?.onShieldStatusChange('clipboard', { scanning: false });
      // A superseded scan is expected; anything else is a real failure the
      // user must know about, because the shield did not actually protect them.
      if (!isAnalysisAborted(e)) {
        this.log('CLIPBOARD: El analisis fallo. Este texto no fue verificado.', 'error');
      }
    }
  }

  // ── Screen Shield (OCR-powered + Electron desktopCapturer) ──
  private startScreenMonitor() {
    this.callbacks?.onShieldStatusChange('screen', { active: true });

    // The Electron capture listener is bound once in init(), not here.
    const electronAPI = (window as any).electronAPI;

    this.screenInterval = setInterval(async () => {
      if (!this.running) return;

      // In the browser this lane can only read visible <video> elements, so
      // scanning a hidden tab spends free-tier quota on nothing. In Electron the
      // opposite is true: minimising NADA to the tray is the normal way to use
      // it, and desktopCapturer still sees the whole screen, so keep going.
      if (!electronAPI?.captureScreen && typeof document !== 'undefined' && document.hidden) {
        return;
      }

      try {
        // Electron mode: use desktopCapturer for full screen OCR
        if (electronAPI?.captureScreen) {
          const dataUrl = await electronAPI.captureScreen();
          if (dataUrl) {
            await this.analyzeScreenCapture(dataUrl);
            return;
          }
        }

        // Web mode: capture from visible video elements
        const videoElements = document.querySelectorAll('video');
        if (videoElements.length === 0) {
          const now = new Date().toLocaleTimeString();
          this.callbacks?.onShieldStatusChange('screen', { lastScan: now });
          return;
        }

        for (const video of videoElements) {
          if (video.readyState < 2 || video.videoWidth === 0) continue;

          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          ctx.drawImage(video, 0, 0);
          this.callbacks?.onShieldStatusChange('screen', { scanning: true });

          const extractedText = await extractTextFromCanvas(canvas);
          const now = new Date().toLocaleTimeString();

          if (extractedText && extractedText.length > 20) {
            this.log(`PANTALLA: OCR extrajo ${extractedText.length} caracteres.`, 'info');
            const result = await analyzeText(extractedText, 'screen');
            this.callbacks?.onShieldStatusChange('screen', { scanning: false, lastScan: now, lastThreatLevel: result.verdict });

            if (result.verdict !== 'SEGURO') {
              this.triggerThreatAlert(result, 'Contenido sospechoso detectado en pantalla (OCR)', 'Pantalla');
            }
          } else {
            this.callbacks?.onShieldStatusChange('screen', { scanning: false, lastScan: now });
          }
        }
      } catch {
        const now = new Date().toLocaleTimeString();
        this.callbacks?.onShieldStatusChange('screen', { scanning: false, lastScan: now });
      }
    }, this.SCREEN_INTERVAL_MS);
  }

  // ── Voice Shield ──────────────────────────────────────────────
  async startVoiceMonitoring() {
    if (!this.running) return;
    this.callbacks?.onShieldStatusChange('voice', { active: true, scanning: true });
    this.log('ESCUDO VOZ: Monitoreo de llamada activado.', 'success');
  }

  stopVoiceMonitoring() {
    this.callbacks?.onShieldStatusChange('voice', { active: false, scanning: false });
    this.log('ESCUDO VOZ: Monitoreo detenido.', 'info');
  }

  // ── Screen capture analysis (shared by Electron and web) ──────
  private async analyzeScreenCapture(dataUrl: string) {
    this.callbacks?.onShieldStatusChange('screen', { scanning: true });

    try {
      const extractedText = await extractTextFromImage(dataUrl);
      const now = new Date().toLocaleTimeString();

      if (extractedText && extractedText.length > 20) {
        this.log(`PANTALLA: OCR extrajo ${extractedText.length} caracteres (captura).`, 'info');
        const result = await analyzeText(extractedText, 'screen');
        this.callbacks?.onShieldStatusChange('screen', { scanning: false, lastScan: now, lastThreatLevel: result.verdict });

        if (result.verdict !== 'SEGURO') {
          this.triggerThreatAlert(result, 'Contenido sospechoso detectado en pantalla', 'Pantalla');
        }
      } else {
        this.callbacks?.onShieldStatusChange('screen', { scanning: false, lastScan: now });
      }
    } catch (e) {
      const now = new Date().toLocaleTimeString();
      this.callbacks?.onShieldStatusChange('screen', { scanning: false, lastScan: now });
      if (!isAnalysisAborted(e)) {
        this.log('PANTALLA: El analisis fallo. Esta captura no fue verificada.', 'error');
      }
    }
  }

  // ── Threat Alert with Audio + Push Notification ───────────────
  private triggerThreatAlert(result: ScamAnalysis, description: string, app: string) {
    // Play audio alert based on severity
    if (result.verdict === 'PELIGROSO') {
      playAlertTone('high');
    } else if (result.verdict === 'SOSPECHOSO') {
      playAlertTone('medium');
    }

    // Send push notification
    notificationService.sendThreatAlert(result.verdict, result.riskScore, result.tactics[0]);

    this.callbacks?.onAlert({
      verdict: result.verdict,
      riskScore: result.riskScore,
      description,
      detectedTactic: result.tactics[0] ?? null,
      app,
    });
    this.callbacks?.onAnalysisResult(result);
  }

  // ── Helpers ───────────────────────────────────────────────────
  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' | 'system') {
    this.callbacks?.onLog(message, type);
  }

  isRunning() {
    return this.running;
  }
}

// Singleton
export const protectionEngine = new ProtectionEngine();
