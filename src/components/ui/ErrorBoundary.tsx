import { Component, type ReactNode } from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[NADA] Error boundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleFullReset = () => {
    // Clear persisted state and reload
    try {
      localStorage.removeItem('nada-store');
      localStorage.removeItem('nada-ai-config');
    } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-primary, #0A0E17)' }}>
          <div className="max-w-sm w-full text-center space-y-6">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
              style={{ background: 'rgba(255,70,70,0.1)' }}
            >
              <ShieldAlert className="w-10 h-10" style={{ color: '#ff4646' }} />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-bold" style={{ color: '#f0f0f0' }}>
                Algo salio mal
              </h1>
              <p className="text-sm" style={{ color: '#888' }}>
                NADA encontro un error inesperado. Tu proteccion sigue activa en segundo plano.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 rounded-lg text-left" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <p className="text-[10px] font-mono break-all" style={{ color: '#666' }}>
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={this.handleReset}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm cursor-pointer"
                style={{ background: '#6C5CE7', color: '#fff' }}
              >
                <RotateCcw className="w-4 h-4" />
                Reintentar
              </button>
              <button
                onClick={this.handleFullReset}
                className="text-xs cursor-pointer"
                style={{ color: '#666' }}
              >
                Resetear y recargar
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
