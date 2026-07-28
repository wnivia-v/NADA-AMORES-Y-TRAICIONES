import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';

interface SplashScreenProps {
  onFinished: () => void;
}

export function SplashScreen({ onFinished }: SplashScreenProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          setTimeout(onFinished, 300);
          return 100;
        }
        return p + 4;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [onFinished]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6" style={{ background: 'var(--bg-primary)' }}>
      <div className="splash-logo relative">
        <Shield className="w-20 h-20" style={{ color: 'var(--accent)' }} />
      </div>
      <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        NADA
      </h1>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Amores y Traiciones — Scam Shield v2
      </p>
      <div className="w-48 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{ width: `${progress}%`, background: 'var(--accent)' }}
        />
      </div>
      <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
        Cargando motor de proteccion...
      </p>
    </div>
  );
}
