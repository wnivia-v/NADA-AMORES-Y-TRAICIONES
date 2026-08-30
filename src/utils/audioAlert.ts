// =============================================================================
// Audio Alert — tono sintetizado con Web Audio API
//
// Diseño: informar sin sobresaltar.
//
// La versión anterior era una alarma de sierra + cuadrada a volumen alto y casi
// un segundo de duración. Durante una videollamada, que es justo cuando el
// escudo de video está trabajando, eso sonaba encima de la conversación cada
// vez que se reevaluaba la amenaza — y una alarma que interrumpe todo el tiempo
// termina siendo ruido que el usuario aprende a ignorar, o directamente motivo
// para apagar la protección. Ninguna de las dos cosas protege a nadie.
//
// Ahora es un acorde corto de dos notas con ondas senoidales: audible y
// distinguible del audio de la llamada, pero sin tapar a quien está hablando.
// La intensidad cambia el tono y el volumen, no la agresividad del timbre.
// =============================================================================

let audioCtx: AudioContext | null = null;

/**
 * Piso global entre tonos audibles.
 *
 * Los escudos son independientes entre sí: voz, pantalla y video pueden
 * detectar la misma amenaza casi al mismo tiempo. Sin este piso, dos tonos se
 * superponen y suenan como una distorsión, que es exactamente el ruido áspero
 * que queremos evitar. La alerta visual no se toca — esto solo silencia el
 * duplicado sonoro.
 */
const MIN_GAP_BETWEEN_TONES_MS = 4_000;

let lastToneAt = 0;

/** Volumen pico por intensidad. El anterior era 0.15 para todo. */
const PEAK_GAIN: Record<AlertIntensity, number> = {
  low: 0.035,
  medium: 0.055,
  high: 0.08,
};

/** Frecuencia base en Hz. Más alto = más urgente al oído. */
const BASE_FREQ: Record<AlertIntensity, number> = {
  low: 494, // Si4
  medium: 587, // Re5
  high: 698, // Fa5
};

export type AlertIntensity = 'low' | 'medium' | 'high';

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Una nota senoidal con envolvente suave.
 *
 * El ataque y el corte graduales importan: un oscilador que arranca o frena de
 * golpe produce un click audible, y varios clicks seguidos son justamente la
 * aspereza que hacía molesta a la versión anterior.
 */
function playNote(ctx: AudioContext, freq: number, startAt: number, duration: number, peak: number) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startAt);

  // Un armónico apenas audible le da cuerpo para que se distinga de un pitido
  // de sistema, sin agregar la aspereza de una onda cuadrada.
  const harmonic = ctx.createOscillator();
  harmonic.type = 'sine';
  harmonic.frequency.setValueAtTime(freq * 2, startAt);

  const harmonicGain = ctx.createGain();
  harmonicGain.gain.setValueAtTime(peak * 0.25, startAt);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.setValueAtTime(peak, startAt + duration * 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startAt);
  harmonic.start(startAt);
  osc.stop(startAt + duration);
  harmonic.stop(startAt + duration);
}

/**
 * Reproduce el tono de alerta.
 *
 * `force` salta el piso global — reservado para una amenaza nueva y distinta,
 * donde perder el aviso sonoro es peor que solaparlo con otro.
 */
export function playAlertTone(intensity: AlertIntensity = 'medium', options?: { force?: boolean }) {
  try {
    const now = Date.now();
    if (!options?.force && now - lastToneAt < MIN_GAP_BETWEEN_TONES_MS) return;
    lastToneAt = now;

    const ctx = getContext();
    if (ctx.state === 'suspended') ctx.resume();

    const peak = PEAK_GAIN[intensity];
    const base = BASE_FREQ[intensity];
    const t0 = ctx.currentTime;

    // Dos notas ascendentes: se lee como "atención" y no como "alarma de
    // incendio". La segunda es una quinta arriba.
    playNote(ctx, base, t0, 0.16, peak);
    playNote(ctx, base * 1.5, t0 + 0.15, 0.22, peak);
  } catch {
    // Audio no disponible — la alerta visual sigue funcionando igual.
  }
}

/** Solo para tests: reinicia el piso global entre tonos. */
export function resetAlertToneThrottle() {
  lastToneAt = 0;
}
