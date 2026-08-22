import { useState, useEffect } from 'react';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';
import { getProvidersStatus, getProviderConfig, saveProviderConfig } from '@/services/aiProviders';
import type { ProviderStrategy, ProviderId, ProviderCost } from '@/services/aiProviders';
import { Palette, Globe, Code, Brain, Zap, Shield, Layers, Laptop, Cloud, CreditCard } from 'lucide-react';
import { PrivacyPanel } from './PrivacyPanel';

const STRATEGY_INFO: Record<ProviderStrategy, { icon: typeof Zap; label: string; desc: string }> = {
  fallback: { icon: Shield, label: 'Fallback', desc: 'Intenta el siguiente si falla' },
  race: { icon: Zap, label: 'Carrera', desc: 'El mas rapido responde' },
  'best-result': { icon: Layers, label: 'Mejor resultado', desc: 'Consulta todos, elige el mejor' },
  consensus: { icon: Brain, label: 'Consenso', desc: 'Mayoria de IAs decide' },
};

/**
 * How each provider is paid for, shown next to its name.
 *
 * The point is that the user can see at a glance that NADA works without paying
 * anything, and can tell which options would send their messages to a third
 * party or cost them money.
 */
const COST_INFO: Record<ProviderCost, { icon: typeof Laptop; es: string; en: string; color: string }> = {
  'free-local': { icon: Laptop, es: 'Gratis · en tu equipo', en: 'Free · on your device', color: 'var(--success)' },
  'free-tier': { icon: Cloud, es: 'Gratis · con limite', en: 'Free · rate limited', color: 'var(--accent)' },
  paid: { icon: CreditCard, es: 'Requiere pago', en: 'Requires payment', color: 'var(--warning)' },
};

