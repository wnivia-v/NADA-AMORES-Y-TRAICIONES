import { useNadaStore } from '@/store/useNadaStore';
import { hasWorkingProvider } from '@/services/aiProviders';
import type { LogType } from '@/store/useNadaStore';
import { useRef, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

const typeColors: Record<LogType, string> = {
  info: 'var(--text-secondary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
  system: 'var(--accent)',
};

export function StatusBar() {
  const { logs, clearLogs } = useNadaStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Enabled, reachable, and still within its free-tier quota
  const anyProviderAvailable = hasWorkingProvider();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      className="border-t"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
    >
      {/* Degraded mode warning */}
      {!anyProviderAvailable && (
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ background: 'var(--warning-light, rgba(255,170,0,0.1))', borderColor: 'var(--border)' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="text-[10px] font-medium" style={{ color: 'var(--warning)' }}>
            Modo degradado — Solo analisis local (sin IA). Configura una API key en Ajustes.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>
          CONSOLA
        </span>
        <div className="flex items-center gap-3">
          {anyProviderAvailable && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--success)' }}>
              AI OK
            </span>
          )}
          <button
            onClick={clearLogs}
            className="text-xs cursor-pointer hover:underline min-h-[44px] flex items-center"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Limpiar consola"
          >
            Limpiar
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="max-h-40 overflow-y-auto px-4 pb-3 space-y-0.5">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2 text-xs font-mono leading-relaxed">
            <span style={{ color: 'var(--text-muted)' }}>[{log.timestamp}]</span>
            <span style={{ color: typeColors[log.type] }}>{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
