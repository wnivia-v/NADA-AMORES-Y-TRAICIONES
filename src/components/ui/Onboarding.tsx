import { useState } from 'react';
import { Shield, Clipboard, Camera, ChevronRight, Check } from 'lucide-react';

interface OnboardingProps {
  onComplete: () => void;
  language: 'es' | 'en';
}

const STEPS_ES = [
  {
    icon: Shield,
    title: 'Bienvenido a NADA',
    description: 'Tu escudo contra estafas, fraudes romanticos y manipulacion. NADA analiza textos, llamadas e imagenes en tiempo real para protegerte.',
    detail: 'Funciona con multiples IAs (Gemini, Claude, Bedrock) para darte la mejor proteccion posible.',
  },
  {
    icon: Clipboard,
    title: 'Proteccion automatica',
    description: 'Al activar la proteccion, NADA monitorea tu portapapeles y pantalla en segundo plano.',
    detail: 'Cada vez que copies un mensaje sospechoso, se analizara automaticamente y recibiras una alerta si hay peligro.',
  },
  {
    icon: Camera,
    title: 'Analiza lo que quieras',
    description: 'Pega texto, graba una llamada, sube una captura de pantalla o activa la camara para detectar deepfakes.',
    detail: 'Todo se analiza localmente primero y luego con IA para maximo rendimiento y privacidad.',
  },
];

const STEPS_EN = [
  {
    icon: Shield,
    title: 'Welcome to NADA',
    description: 'Your shield against scams, romance fraud, and manipulation. NADA analyzes texts, calls, and images in real-time to protect you.',
    detail: 'Powered by multiple AIs (Gemini, Claude, Bedrock) for the best protection possible.',
  },
  {
    icon: Clipboard,
    title: 'Automatic protection',
    description: 'When protection is active, NADA monitors your clipboard and screen in the background.',
    detail: 'Every time you copy a suspicious message, it will be automatically analyzed and you\'ll get an alert if there\'s danger.',
  },
  {
    icon: Camera,
    title: 'Analyze anything',
    description: 'Paste text, record a call, upload a screenshot, or use your camera to detect deepfakes.',
    detail: 'Everything is analyzed locally first, then with AI for maximum performance and privacy.',
  },
];

export function Onboarding({ onComplete, language }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const steps = language === 'es' ? STEPS_ES : STEPS_EN;
  const current = steps[step];

  if (!current) return null;

  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  const handleNext = () => {
    if (isLast) {
      // Mark onboarding as complete
      localStorage.setItem('nada-onboarding-done', 'true');
      onComplete();
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('nada-onboarding-done', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-6" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-sm w-full text-center space-y-8">
        {/* Step indicator */}
        <div className="flex justify-center gap-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === step ? '24px' : '8px',
                background: i === step ? 'var(--accent)' : 'var(--border)',
              }}
            />
          ))}
        </div>

        {/* Icon */}
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mx-auto"
          style={{ background: 'var(--accent-light)', boxShadow: '0 0 40px var(--accent-glow)' }}
        >
          <Icon className="w-12 h-12" style={{ color: 'var(--accent)' }} />
        </div>

        {/* Content */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {current.title}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {current.description}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {current.detail}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleNext}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-bold"
          >
            {isLast ? (
              <>
                <Check className="w-4 h-4" />
                {language === 'es' ? 'Comenzar' : 'Get started'}
              </>
            ) : (
              <>
                {language === 'es' ? 'Siguiente' : 'Next'}
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>

          {!isLast && (
            <button
              onClick={handleSkip}
              className="text-xs cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              {language === 'es' ? 'Saltar tutorial' : 'Skip tutorial'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