export function SettingsView() {
  const { theme, setTheme, language, setLanguage, activeTab, setActiveTab } = useNadaStore();
  const t = translations[language];

  const [providers, setProviders] = useState(getProvidersStatus());
  const [config, setConfig] = useState(getProviderConfig());

  // Refresh provider status
  useEffect(() => {
    setProviders(getProvidersStatus());
    setConfig(getProviderConfig());
  }, []);

  const toggleProvider = (id: ProviderId) => {
    const updated = {
      ...config,
      providers: {
        ...config.providers,
        [id]: { ...config.providers[id], enabled: !config.providers[id].enabled },
      },
    };
    setConfig(updated);
    saveProviderConfig(updated);
    setProviders(getProvidersStatus());
  };

  const setStrategy = (strategy: ProviderStrategy) => {
    const updated = { ...config, strategy };
    setConfig(updated);
    saveProviderConfig(updated);
  };

  return (
    <div className="space-y-4 fade-slide-in">
      <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t.settingsTitle}</h2>

      {/* AI Providers */}
      <div className="card p-4">
        <div className="flex items-center gap-3 mb-3">
          <Brain className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t.aiProviders}
          </span>
        </div>

        {/* Provider list */}
        <div className="space-y-2 mb-4">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between p-3 rounded-lg"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {provider.name}
                </p>

                {/* Cost, so nothing bills the user by surprise */}
                <div className="flex items-center gap-1 mt-0.5">
                  {(() => {
                    const cost = COST_INFO[provider.cost];
                    const CostIcon = cost.icon;
                    return (
                      <>
                        <CostIcon className="w-3 h-3 shrink-0" style={{ color: cost.color }} />
                        <span className="text-[10px]" style={{ color: cost.color }}>
                          {language === 'es' ? cost.es : cost.en}
                        </span>
                      </>
                    );
                  })()}
                </div>

                <p className="text-[10px] mt-0.5" style={{ color: provider.available ? 'var(--text-muted)' : 'var(--warning)' }}>
                  {provider.available
                    ? provider.quota
                      ? language === 'es'
                        ? `Quedan ${provider.quota.dayRemaining} consultas hoy`
                        : `${provider.quota.dayRemaining} requests left today`
                      : language === 'es'
                        ? 'Sin limite de consultas'
                        : 'No request limit'
                    : provider.cost === 'free-local'
                      ? language === 'es'
                        ? 'Modelo no disponible'
                        : 'Model unavailable'
                      : language === 'es'
                        ? 'Falta configurar la clave'
                        : 'API key not configured'}
                </p>
              </div>
              <button
                onClick={() => toggleProvider(provider.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all ${
                  provider.enabled ? '' : 'opacity-50'
                }`}
                style={{
                  background: provider.enabled ? 'var(--accent)' : 'var(--bg-primary)',
                  color: provider.enabled ? 'var(--bg-primary)' : 'var(--text-muted)',
                  border: provider.enabled ? 'none' : '1px solid var(--border)',
                }}
              >
                {provider.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </div>

        {/* Strategy selector */}
        <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            {t.multiAiStrategy}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(STRATEGY_INFO) as Array<[ProviderStrategy, typeof STRATEGY_INFO['fallback']]>).map(([key, info]) => {
              const Icon = info.icon;
              const isActive = config.strategy === key;
              return (
                <button
                  key={key}
                  onClick={() => setStrategy(key)}
                  className="p-2 rounded-lg text-center cursor-pointer transition-all"
                  style={{
                    background: isActive ? 'var(--accent-light)' : 'var(--bg-elevated)',
                    border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                  }}
                >
                  <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <p className="text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>{info.label}</p>
                  <p className="text-[8px]" style={{ color: 'var(--text-muted)' }}>{info.desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="card p-4">
        <div className="flex items-center gap-3 mb-3">
          <Palette className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t.theme}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setTheme('velvet')}
            className={`p-3 rounded-lg text-sm font-medium text-center cursor-pointer transition-all ${
              theme === 'velvet' ? 'ring-2' : ''
            }`}
            style={{ background: theme === 'velvet' ? 'var(--accent-light)' : 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          >
            Velvet
          </button>
          <button
            onClick={() => setTheme('gamer')}
            className={`p-3 rounded-lg text-sm font-medium text-center cursor-pointer transition-all ${
              theme === 'gamer' ? 'ring-2 ring-[var(--accent)]' : ''
            }`}
            style={{ background: theme === 'gamer' ? 'var(--accent-light)' : 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          >
            Gamer
          </button>
        </div>
      </div>

      {/* Language */}
      <div className="card p-4">
        <div className="flex items-center gap-3 mb-3">
          <Globe className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t.language}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setLanguage('es')}
            className={`p-3 rounded-lg text-sm font-medium text-center cursor-pointer transition-all ${language === 'es' ? 'ring-2 ring-[var(--accent)]' : ''}`}
            style={{ background: language === 'es' ? 'var(--accent-light)' : 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          >
            Espanol
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`p-3 rounded-lg text-sm font-medium text-center cursor-pointer transition-all ${language === 'en' ? 'ring-2 ring-[var(--accent)]' : ''}`}
            style={{ background: language === 'en' ? 'var(--accent-light)' : 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          >
            English
          </button>
        </div>
      </div>

      {/* Debug mode */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Code className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t.debugMode}</span>
          </div>
          <button
            onClick={() => setActiveTab(activeTab === 'debug' ? 'home' : 'debug')}
            className="px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all hover:scale-105"
            style={{
              background: activeTab === 'debug' ? 'var(--accent)' : 'var(--bg-elevated)',
              color: activeTab === 'debug' ? 'var(--bg-primary)' : 'var(--text-secondary)',
            }}
          >
            {activeTab === 'debug' ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Privacidad: retirar el consentimiento y borrar lo guardado. */}
      <PrivacyPanel />

      {/* About */}
      <div className="card p-4 text-center">
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          NADA Amores y Traiciones v2.0.0
        </p>
        <p className="text-[9px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Multi-AI: Gemini + Claude + AWS Bedrock
        </p>
      </div>
    </div>
  );
}
