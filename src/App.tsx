import { useState, useCallback, useEffect } from 'react';
import { useNadaStore } from '@/store/useNadaStore';
import { Header } from '@/components/layout/Header';
import { StatusBar } from '@/components/layout/StatusBar';
import { ScanlineEffect } from '@/components/ui/ScanlineEffect';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { Onboarding } from '@/components/ui/Onboarding';
import { ConsentGate } from '@/components/ui/ConsentGate';
import { loadPolicy, needsConsent, retentionCutoff } from '@/services/policyService';
import { feedbackService } from '@/services/feedbackService';
import { syncPendingReports } from '@/services/feedbackSync';
import { verifyEmail } from '@/services/accountService';
import { TextAnalyzer } from '@/components/analysis/TextAnalyzer';
import { VoiceAnalyzer } from '@/components/analysis/VoiceAnalyzer';
import { CameraAnalyzer } from '@/components/analysis/CameraAnalyzer';
import { ImageAnalyzer } from '@/components/analysis/ImageAnalyzer';
import { notificationService } from '@/services/notificationService';
import { ConsumerHome } from '@/components/consumer/ConsumerHome';
import { AlertsView } from '@/components/consumer/AlertsView';
import { SettingsView } from '@/components/consumer/SettingsView';
import { FloatingBubble } from '@/components/consumer/FloatingBubble';
import { protectionEngine } from '@/services/protectionEngine';
import { videoShieldService } from '@/services/videoShieldService';
import { translations } from '@/utils/translations';
import { Home, Bell, Settings } from 'lucide-react';

type DebugMode = 'TEXTO' | 'VOZ' | 'CAMARA' | 'IMAGEN';

