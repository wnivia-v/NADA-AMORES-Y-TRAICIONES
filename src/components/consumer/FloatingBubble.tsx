import { Shield } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';

/**
 * Escudo flotante persistente.
 *
 * Es el único elemento visible en todas las secciones mientras la protección
 * está activa, así que es donde el usuario va a tocar cuando quiere ver qué
 * detectó — sobre todo si acaba de escuchar el tono de alerta. Antes era un
 * botón sin `onClick`: se veía pulsable, se sentía pulsable y no hacía nada,
 * que en una herramienta de seguridad se lee como "la app se colgó".
 *
 * Ahora lleva directo a las alertas y muestra cuántas hay.
 */
export function FloatingBubble() {
  const { isProtectionActive, shieldStatus, alerts, activeTab, setActiveTab, language } = useNadaStore();
  const t = translations[language];

  const isScanning = Object.values(shieldStatus).some((s) => s.scanning);
  const alertCount = alerts.length;

  if (!isProtectionActive) return null;

  // Ya estando en alertas el botón no tiene a dónde llevar; el indicador de
  // escaneo sigue siendo útil, pero no debe aparentar ser pulsable.
  const isOnAlerts = activeTab === 'alerts';

  const label = isOnAlerts
    ? isScanning
      ? t.scanning
      : t.protectionOn
    : `${t.tabAlerts}${alertCount > 0 ? ` (${alertCount})` : ''}`;

  return (
    <button
      type="button"
      onClick={() => setActiveTab('alerts')}
      disabled={isOnAlerts}
      aria-label={label}
      title={label}
      className="fixed bottom-24 right-4 z-30 min-w-[44px] min-h-[44px] w-12 h-12 rounded-full flex items-center justify-center transition-all enabled:cursor-pointer enabled:hover:scale-110 enabled:active:scale-95"
      style={{
        background: 'var(--bg-card)',
        border: `2px solid ${alertCount > 0 ? 'var(--danger)' : 'var(--accent)'}`,
        boxShadow: `0 0 ${isScanning ? '20px' : '10px'} ${alertCount > 0 ? 'var(--danger)' : 'var(--accent-glow)'}`,
        animation: isScanning ? 'pulse 2s infinite' : undefined,
      }}
    >
      <Shield
        className="w-5 h-5"
        style={{ color: alertCount > 0 ? 'var(--danger)' : 'var(--accent)' }}
        aria-hidden="true"
      />

      {alertCount > 0 ? (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
          style={{ background: 'var(--danger)' }}
          aria-hidden="true"
        >
          {alertCount > 99 ? '99+' : alertCount}
        </span>
      ) : (
        isScanning && (
          <span
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
            style={{ background: 'var(--warning)', animation: 'pulse 1s infinite' }}
            aria-hidden="true"
          />
        )
      )}
    </button>
  );
}
