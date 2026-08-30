import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// =============================================================================
// Tipos del Store
// =============================================================================

export type ActiveMode = 'TEXTO' | 'VOZ' | 'CAMARA' | 'CHAT' | 'CITAS';
export type Theme = 'velvet' | 'gamer';
export type Language = 'es' | 'en';
export type TabId = 'home' | 'alerts' | 'settings' | 'debug';
export type Verdict = 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO';
export type LogType = 'info' | 'success' | 'warning' | 'error' | 'system';
export type ShieldId = 'clipboard' | 'screen' | 'voice' | 'video';

export interface LogEntry {
  timestamp: string;
  message: string;
  type: LogType;
}

export interface AlertEntry {
  id: string;
  timestamp: string;
  verdict: Verdict;
  riskScore: number;
  description: string;
  detectedTactic: string | null;
  app: string;
}

export interface ShieldStatus {
  active: boolean;
  scanning: boolean;
  lastScan: string | null;
  scansCount: number;
  lastThreatLevel: Verdict | null;
}

export interface ScamAnalysis {
  verdict: Verdict;
  riskScore: number;
  tactics: string[];
  explanation: string;
  scanSource: 'local' | 'gemini' | 'hybrid';
  recommendations: string[];
}

// Daily threat tracking for trend chart
export interface DailyThreatRecord {
  date: string; // YYYY-MM-DD
  threats: number;
  scans: number;
}

// =============================================================================
// Estado
// =============================================================================

interface NadaState {
  // Modos y UI
  activeMode: ActiveMode;
  theme: Theme;
  language: Language;
  activeTab: TabId;

  // Analisis
  isAnalyzing: boolean;
  analysisResult: ScamAnalysis | null;

  // Metricas
  historyCount: number;
  threatsToday: number;
  dailyHistory: DailyThreatRecord[];

  // Proteccion
  isProtectionActive: boolean;
  shieldStatus: Record<ShieldId, ShieldStatus>;

  // Escudo de voz — estado global para que ConsumerHome y VoiceAnalyzer lean
  // exactamente lo mismo en vez de mantener cada uno su propia copia local
  // (eso era lo que producia el desincronizado "parece que escucha pero no").
  voiceTranscript: string;
  /** Not-yet-final words from the recognizer — shown live so the transcript
   *  panel proves it is listening instead of sitting blank until a full
   *  sentence finalizes (which can take many seconds, or never, depending on
   *  the recognizer's own end-of-speech detection). Never analyzed on its own. */
  voiceInterim: string;
  voiceRealtimeVerdict: ScamAnalysis | null;
  voiceSpeechActive: boolean;
  /** Set when the recognizer actually dies (permission denied, no mic, unsupported browser). */
  voiceError: string | null;

  // Escudo de video — estado global derivado del ultimo frame analizado,
  // visible aunque CameraAnalyzer no este montado.
  videoDeepfakeScore: number;
  videoLipSyncMeasured: boolean;

  // Alertas y Logs
  alerts: AlertEntry[];
  logs: LogEntry[];

  // Estado global Multi-IA en tiempo real (para la Consola inferior)
  multiAiActiveText: string;
  multiAiFinalProviderId: ProviderId | null;
  multiAiEvents: Record<string, any>;
}

