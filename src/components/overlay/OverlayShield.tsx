import { useEffect, useState } from 'react';
import { Shield, AlertTriangle } from 'lucide-react';

// Minimal renderer for the Electron always-on-top overlay window. Loaded via
// main.tsx when the page is opened with ?overlay=1 — a separate, tiny React
// tree with no store, no router, no shields of its own. It only mirrors
// status pushed from the main window over IPC (see electron/main.cts and
// App.tsx's overlay useEffects) and, on click, brings the main window to
// front so the user can act deliberately instead of a stray tap on a 64x64
// bubble accidentally turning protection off.
interface OverlayStatus {
  active: boolean;
  scanning: boolean;
  verdict: 'SEGURO' | 'SOSPECHOSO' | 'PELIGROSO' | null;
}

const VERDICT_COLOR: Record<string, string> = {
  SOSPECHOSO: '#FFC53D',
  PELIGROSO: '#FF4D6D',
};

const DEFAULT_STATUS: OverlayStatus = { active: true, scanning: false, verdict: null };

export function OverlayShield() {
  const [status, setStatus] = useState<OverlayStatus>(DEFAULT_STATUS);

  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.onOverlayStatus?.((s: OverlayStatus) => setStatus(s));
  }, []);

  const alertColor = status.verdict && status.verdict !== 'SEGURO' ? VERDICT_COLOR[status.verdict] : null;
  const color = alertColor ?? '#22D3EE';
  const pulsing = Boolean(alertColor) || status.scanning;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => (window as any).electronAPI?.focusMainWindow?.()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') (window as any).electronAPI?.focusMainWindow?.(); }}
      title="NADA — Proteccion activa. Clic para abrir."
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(6,8,16,0.90)',
        borderRadius: '50%',
        border: `2px solid ${color}`,
        boxShadow: `0 0 ${pulsing ? '18px' : '8px'} ${color}`,
        cursor: 'pointer',
        animation: pulsing ? 'nada-overlay-pulse 1.4s infinite' : undefined,
      }}
    >
      <style>{`
        @keyframes nada-overlay-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
      `}</style>
      {alertColor
        ? <AlertTriangle size={22} color={color} aria-hidden="true" />
        : <Shield size={22} color={color} aria-hidden="true" />}
    </div>
  );
}
