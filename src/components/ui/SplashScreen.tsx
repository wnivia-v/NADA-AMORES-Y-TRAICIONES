import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';

interface SplashScreenProps {
  onFinished: () => void;
}

const LOAD_STEPS = [
  'Cargando motor de patrones...',
  'Inicializando escudos...',
  'Conectando con IA...',
  'Listo.',
];

export function SplashScreen({ onFinished }: SplashScreenProps) {
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        const next = p + 3;
        // Update step label based on progress
        setStepIdx(Math.min(Math.floor((next / 100) * LOAD_STEPS.length), LOAD_STEPS.length - 1));
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(onFinished, 400);
          return 100;
        }
        return next;
      });
    }, 45);
    return () => clearInterval(interval);
  }, [onFinished]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-8"
      style={{
        background: 'var(--bg-primary)',
        backgroundImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, var(--accent-light) 0%, transparent 70%)',
      }}
    >
      {/* Logo */}
      <div className="splash-logo flex flex-col items-center gap-4">
        {/* Shield with gradient glow */}
        <div
          className="relative w-24 h-24 rounded-3xl flex items-center justify-center"
          style={{
            background: 'var(--gradient-hero)',
            boxShadow: '0 0 60px var(--accent-glow), 0 8px 32px rgba(0,0,0,0.18)',
          }}
        >
          <Shield className="w-12 h-12 text-white drop-shadow-lg" aria-hidden="true" />
          {/* Inner shine */}
          <div
            className="absolute inset-0 rounded-3xl"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, transparent 60%)',
              pointerEvents: 'none',
            }}
          />
        </div>

        <div className="text-center">
          <h1
            className="text-3xl font-black tracking-tight leading-none"
            style={{ color: 'var(--text-primary)' }}
          >
            NADA
          </h1>
          <p
            className="text-sm font-medium mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            Amores y Traiciones — Scam Shield
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-56 space-y-3">
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--border)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-100"
            style={{
              width: `${progress}%`,
              background: 'var(--gradient-hero)',
              boxShadow: '0 0 8px var(--accent-glow)',
            }}
          />
        </div>
        <p
          className="text-xs font-mono text-center transition-all duration-300"
          style={{ color: 'var(--text-muted)' }}
        >
          {LOAD_STEPS[stepIdx]}
        </p>
      </div>

      {/* Version pill */}
      <div className="pill-premium absolute bottom-8 px-3 py-1 rounded-full text-xs font-mono font-semibold tracking-wide">
        v2.0
      </div>
    </div>
  );
}
