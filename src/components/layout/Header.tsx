import { Shield, ArrowLeft, Bug } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';

export function Header() {
  const { theme, setTheme, language, activeTab, setActiveTab } = useNadaStore();
  const t = translations[language];
  const isDebug = activeTab === 'debug';

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b backdrop-blur-xl"
      style={{
        background: 'var(--header-bg, var(--bg-card))',
        borderColor: 'var(--border)',
        boxShadow: '0 1px 20px rgba(0,0,0,0.08)',
      }}
    >
      {/* Left: Logo or Back Button */}
      <div className="flex items-center gap-2">
        {isDebug ? (
          /* Back button — prominent in debug mode */
          <button
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all hover:scale-105 active:scale-95"
            style={{
              background: 'var(--accent-light)',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
            }}
            aria-label="Volver al inicio"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-bold hidden sm:inline">Volver</span>
          </button>
        ) : (
          /* Logo */
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}
            >
              <Shield className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-black text-base tracking-tight" style={{ color: 'var(--text-primary)' }}>
                NADA
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold"
                style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
              >
                v2
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Center: Mode label in debug */}
      {isDebug && (
        <div className="flex items-center gap-1.5">
          <Bug className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
            Modo Análisis
          </span>
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'velvet' ? 'gamer' : 'velvet')}
          className="w-9 h-9 text-sm rounded-xl border cursor-pointer transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
          aria-label={theme === 'velvet' ? 'Cambiar a tema Gamer' : 'Cambiar a tema Velvet'}
          title={theme === 'velvet' ? 'Tema Gamer 🎮' : 'Tema Velvet 🌸'}
        >
          {theme === 'velvet' ? '🌸' : '🎮'}
        </button>

        {/* Debug mode toggle — only visible in consumer mode */}
        {!isDebug && (
          <button
            onClick={() => setActiveTab('debug')}
            className="w-9 h-9 rounded-xl border cursor-pointer transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
            }}
            aria-label={t.debugMode}
            title="Modo análisis avanzado"
          >
            <Bug className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
