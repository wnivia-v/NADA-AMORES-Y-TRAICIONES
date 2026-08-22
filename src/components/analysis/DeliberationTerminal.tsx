// =============================================================================
// Terminal de deliberacion — que dijo cada IA, y por que gano una
//
// Esto no es un panel de depuracion. Es el sitio donde se puede comprobar que
// el resultado se sostiene: si tres modelos coincidieron o si dos estaban
// caidos y contesto uno, el veredicto se parece pero no vale lo mismo, y sin
// esta vista esa diferencia no se ve por ninguna parte.
//
// Se reparte en tantas columnas como IAs hayan participado. Las apagadas no
// ocupan panel: salen en una linea al pie, porque su ausencia tambien explica
// por que hubo poca deliberacion.
//
// El texto que devuelve un modelo es texto que ese modelo escribio DESPUES de
// leer el mensaje del atacante. React lo escapa, asi que no hay riesgo de
// inyeccion en la pagina, pero sigue siendo contenido no fiable y por eso se
// pinta en su propio marco, en monoespaciada y rotulado — para que se lea como
// una cita, no como una conclusion de NADA.
// =============================================================================

import { useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import type {
  Deliberation,
  DecisionReason,
  ProviderRun,
  ProviderOutcome,
  Suspicion,
} from '@/shared/llm/deliberation';

interface Props {
  deliberation: Deliberation;
}

/** Como se pinta cada final. El color es informacion, no decoracion. */
const OUTCOME: Record<ProviderOutcome, { label: string; color: string; glyph: string }> = {
  answered:       { label: 'respondio',      color: 'var(--success)', glyph: '●' },
  rejected:       { label: 'fuera de esquema', color: 'var(--danger)', glyph: '✕' },
  abstained:      { label: 'se abstuvo',     color: 'var(--text-muted)', glyph: '○' },
  failed:         { label: 'fallo',          color: 'var(--danger)', glyph: '✕' },
  timeout:        { label: 'se paso de tiempo', color: 'var(--warning)', glyph: '⏱' },
  'no-quota':     { label: 'sin cuota',      color: 'var(--warning)', glyph: '∅' },
  unavailable:    { label: 'sin configurar', color: 'var(--text-muted)', glyph: '⚙' },
  disabled:       { label: 'apagada',        color: 'var(--text-muted)', glyph: '·' },
  'still-running':{ label: 'aun pensando',   color: 'var(--accent)', glyph: '…' },
  'not-reached':  { label: 'no se llamo',    color: 'var(--text-muted)', glyph: '–' },
};

/**
 * El fallo, en una frase comprobable.
 *
 * Cada rama saca sus propios numeros del acta. No hay ninguna frase generica:
 * si dice "consenso" tiene que poder decir quienes y cuantos hacian falta.
 */
function explainReason(reason: DecisionReason, winnerName: string | null): string {
  switch (reason.kind) {
    case 'first-available':
      return reason.skipped.length === 0
        ? `${winnerName} contesto la primera de la cadena por prioridad.`
        : `${winnerName} fue la primera de la cadena que contesto; antes fallaron ${reason.skipped.join(', ')}.`;
    case 'fastest':
      return reason.stillRunning.length === 0
        ? `${winnerName} contesto antes que nadie, en ${reason.ms} ms.`
        : `${winnerName} gano la carrera con ${reason.ms} ms. ${reason.stillRunning.join(', ')} seguia(n) pensando cuando se cerro la decision.`;
    case 'most-cautious':
      return `Entre ${reason.among} respuestas se tomo la mas alta. Ante desacuerdo se protege a quien usa la app, no se promedia.`;
    case 'most-confident-safe':
      return `Las ${reason.among} respuestas coincidieron en SEGURO. Se tomo la mas convencida de que lo es.`;
    case 'consensus':
      return reason.dissenting.length === 0
        ? `Las ${reason.agreeing.length} coincidieron en ${reason.band} (hacian falta ${reason.threshold}). Se tomo la mediana del grupo.`
        : `${reason.agreeing.length} coincidieron en ${reason.band} y hacian falta ${reason.threshold}. Discreparon: ${reason.dissenting.join(', ')}. Se tomo la mediana del grupo mayoritario.`;
    case 'no-consensus':
      return `Ninguna banda reunio mayoria (aparecieron ${reason.bands.join(', ')}). Se cayo a la lectura mas prudente.`;
    case 'sole-answer':
      return 'Contesto una sola IA. No hubo deliberacion: el resultado descansa en una sola fuente.';
    case 'silence':
      return 'No contesto ninguna IA. El resultado sale entero del motor local — lexico, patrones y URLs — sin capa de lenguaje.';
  }
}

function SuspicionList({ items }: { items: Suspicion[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className="rounded-lg p-2.5 space-y-1.5"
      style={{ background: 'var(--suspicious-bg)', border: '1px solid var(--warning)' }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--warning)' }}>
        Indicios · no son conclusiones
      </p>
      {items.map((s, i) => (
        <p key={i} className="text-[11px] leading-snug font-mono" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-bold">{s.provider}</span>: {s.note}
        </p>
      ))}
    </div>
  );
}

function ProviderPane({
  run,
  isWinner,
  flagged,
}: {
  run: ProviderRun;
  isWinner: boolean;
  /** Indicios que apuntan a ESTE proveedor. Vacio en el caso normal. */
  flagged: Suspicion[];
}) {
  const style = OUTCOME[run.outcome];
  const sig = run.signal;

  // El borde de la sospecha manda sobre el de la firma.
  //
  // Sin esto, la lista de indicios de arriba obliga a cruzar un identificador
  // con la rejilla para saber a cual mirar — y evitar exactamente ese cruce es
  // para lo que existe el panel. Que una IA pueda ser a la vez la firmante y la
  // señalada no es contradiccion: en una cadena de fallback con dos caidas,
  // firma la unica que quedaba en pie.
  const borde = flagged.length > 0
    ? '1.5px solid var(--warning)'
    : isWinner
      ? '1.5px solid var(--accent)'
      : '1px solid var(--border)';

  return (
    <div
      className="rounded-lg overflow-hidden flex flex-col"
      style={{ background: 'var(--bg-primary)', border: borde }}
    >
      {/* Barra de titulo */}
      <div
        className="flex items-center justify-between px-2.5 py-1.5 gap-2"
        style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[11px] font-bold font-mono truncate" style={{ color: 'var(--text-primary)' }}>
          {run.id}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {flagged.length > 0 && (
            <span
              className="text-[9px] font-black px-1.5 py-0.5 rounded"
              style={{ background: 'var(--warning)', color: 'var(--bg-primary)' }}
              title={flagged.map((f) => f.note).join(' · ')}
            >
              INDICIO
            </span>
          )}
          {isWinner && (
            <span
              className="text-[9px] font-black px-1.5 py-0.5 rounded"
              style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
            >
              FIRMA
            </span>
          )}
          <span className="text-[10px] font-mono" style={{ color: style.color }}>
            {style.glyph} {style.label}
          </span>
        </span>
      </div>

      <div className="p-2.5 space-y-2 flex-1 font-mono text-[11px]">
        <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
          <span>{run.name}</span>
          <span>{run.ms === null ? '—' : `${run.ms} ms`}</span>
        </div>

        {sig ? (
          <>
            <div className="flex gap-3">
              <span style={{ color: 'var(--text-secondary)' }}>
                riesgo <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{sig.value}</span>/100
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                confianza <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{Math.round(sig.confidence * 100)}</span>%
              </span>
            </div>

            {sig.tactics.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {sig.tactics.map((tactic) => (
                  <span
                    key={tactic}
                    className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
                  >
                    {tactic}
                  </span>
                ))}
              </div>
            )}

            {/* Texto del modelo. Citado, no adoptado. */}
            <div
              className="rounded p-2 text-[10px] leading-snug"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              <span className="block mb-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                dice el modelo
              </span>
              {sig.explanation || '(sin explicacion)'}
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>
            {run.rejection ? `esquema: ${run.rejection}` : null}
            {run.rejection && run.detail ? ' · ' : null}
            {run.detail ?? (run.rejection ? null : 'sin detalle')}
          </p>
        )}
      </div>
    </div>
  );
}

export function DeliberationTerminal({ deliberation }: Props) {
  const [open, setOpen] = useState(true);
  const { runs, winner, reason, injectionIds, suspicions, strategy, totalMs } = deliberation;

  // Reparto: participan las que se llamaron o se habrian llamado. Las apagadas
  // y las no configuradas no gastan columna, van al pie.
  const active = runs.filter((r) => r.outcome !== 'disabled' && r.outcome !== 'unavailable');
  const idle = runs.filter((r) => r.outcome === 'disabled' || r.outcome === 'unavailable');
  const winnerName = runs.find((r) => r.id === winner)?.id ?? null;

  // El reparto se estrecha con la pantalla. El brief apunta a escritorio Y a
  // navegador de Android: tres columnas en un movil no son tres paneles, son
  // tres tiras ilegibles. Las clases van literales porque Tailwind las busca en
  // el fuente y no las encontraria construidas con plantillas.
  const GRID: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  };
  const grid = GRID[active.length <= 1 ? 1 : active.length === 2 ? 2 : 3]!;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer transition-all hover:opacity-80"
      >
        <span className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Deliberacion
          </span>
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {strategy} · {active.length} IA{active.length === 1 ? '' : 's'} · {totalMs} ms
          </span>
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 transition-transform duration-200"
          style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          {/* El fallo */}
          <div
            className="rounded-lg p-2.5"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
              Por que este resultado
            </p>
            <p className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              {explainReason(reason, winnerName)}
            </p>
          </div>

          {injectionIds.length > 0 && (
            <div
              className="rounded-lg p-2.5"
              style={{ background: 'var(--dangerous-bg)', border: '1px solid var(--danger)' }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--danger)' }}>
                Intento de inyeccion en el texto de entrada
              </p>
              <p className="text-[11px] font-mono leading-snug" style={{ color: 'var(--text-secondary)' }}>
                {injectionIds.join(' · ')}
              </p>
              <p className="text-[10px] mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                Detectado antes de llamar a nadie. No censura el mensaje: cuenta como riesgo, y
                sirve para leer con lupa a la IA que se aparte del resto.
              </p>
            </div>
          )}

          <SuspicionList items={suspicions} />

          {/* Un panel por IA */}
          <div className={`grid gap-2 ${grid}`}>
            {active.map((run) => (
              <ProviderPane
                key={run.id}
                run={run}
                isWinner={run.id === winner}
                flagged={suspicions.filter((s) => s.provider === run.id)}
              />
            ))}
          </div>

          {idle.length > 0 && (
            <p className="text-[10px] font-mono leading-snug" style={{ color: 'var(--text-muted)' }}>
              Sin participar:{' '}
              {idle.map((r) => `${r.id} (${OUTCOME[r.outcome].label})`).join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
