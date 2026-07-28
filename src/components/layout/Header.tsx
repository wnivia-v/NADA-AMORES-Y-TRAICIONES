import { Shield, Bug } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';

export function Header() {
  const { theme, setTheme, language, activeTab, setActiveTab } = useNadaStore();
  const t = translations[language];

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b backdrop-blur-xl"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2">
        <Shield className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
          NADA
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full font-mono" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
          v2
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'velvet' ? 'gamer' : 'velvet')}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer transition-all hover:scale-105 min-w-[44px] min-h-[44px] flex items-center justify-center"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          aria-label={theme === 'velvet' ? 'Cambiar a tema Gamer' : 'Cambiar a tema Velvet'}
        >
          {theme === 'velvet' ? '🌸' : '🎮'}
        </button>

        {/* Debug mode toggle */}
        <button
          onClick={() => setActiveTab(activeTab === 'debug' ? 'home' : 'debug')}
          className={`p-2 rounded-lg border cursor-pointer transition-all hover:scale-105 min-w-[44px] min-h-[44px] flex items-center justify-center ${
            activeTab === 'debug' ? 'border-[var(--accent)]' : ''
          }`}
          style={{
            borderColor: activeTab === 'debug' ? 'var(--accent)' : 'var(--border)',
            color: activeTab === 'debug' ? 'var(--accent)' : 'var(--text-muted)',
          }}
          aria-label={t.debugMode}
          aria-pressed={activeTab === 'debug'}
        >
          <Bug className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
