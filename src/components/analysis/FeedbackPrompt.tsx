import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Check, AlertCircle } from 'lucide-react';

import type { ScamAnalysis } from '@/store/useNadaStore';
import { useNadaStore } from '@/store/useNadaStore';
import { feedbackService } from '@/services/feedbackService';
import { translations } from '@/utils/translations';

// =============================================================================
// El boton que faltaba
//
// Hasta ahora el sistema acertaba o fallaba y nadie se enteraba nunca: no habia
// ninguna via por la que un error suyo pudiera expresarse. Sin eso, la Fase 5
// no tiene de que alimentarse — un backoffice de agentes que propone arreglos
// necesita saber que hay que arreglar.
//
// Dos decisiones de diseño que importan mas de lo que parecen:
//
//   1. No se le pregunta al usuario que CLASE de error fue. Quien acaba de
//      llevarse un susto no tiene por que saber lo que es un falso positivo, y
//      obligarle a clasificar produce etiquetas peores que no tener ninguna. Se
//      deduce de lo que se le enseño (ver errorKindFor).
//   2. El comentario solo se pide cuando el sistema FALLO. Cuando acierta no
//      hay nada que explicar, y añadir un paso ahi solo consigue que la gente
//      deje de pulsar.
// =============================================================================

interface FeedbackPromptProps {
  result: ScamAnalysis;
}

type Phase = 'idle' | 'noting' | 'saved' | 'failed';

export function FeedbackPrompt({ result }: FeedbackPromptProps) {
  const { language } = useNadaStore();
  const t = translations[language];
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const analysisId = result.analysisId;

  // Sin borrador vivo no hay nada sobre lo que opinar: el analisis es de una
  // sesion anterior, restaurado del almacenamiento, y su rastro ya no existe.
  // Enseñar el boton igualmente seria ofrecer algo que no funciona.
  if (!analysisId || !feedbackService.hasDraft(analysisId)) return null;

  const send = async (judgment: 'correct' | 'incorrect') => {
    setBusy(true);
    const outcome = await feedbackService.submit(analysisId, {
      judgment,
      ...(note.trim() ? { note } : {}),
    });
    setBusy(false);
    setPhase(outcome.ok ? 'saved' : 'failed');
  };

  if (phase === 'saved') {
    return (
      <Row>
        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--success)' }} aria-hidden="true" />
        {/* Dice donde se ha guardado, no "gracias, lo hemos recibido": todavia
            no se envia a ningun sitio, y agradecer un envio que no ocurre seria
            mentirle a quien acaba de dedicarnos su tiempo. */}
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.feedbackSaved}</span>
      </Row>
    );
  }

  if (phase === 'failed') {
    return (
      <Row>
        <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warning)' }} aria-hidden="true" />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.feedbackFailed}</span>
      </Row>
    );
  }

  if (phase === 'noting') {
    return (
      <div className="pt-3 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {t.feedbackWhatHappened}
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.feedbackNotePlaceholder}
          rows={2}
          maxLength={500}
          className="w-full text-xs rounded-lg p-2 resize-none"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void send('incorrect')}
          className="text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          {t.feedbackSend}
        </button>
      </div>
    );
  }

  // El texto del "no" depende de que se enseño: negar un SEGURO es decir que
  // era una estafa, negar una alerta es decir que era legitimo. Una sola
  // etiqueta para los dos casos obligaria a leerla dos veces para entenderla.
  const wrongLabel = result.verdict === 'SEGURO' ? t.feedbackWasScam : t.feedbackWasLegit;

  return (
    <div className="pt-3 border-t flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.feedbackQuestion}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send('correct')}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <ThumbsUp className="w-3 h-3" aria-hidden="true" />
          {t.feedbackCorrect}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPhase('noting')}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <ThumbsDown className="w-3 h-3" aria-hidden="true" />
          {wrongLabel}
        </button>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
      {children}
    </div>
  );
}
