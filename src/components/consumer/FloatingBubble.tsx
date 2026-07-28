import { Shield } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';

export function FloatingBubble() {
  const { isProtectionActive, shieldStatus } = useNadaStore();

  const isScanning = Object.values(shieldStatus).some((s) => s.scanning);

  if (!isProtectionActive) return null;

  return (
    <div
      className="fixed bottom-24 right-4 z-30 w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110"
      style={{
        background: 'var(--bg-card)',
        border: '2px solid var(--accent)',
        boxShadow: `0 0 ${isScanning ? '20px' : '10px'} var(--accent-glow)`,
        animation: isScanning ? 'pulse 2s infinite' : undefined,
      }}
      title={isScanning ? 'Escaneando...' : 'Proteccion activa'}
    >
      <Shield className="w-5 h-5" style={{ color: 'var(--accent)' }} />
      {isScanning && (
        <span
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
          style={{ background: 'var(--warning)', animation: 'pulse 1s infinite' }}
        />
      )}
    </div>
  );
}