interface NadaActions {
  setActiveMode: (mode: ActiveMode) => void;
  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Language) => void;
  setActiveTab: (tab: TabId) => void;
  setAnalyzing: (v: boolean) => void;
  setAnalysisResult: (result: ScamAnalysis | null) => void;
  setProtectionActive: (active: boolean) => void;
  addLog: (message: string, type?: LogType) => void;
  clearLogs: () => void;
  addAlert: (alert: Omit<AlertEntry, 'id' | 'timestamp'>) => void;
  clearAlerts: () => void;
  updateShieldStatus: (shield: ShieldId, status: Partial<ShieldStatus>) => void;
  resetSession: () => void;
  recordDailyScan: (isThreat: boolean) => void;
  setVoiceTranscript: (text: string) => void;
  setVoiceInterim: (text: string) => void;
  setVoiceRealtimeVerdict: (v: ScamAnalysis | null) => void;
  setVoiceSpeechActive: (active: boolean) => void;
  setVoiceError: (message: string | null) => void;
  resetVoiceSession: () => void;
  setVideoStatus: (score: number, lipSyncMeasured: boolean) => void;
  setMultiAiActiveText: (text: string) => void;
  updateMultiAiEvent: (event: any) => void;
  setMultiAiFinalProviderId: (id: any) => void;
  resetMultiAiEvents: (text: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

const timestamp = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Threats recorded for the current calendar day. */
const threatsForToday = (history: DailyThreatRecord[]): number =>
  history.find((r) => r.date === todayKey())?.threats ?? 0;



const DEFAULT_SHIELD: ShieldStatus = {
  active: false,
  scanning: false,
  lastScan: null,
  scansCount: 0,
  lastThreatLevel: null,
};

// =============================================================================
// Store with persist middleware (alerts, metrics, preferences)
// =============================================================================

export const useNadaStore = create<NadaState & NadaActions>()(
  persist(
    (set, get) => ({
      // Estado inicial
      activeMode: 'TEXTO',
      theme: 'velvet',
      language: 'es',
      activeTab: 'home',
      isAnalyzing: false,
      analysisResult: null,
      historyCount: 0,
      threatsToday: 0,
      dailyHistory: [],
      isProtectionActive: true,
      shieldStatus: {
        clipboard: { ...DEFAULT_SHIELD },
        screen: { ...DEFAULT_SHIELD },
        voice: { ...DEFAULT_SHIELD },
        video: { ...DEFAULT_SHIELD },
      },
      voiceTranscript: '',
      voiceInterim: '',
      voiceRealtimeVerdict: null,
      voiceSpeechActive: false,
      voiceError: null,
      videoDeepfakeScore: 0,
      videoLipSyncMeasured: false,

      // Alertas y Logs
      alerts: [],
      logs: [
        { timestamp: timestamp(), message: 'SISTEMA: Motor NADA v2 iniciado.', type: 'system' },
        { timestamp: timestamp(), message: 'MOTOR: Firmas de patrones cargadas.', type: 'info' },
      ],

      // Multi-IA tiempo real
      multiAiActiveText: '',
      multiAiFinalProviderId: null,
      multiAiEvents: {},

      // Acciones
      setActiveMode: (mode) => {
        set({ activeMode: mode });
        get().addLog(`MODO: Cambiado a ${mode}`, 'info');
      },

      setTheme: (theme) => {
        set({ theme });
        get().addLog(`TEMA: ${theme.toUpperCase()}`, 'system');
      },

      setLanguage: (language) => {
        set({ language });
      },

      setActiveTab: (tab) => {
        set({ activeTab: tab });
      },

      setAnalyzing: (v) => set({ isAnalyzing: v }),

      setAnalysisResult: (result) => {
        set({ analysisResult: result });
        if (result) {
          get().recordDailyScan(result.verdict !== 'SEGURO');
        }
      },

      setProtectionActive: (active) => {
        set({ isProtectionActive: active });
        get().addLog(`PROTECCION: ${active ? 'ACTIVADA' : 'DESACTIVADA'}`, active ? 'success' : 'warning');
      },

      addLog: (message, type = 'info') => {
        set((s) => ({
          logs: [...s.logs, { timestamp: timestamp(), message, type }],
        }));
      },

      clearLogs: () => set({ logs: [] }),

      addAlert: (alert) => {
        const entry: AlertEntry = {
          ...alert,
          id: crypto.randomUUID(),
          timestamp: new Date().toLocaleTimeString(),
        };
        set((s) => ({
          alerts: [entry, ...s.alerts].slice(0, 100),
        }));
        get().addLog(`ALERTA [${alert.verdict}] en ${alert.app}: ${alert.description}`, alert.verdict === 'PELIGROSO' ? 'error' : 'warning');
      },

      clearAlerts: () => {
        set({ alerts: [] });
        get().addLog('HISTORIAL: Alertas limpiadas.', 'system');
      },

      updateShieldStatus: (shield, status) => {
        set((s) => {
          const current = s.shieldStatus[shield];
          const updated = { ...current, ...status };
          if (status.lastScan && status.lastScan !== current.lastScan) {
            updated.scansCount = current.scansCount + 1;
          }
          return { shieldStatus: { ...s.shieldStatus, [shield]: updated } };
        });
      },

      resetSession: () => {
        set({
          analysisResult: null,
          isAnalyzing: false,
        });
        get().addLog('SESION: Reset de analisis.', 'system');
      },

      setVoiceTranscript: (text) => set({ voiceTranscript: text }),
      setVoiceInterim: (text) => set({ voiceInterim: text }),
      setVoiceRealtimeVerdict: (v) => set({ voiceRealtimeVerdict: v }),
      setVoiceSpeechActive: (active) => set({ voiceSpeechActive: active }),
      setVoiceError: (message) => set({ voiceError: message }),
      resetVoiceSession: () => set({ voiceTranscript: '', voiceInterim: '', voiceRealtimeVerdict: null, voiceSpeechActive: false, voiceError: null }),
      setVideoStatus: (score, lipSyncMeasured) => set({ videoDeepfakeScore: score, videoLipSyncMeasured: lipSyncMeasured }),

      setMultiAiActiveText: (text) => set({ multiAiActiveText: text }),

      resetMultiAiEvents: (text) => set({
        multiAiActiveText: text,
        multiAiFinalProviderId: null,
        multiAiEvents: {},
      }),

      updateMultiAiEvent: (event) => set((state) => ({
        multiAiEvents: {
          ...state.multiAiEvents,
          [event.providerId]: event,
        },
      })),

      setMultiAiFinalProviderId: (id) => set({ multiAiFinalProviderId: id }),

      recordDailyScan: (isThreat) => {
        set((s) => {
          const today = todayKey();
          const hasToday = s.dailyHistory.some((r) => r.date === today);
          const history: DailyThreatRecord[] = hasToday
            ? s.dailyHistory.map((r) =>
                r.date === today
                  ? { ...r, scans: r.scans + 1, threats: r.threats + (isThreat ? 1 : 0) }
                  : r,
              )
            : [...s.dailyHistory, { date: today, scans: 1, threats: isThreat ? 1 : 0 }];

          // Keep only last 30 days
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 30);
          const cutoffStr = cutoff.toISOString().slice(0, 10);
          const trimmed = history.filter((r) => r.date >= cutoffStr);

          return {
            dailyHistory: trimmed,
            // Derived from dailyHistory so the headline number can never drift
            // from the chart, and so "hoy" actually means today. It used to be
            // persisted and incremented forever, so yesterday's threats kept
            // being displayed as today's.
            threatsToday: threatsForToday(trimmed),
            // All-time scan count: incremented once per analysis, here only.
            historyCount: s.historyCount + 1,
          };
        });
      },
    }),
    {
      name: 'nada-store',
      storage: createJSONStorage(() => localStorage),
      // threatsToday is intentionally NOT persisted — it is derived from
      // dailyHistory on rehydration so it resets at the day boundary.
      partialize: (state) => ({
        alerts: state.alerts,
        historyCount: state.historyCount,
        dailyHistory: state.dailyHistory,
        theme: state.theme,
        language: state.language,
        isProtectionActive: state.isProtectionActive,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.threatsToday = threatsForToday(state.dailyHistory ?? []);
        }
      },
    },
  ),
);
