import { useState, useCallback, useEffect } from 'react';
import { useNadaStore } from '@/store/useNadaStore';
import { Header } from '@/components/layout/Header';
import { StatusBar } from '@/components/layout/StatusBar';
import { ScanlineEffect } from '@/components/ui/ScanlineEffect';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { Onboarding } from '@/components/ui/Onboarding';
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
import { translations } from '@/utils/translations';
import { Home, Bell, Settings } from 'lucide-react';

type DebugMode = 'TEXTO' | 'VOZ' | 'CAMARA' | 'IMAGEN';

export default function App() {
  const {
    activeMode, theme, language, activeTab, setActiveTab,
    alerts, isProtectionActive,
    addAlert, setAnalysisResult, addLog, updateShieldStatus,
  } = useNadaStore();

  const t = translations[language];
  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('nada-onboarding-done');
  });

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

  // Tab index for sliding indicator
  const tabIndex = activeTab === 'home' ? 0 : activeTab === 'alerts' ? 1 : 2;

  // Debug mode tabs including IMAGEN
  const debugModes: DebugMode[] = ['TEXTO', 'VOZ', 'CAMARA', 'IMAGEN'];

  return (
    <div className={`min-h-screen flex flex-col relative overflow-x-hidden transition-all duration-500 pb-20 md:pb-6 ${
      theme === 'velvet' ? 'theme-velvet' : 'theme-gamer'
    }`}>
      {theme === 'gamer' && <ScanlineEffect />}

      <Header />

      {/* Debug mode: technical dashboard */}
      {activeTab === 'debug' ? (
        <main className="flex-1 p-4 lg:p-6 max-w-4xl w-full mx-auto fade-slide-in" key="debug">
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {debugModes.map((mode) => (
              <button
                key={mode}
                onClick={() => useNadaStore.getState().setActiveMode(mode as any)}
                className="px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap"
                style={{
                  background: activeMode === mode ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: activeMode === mode ? 'var(--bg-primary)' : 'var(--text-secondary)',
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
        /* Consumer mode */
        <main className="flex-1 p-4 max-w-lg w-full mx-auto mt-2 fade-slide-in" key={`consumer-${activeTab}`}>
          {activeTab === 'home' && <ConsumerHome />}
          {activeTab === 'alerts' && <AlertsView />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      )}

      {/* Floating bubble (consumer mode only) */}
      {activeTab !== 'debug' && <FloatingBubble />}

      {/* Bottom navigation (consumer mode only) */}
      {activeTab !== 'debug' && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-xl"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
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
              className="flex flex-col items-center gap-1 cursor-pointer transition-all"
              style={{ color: activeTab === 'home' ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              <Home className="w-5 h-5" />
              <span className="text-[10px] font-bold">{t.tabHome}</span>
            </button>

            <button
              onClick={() => setActiveTab('alerts')}
              className="flex flex-col items-center gap-1 cursor-pointer transition-all relative"
              style={{ color: activeTab === 'alerts' ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              <Bell className="w-5 h-5" />
              <span className="text-[10px] font-bold">{t.tabAlerts}</span>
              {alerts.length > 0 && (
                <span className="absolute -top-1 -right-2 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white animate-pulse" style={{ background: 'var(--danger)' }}>
                  {alerts.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className="flex flex-col items-center gap-1 cursor-pointer transition-all"
              style={{ color: activeTab === 'settings' ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              <Settings className="w-5 h-5" />
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