export default function App() {
  const {
    activeMode, theme, language, activeTab, setActiveTab,
    alerts, isProtectionActive, shieldStatus,
    addAlert, setAnalysisResult, addLog, updateShieldStatus,
    setVoiceTranscript, setVoiceInterim, setVoiceRealtimeVerdict, setVoiceSpeechActive, setVoiceError, setVideoStatus,
  } = useNadaStore();

  const t = translations[language];
  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('nada-onboarding-done');
  });
  /**
   * La politica se resuelve antes de enseñar nada que dependa de ella.
   *
   * 'loading' no es un estado decorativo: mientras no se sepa que pack rige,
   * tampoco se sabe si hay que pedir consentimiento ni con que texto. Enseñar
   * la app antes seria dar por hecho el permiso mas permisivo.
   */
  const [policy, setPolicy] = useState<'loading' | 'consent' | 'ready'>('loading');

  // Jurisdiction pack + consentimiento + retencion, en ese orden.
  useEffect(() => {
    let cancelled = false;

    void loadPolicy().then(() => {
      if (cancelled) return;

      // La retencion se aplica solo cuando el pack lo sirvio alguien de verdad;
      // retentionCutoff() devuelve null si no. Un fallo de red no puede
      // borrarle el historial a nadie.
      const cutoff = retentionCutoff();
      if (cutoff !== null) {
        useNadaStore.getState().pruneAlertsBefore(cutoff);
        void feedbackService.pruneBefore(cutoff);
      }

      setPolicy(needsConsent() ? 'consent' : 'ready');

      // Lo que quedo en cola de sesiones anteriores. syncPendingReports()
      // comprueba por su cuenta el consentimiento y la sesion, asi que llamarlo
      // sin mas es seguro: si falta algo, no manda nada.
      void syncPendingReports();
    });

    return () => { cancelled = true; };
  }, []);

  /**
   * Enlace de verificacion del correo: la app llega con ?token=... y lo canjea.
   *
   * El token se quita de la barra de direcciones en cuanto se usa. Un token de
   * un solo uso en el historial del navegador —o en el `Referer` de la
   * siguiente peticion— es un token compartido con mas gente de la que deberia.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return;

    void verifyEmail(token).then((result) => {
      addLog(
        result.ok ? 'CUENTA: correo verificado.' : `CUENTA: no se pudo verificar (${result.error}).`,
        result.ok ? 'success' : 'warning',
      );
      params.delete('token');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    });
  }, []);

  // Initialize protection engine and notifications
  useEffect(() => {
    notificationService.init();

    protectionEngine.init({
      onAlert: (alert) => addAlert(alert),
      onAnalysisResult: (result) => setAnalysisResult(result),
      onShieldStatusChange: (shield, status) => updateShieldStatus(shield, status as any),
      onNotification: (title, body) => {
        notificationService.send(title, body);
      },
      onLog: (message, type) => addLog(message, type),
      onVoiceTranscript: (text) => setVoiceTranscript(text),
      onVoiceInterim: (text) => setVoiceInterim(text),
      onVoiceRealtimeVerdict: (result) => setVoiceRealtimeVerdict(result),
      onVoiceSpeechActive: (active) => setVoiceSpeechActive(active),
      onVoiceError: (message) => setVoiceError(message),
      getLanguage: () => useNadaStore.getState().language,
    });

    videoShieldService.init({
      onAlert: (alert) => addAlert(alert),
      onAnalysisResult: (result) => setAnalysisResult(result),
      onShieldStatusChange: (status) => updateShieldStatus('video', status as any),
      onFrame: (score, lipSyncMeasured) => setVideoStatus(score, lipSyncMeasured),
      onLog: (message, type) => addLog(message, type),
      labelForSource: (source) => {
        const tt = translations[useNadaStore.getState().language];
        return source === 'call' ? tt.cameraSourceCall : tt.cameraSourceOwn;
      },
      getDeepfakeDetectedLabel: () => translations[useNadaStore.getState().language].deepfakeDetected,
    });
  }, []);

  // Start/stop engine when protection toggles
  useEffect(() => {
    if (isProtectionActive) {
      protectionEngine.start();
    } else {
      protectionEngine.stop();
    }
  }, [isProtectionActive]);

  // Electron always-on-top overlay: mirrors real protection state so it
  // never claims "protegido" when a shield actually stopped. Web/PWA has no
  // electronAPI, so these calls are no-ops there.
  useEffect(() => {
    (window as any).electronAPI?.setOverlayVisible?.(isProtectionActive);
  }, [isProtectionActive]);

  useEffect(() => {
    if (!isProtectionActive) return;
    const scanning = Object.values(shieldStatus).some((s) => s.scanning);
    const latestAlert = alerts[0] ?? null;
    (window as any).electronAPI?.updateOverlayStatus?.({
      active: true,
      scanning,
      verdict: latestAlert?.verdict ?? null,
    });
  }, [isProtectionActive, shieldStatus, alerts]);

  const handleSplashDone = useCallback(() => setShowSplash(false), []);
  const handleOnboardingDone = useCallback(() => setShowOnboarding(false), []);

  if (showSplash) {
    return (
      <div className={theme === 'velvet' ? 'theme-velvet' : 'theme-gamer'}>
        <SplashScreen onFinished={handleSplashDone} />
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <div className={theme === 'velvet' ? 'theme-velvet' : 'theme-gamer'}>
        <Onboarding onComplete={handleOnboardingDone} language={language} />
      </div>
    );
  }

  // Mientras se resuelve la politica no se enseña la app: no se sabe todavia
  // que hay que preguntar ni bajo que aviso.
  if (policy === 'loading') {
    return <div className={theme === 'velvet' ? 'theme-velvet' : 'theme-gamer'} style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />;
  }

  if (policy === 'consent') {
    return (
      <div className={theme === 'velvet' ? 'theme-velvet' : 'theme-gamer'}>
        <ConsentGate language={language} onDone={() => setPolicy('ready')} />
      </div>
    );
  }

  // Tab index for sliding indicator
  const tabIndex = activeTab === 'home' ? 0 : activeTab === 'alerts' ? 1 : 2;

  // Debug mode tabs including IMAGEN
  const debugModes: DebugMode[] = ['TEXTO', 'VOZ', 'CAMARA', 'IMAGEN'];

  return (
    <div className={`min-h-screen flex flex-col relative overflow-x-hidden transition-all duration-500 pb-24 md:pb-8 ${
      theme === 'velvet' ? 'theme-velvet' : 'theme-gamer'
    }`}>
      {theme === 'gamer' && <ScanlineEffect />}

      <Header />

      {/* Debug mode: technical dashboard */}
      {activeTab === 'debug' ? (
        <main className="flex-1 p-4 lg:p-6 max-w-4xl w-full mx-auto fade-slide-in">
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {debugModes.map((mode) => (
              <button
                key={mode}
                onClick={() => useNadaStore.getState().setActiveMode(mode as any)}
                className="px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap"
                style={{
                  background: activeMode === mode ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: activeMode === mode ? '#fff' : 'var(--text-secondary)',
                  boxShadow: activeMode === mode ? '0 0 12px var(--accent-glow)' : 'none',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
          {activeMode === 'TEXTO' && <TextAnalyzer />}
          {activeMode === 'VOZ' && <VoiceAnalyzer />}
          {activeMode === 'CAMARA' && <CameraAnalyzer />}
          {(activeMode as string) === 'IMAGEN' && <ImageAnalyzer />}
        </main>
      ) : (
        /* Consumer mode — no key prop to avoid unmounting on tab switch */
        <main className="flex-1 p-4 max-w-lg w-full mx-auto mt-2">
          <div className={activeTab === 'home' ? 'fade-slide-in' : 'hidden'}>
            <ConsumerHome />
          </div>
          <div className={activeTab === 'alerts' ? 'fade-slide-in' : 'hidden'}>
            <AlertsView />
          </div>
          <div className={activeTab === 'settings' ? 'fade-slide-in' : 'hidden'}>
            <SettingsView />
          </div>
        </main>
      )}

      {/* Floating bubble: visible on every section while protection is active,
          including the technical/debug tabs — leaving it tied to a single
          section made switching tabs look like protection had turned off. */}
      <FloatingBubble />

      {/* Bottom navigation (consumer mode only) */}
      {activeTab !== 'debug' && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-xl"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          aria-label="Navegacion principal"
        >
          <div className="relative flex justify-around py-3 px-6">
            {/* Sliding indicator */}
            <div
              className="absolute top-0 h-[3px] rounded-b-full transition-all duration-300"
              style={{
                width: '60px',
                left: `calc(${(tabIndex * 100) / 3}% + ${100 / 6}% - 30px)`,
                background: 'var(--accent)',
                boxShadow: `0 0 12px var(--accent-glow)`,
              }}
            />

            <button
              onClick={() => setActiveTab('home')}
              className="flex flex-col items-center gap-1 cursor-pointer transition-all min-w-[44px] min-h-[44px] justify-center"
              style={{ color: activeTab === 'home' ? 'var(--accent)' : 'var(--text-muted)' }}
              aria-label={t.tabHome}
              aria-current={activeTab === 'home' ? 'page' : undefined}
            >
              <Home className="w-5 h-5" aria-hidden="true" />
              <span className="text-[10px] font-bold">{t.tabHome}</span>
            </button>

            <button
              onClick={() => setActiveTab('alerts')}
              className="flex flex-col items-center gap-1 cursor-pointer transition-all relative min-w-[44px] min-h-[44px] justify-center"
              style={{ color: activeTab === 'alerts' ? 'var(--accent)' : 'var(--text-muted)' }}
              aria-label={`${t.tabAlerts}${alerts.length > 0 ? ` (${alerts.length})` : ''}`}
              aria-current={activeTab === 'alerts' ? 'page' : undefined}
            >
              <Bell className="w-5 h-5" aria-hidden="true" />
              <span className="text-[10px] font-bold">{t.tabAlerts}</span>
              {alerts.length > 0 && (
                <span
                  className="absolute -top-1 -right-2 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white animate-pulse"
                  style={{ background: 'var(--danger)' }}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {alerts.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className="flex flex-col items-center gap-1 cursor-pointer transition-all min-w-[44px] min-h-[44px] justify-center"
              style={{ color: activeTab === 'settings' ? 'var(--accent)' : 'var(--text-muted)' }}
              aria-label={t.tabSettings}
              aria-current={activeTab === 'settings' ? 'page' : undefined}
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
              <span className="text-[10px] font-bold">{t.tabSettings}</span>
            </button>
          </div>
        </nav>
      )}

      {/* Status bar (debug mode only) */}
      {activeTab === 'debug' && <StatusBar />}
    </div>
  );
}
