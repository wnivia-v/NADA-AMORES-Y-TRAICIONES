import { useNadaStore } from '@/store/useNadaStore';
import type { DailyThreatRecord } from '@/store/useNadaStore';

// =============================================================================
// ThreatChart — SVG mini trend chart (last 7 days)
// =============================================================================

export function ThreatChart() {
  const { dailyHistory, language } = useNadaStore();

  // Build last 7 days of data
  const days = getLast7Days(dailyHistory);
  const maxThreats = Math.max(1, ...days.map((d) => d.threats));
  const maxScans = Math.max(1, ...days.map((d) => d.scans));

  const chartW = 280;
  const chartH = 80;
  const padding = 4;
  const barWidth = (chartW - padding * 2) / 7 - 4;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
          {language === 'es' ? 'Ultimos 7 dias' : 'Last 7 days'}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
              {language === 'es' ? 'Escaneos' : 'Scans'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--danger)' }} />
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
              {language === 'es' ? 'Amenazas' : 'Threats'}
            </span>
          </div>
        </div>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${chartW} ${chartH + 20}`}
        className="overflow-visible"
      >
        {/* Grid lines */}
        {[0, 0.5, 1].map((pct) => (
          <line
            key={pct}
            x1={padding}
            y1={chartH * (1 - pct) + padding}
            x2={chartW - padding}
            y2={chartH * (1 - pct) + padding}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
        ))}

        {/* Bars */}
        {days.map((day, i) => {
          const x = padding + i * ((chartW - padding * 2) / 7) + 2;
          const scanH = (day.scans / maxScans) * (chartH - 10);
          const threatH = (day.threats / maxThreats) * (chartH - 10);

          return (
            <g key={day.date}>
              {/* Scan bar (background) */}
              <rect
                x={x}
                y={chartH - scanH + padding}
                width={barWidth}
                height={scanH}
                rx={2}
                fill="var(--accent)"
                opacity={0.3}
              />
              {/* Threat bar (foreground) */}
              {day.threats > 0 && (
                <rect
                  x={x}
                  y={chartH - threatH + padding}
                  width={barWidth}
                  height={threatH}
                  rx={2}
                  fill="var(--danger)"
                  opacity={0.8}
                />
              )}
              {/* Day label */}
              <text
                x={x + barWidth / 2}
                y={chartH + 16 + padding}
                textAnchor="middle"
                fontSize="8"
                fill="var(--text-muted)"
                fontFamily="monospace"
              >
                {day.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Get last 7 days with data, filling gaps with zeros
function getLast7Days(history: DailyThreatRecord[]): Array<DailyThreatRecord & { label: string }> {
  const result: Array<DailyThreatRecord & { label: string }> = [];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const existing = history.find((r) => r.date === dateKey);
    result.push({
      date: dateKey,
      threats: existing?.threats ?? 0,
      scans: existing?.scans ?? 0,
      label: dayNames[d.getDay()] ?? '',
    });
  }

  return result;
}
