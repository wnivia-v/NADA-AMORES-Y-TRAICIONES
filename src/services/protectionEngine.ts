import { analyzeText, analyzeVoiceFragment, cancelAnalysis, isAnalysisAborted } from './geminiService';
import { extractTextFromCanvas, extractTextFromImage } from './ocrService';
import { voiceRecognition, type VoiceErrorCode } from './voice';
import { playAlertTone } from '@/utils/audioAlert';
import { notificationService } from './notificationService';
import type { ScamAnalysis, ShieldId, Verdict } from '@/store/useNadaStore';

// =============================================================================
// Protection Engine — Singleton Orchestrator
// Manages clipboard, screen, voice and video shields in background
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
  onVoiceTranscript: (text: string) => void;
  /** Live, not-yet-final words — see the field doc on voiceInterim in the store. */
  onVoiceInterim: (text: string) => void;
  onVoiceRealtimeVerdict: (result: ScamAnalysis | null) => void;
  onVoiceSpeechActive: (active: boolean) => void;
  /** null clears the error banner — called on every successful (re)start. */
  onVoiceError: (message: string | null) => void;
  /** Read fresh at every voice start — the UI language can change between sessions. */
  getLanguage: () => 'es' | 'en';
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

  // Voice shield state — owned here (not by any React component) so it
  // survives navigating between tabs/views inside the app. A component
  // unmounting must never silently kill an active listening session.
  private voiceActive = false;
  private voiceTranscript = '';
  private lastVoiceAnalyzed = '';
  private lastVoiceAnalysisAt = 0;
  // 6s was tuned purely for API-quota safety, not for how a live demo reads —
  // a real extortion phrase sitting on screen for 6s with no reaction looks
  // like the shield is doing nothing. 3s keeps quota usage sane (still well
  // under the ~15 req/min free tier this app budgets for) while reacting fast
  // enough to look — and be — "oportuno".
  private readonly VOICE_ANALYSIS_COOLDOWN_MS = 3_000;
  private readonly VOICE_MIN_FRAGMENT_LEN = 12;

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
    // Mic permission persists once granted, so this only shows a native
    // prompt on the very first activation; every activation after that
    // starts silently. If the user denies it, handleVoiceError reports why.
    void this.startVoiceMonitoring();
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
    this.stopVoiceMonitoring();

    this.callbacks?.onShieldStatusChange('clipboard', { active: false, scanning: false });
    this.callbacks?.onShieldStatusChange('screen', { active: false, scanning: false });
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
      // Skip if the page doesn't have focus — calling readText() without focus
      // either fails silently or triggers a blocking permission prompt that
      // freezes the UI until the user dismisses it.
      if (typeof document !== 'undefined' && !document.hasFocus()) return;

      // Check the clipboard-read permission without triggering a prompt.
      // If the permission is "prompt" (not yet decided) or "denied", we skip
      // the read entirely. The user will be asked the next time they manually
      // paste something; we should never force the browser dialog from a
      // background interval.
      if (navigator.permissions) {
        try {
          const perm = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
          if (perm.state !== 'granted') return;
        } catch {
          // Some browsers don't support querying clipboard-read — fall through
          // and let readText() decide, but guard with the focus check above.
        }
      }

      // Add a short timeout so readText() can never block the interval loop
      // (e.g. when the clipboard contains an image on some browsers).
      const readWithTimeout = Promise.race([
        navigator.clipboard.readText(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('clipboard-timeout')), 2000)
        ),
      ]);

      const text = await readWithTimeout.catch(() => '');
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
  //
  // Lives entirely in this singleton, not in a React component. Previously
  // ConsumerHome and VoiceAnalyzer each drove the recognizer with their own
  // local `listening` state — navigating away from one left it running
  // invisibly while the other screen's UI reset to "not listening", and
  // pressing the mic again was a silent no-op. That split-brain state is
  // exactly what looked like "parece que escucha pero no responde".
  //
  // Engine selection and fallback live in services/voice — this method only
  // cares about transcript in, analysis out.
  async startVoiceMonitoring() {
    if (this.voiceActive) return;

    if (!voiceRecognition.isSupported()) {
      const msg = '❌ Reconocimiento de voz no disponible en este dispositivo. En el navegador usa Chrome o Edge.';
      this.log(`ESCUDO VOZ: ${msg}`, 'error');
      this.callbacks?.onShieldStatusChange('voice', { active: false, scanning: false });
      this.callbacks?.onVoiceError(msg);
      return;
    }

    this.voiceActive = true;
    this.voiceTranscript = '';
    this.lastVoiceAnalyzed = '';
    this.callbacks?.onVoiceTranscript('');
    this.callbacks?.onVoiceInterim('');
    this.callbacks?.onVoiceRealtimeVerdict(null);
    this.callbacks?.onVoiceError(null);

    await voiceRecognition.start({
      lang: this.callbacks?.getLanguage() ?? 'es',

      onTranscript: (text, isFinal) => {
        if (isFinal) {
          this.voiceTranscript = `${this.voiceTranscript} ${text}`.trim();
          this.callbacks?.onVoiceTranscript(this.voiceTranscript);
          this.callbacks?.onVoiceInterim('');
          this.maybeAnalyzeVoiceFragment(this.voiceTranscript);
          return;
        }
        // Not final yet — shown immediately so the panel proves it is
        // listening, and fed into analysis too: waiting for a phrase to be
        // "settled" is not oportuno when a threat is mid-sentence. It is not
        // appended to voiceTranscript, because the engine may still revise it.
        this.callbacks?.onVoiceInterim(text);
        this.maybeAnalyzeVoiceFragment(`${this.voiceTranscript} ${text}`.trim());
      },

      onActivity: (speaking) => this.callbacks?.onVoiceSpeechActive(speaking),

      // Engine switches and model download progress. Visible in the console
      // panel so a slow first run reads as "working on it", not "frozen".
      onStatus: (message) => this.log(`ESCUDO VOZ: ${message}`, 'info'),

      onError: (code, detail) => this.handleVoiceError(code, detail),

      onEngineChange: ({ label }) => {
        this.log(`ESCUDO VOZ: motor activo — ${label}.`, 'system');
      },
    });

    this.callbacks?.onShieldStatusChange('voice', { active: true, scanning: true });
    this.log('ESCUDO VOZ: Escucha en tiempo real activa.', 'success');
  }

  stopVoiceMonitoring() {
    if (!this.voiceActive) return;
    this.voiceActive = false;

    voiceRecognition.stop();
    cancelAnalysis('voice');

    const finalTranscript = this.voiceTranscript;
    this.callbacks?.onShieldStatusChange('voice', { active: false, scanning: false });
    this.callbacks?.onVoiceSpeechActive(false);
    this.log('ESCUDO VOZ: Monitoreo detenido.', 'info');

    // Final pass over whatever was captured, same as the old per-component
    // "stop" behavior, now happening regardless of which screen triggered stop.
    if (finalTranscript.length > this.VOICE_MIN_FRAGMENT_LEN) {
      analyzeText(finalTranscript, 'voice')
        .then((result) => {
          this.callbacks?.onAnalysisResult(result);
          this.log(`VEREDICTO VOZ FINAL: [${result.verdict}] — ${result.riskScore}/100`, result.verdict === 'PELIGROSO' ? 'error' : 'success');
        })
        .catch((e) => {
          if (!isAnalysisAborted(e)) {
            this.log('VOZ: El analisis final fallo. Ese tramo de la conversacion no fue verificado.', 'warning');
          }
        });
    }
  }

  isVoiceActive() {
    return this.voiceActive;
  }

  /**
   * Only reached when EVERY engine has been ruled out — the orchestrator
   * handles recoverable errors and engine switching on its own, so anything
   * arriving here means the shield genuinely cannot listen.
   */
  private handleVoiceError(code: VoiceErrorCode, detail?: string) {
    this.voiceActive = false;
    this.callbacks?.onShieldStatusChange('voice', { active: false, scanning: false });
    this.callbacks?.onVoiceSpeechActive(false);

    const messages: Record<VoiceErrorCode, string> = {
      'not-allowed': '❌ Permiso de microfono denegado. Habilitalo en los ajustes del navegador o del sistema y volve a activar el escudo.',
      'no-microphone': '❌ No se detecto ningun microfono. Revisa que el dispositivo de entrada correcto este conectado y seleccionado.',
      'engine-unavailable': '❌ No se pudo iniciar el reconocimiento de voz en este dispositivo.',
      unknown: '❌ El escudo de voz se detuvo por un error inesperado.',
    };

    // `detail` carries the last engine's own explanation (blocked network,
    // model download failure). It is the actionable half of the message, so
    // it must not be dropped in favour of the generic text.
    const msg = detail ? `${messages[code]} ${detail}` : messages[code];
    this.callbacks?.onVoiceError(msg);
    this.log(`ESCUDO VOZ: Detenido — ${msg}`, 'error');
  }

  private maybeAnalyzeVoiceFragment(text: string) {
    if (text.length < this.VOICE_MIN_FRAGMENT_LEN || text === this.lastVoiceAnalyzed) return;

    const now = Date.now();
    if (now - this.lastVoiceAnalysisAt < this.VOICE_ANALYSIS_COOLDOWN_MS) return;

    this.lastVoiceAnalysisAt = now;
    this.lastVoiceAnalyzed = text;
    const fragment = text.length > 200 ? text.slice(-200) : text;

    analyzeVoiceFragment(fragment, 'voice')
      .then((result) => {
        this.callbacks?.onVoiceRealtimeVerdict(result);
        const nowStr = new Date().toLocaleTimeString();
        this.callbacks?.onShieldStatusChange('voice', { scanning: true, lastScan: nowStr, lastThreatLevel: result.verdict });

        if (result.verdict !== 'SEGURO') {
          this.log(`VOZ LIVE [${result.verdict}]: ${result.riskScore}/100 — ${result.tactics[0] ?? 'patron detectado'}`, result.verdict === 'PELIGROSO' ? 'error' : 'warning');
          this.triggerThreatAlert(result, 'Patron sospechoso detectado en conversacion de voz', 'Voz');
        }
      })
      .catch((e) => {
        if (!isAnalysisAborted(e)) {
          this.log('VOZ: Un fragmento no pudo analizarse.', 'warning');
        }
      });
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
  triggerThreatAlert(result: ScamAnalysis, description: string, app: string) {
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
