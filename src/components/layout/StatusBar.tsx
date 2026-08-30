import { useNadaStore } from '@/store/useNadaStore';
import { hasWorkingProvider } from '@/services/aiProviders';
import type { LogType } from '@/store/useNadaStore';
import { useRef, useEffect, useState } from 'react';
import { AlertTriangle, Terminal, Cpu } from 'lucide-react';
import { AIConsolePanel } from '@/components/analysis/AIConsolePanel';

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
  const [activeConsoleTab, setActiveConsoleTab] = useState<'ias' | 'logs'>('ias');

  // Enabled, reachable, and still within its free-tier quota
  const anyProviderAvailable = hasWorkingProvider();

  useEffect(() => {
    if (scrollRef.current && activeConsoleTab === 'logs') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, activeConsoleTab]);

  return (
    <div
      className="border-t"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
    >
      {/* Degraded mode warning */}
      {!anyProviderAvailable && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b" style={{ background: 'var(--warning-light, rgba(255,170,0,0.1))', borderColor: 'var(--border)' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="text-[10px] font-medium" style={{ color: 'var(--warning)' }}>
            Modo degradado — Solo analisis local (sin IA). Configura una API key en Ajustes.
          </p>
        </div>
      )}

      {/* Console Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
            CONSOLA
          </span>

          {/* Toggle between Multi-AI Reasoning & System Logs */}
          <div className="flex gap-1 p-0.5 rounded-lg bg-black/40 border border-white/10">
            <button
              onClick={() => setActiveConsoleTab('ias')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1 ${
                activeConsoleTab === 'ias'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Cpu className="w-3 h-3" /> Razonamiento IAs (4 Columnas)
            </button>

            <button
              onClick={() => setActiveConsoleTab('logs')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1 ${
                activeConsoleTab === 'logs'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3 h-3" /> Logs ({logs.length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {anyProviderAvailable && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--success)' }}>
              AI OK
            </span>
          )}
          {activeConsoleTab === 'logs' && (
            <button
              onClick={clearLogs}
              className="text-xs cursor-pointer hover:underline flex items-center text-muted"
              aria-label="Limpiar consola"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Console Content */}
      <div className="p-3">
        {activeConsoleTab === 'ias' ? (
          /* Multi-AI Columns & Reasoning inside bottom CONSOLA */
          <AIConsolePanel />
        ) : (
          /* Logs View */
          <div ref={scrollRef} className="max-h-48 overflow-y-auto px-1 pb-1 space-y-0.5">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2 text-xs font-mono leading-relaxed">
                <span style={{ color: 'var(--text-muted)' }}>[{log.timestamp}]</span>
                <span style={{ color: typeColors[log.type] }}>{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
