// =============================================================================
// Audio Alert — Web Audio API synthesized alarm
// Plays a distinctive alert tone when fraud is detected
// =============================================================================

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

export function playAlertTone(intensity: 'low' | 'medium' | 'high' = 'medium') {
  try {
    const ctx = getContext();
    if (ctx.state === 'suspended') ctx.resume();

    const duration = intensity === 'high' ? 1.0 : intensity === 'medium' ? 0.6 : 0.3;
    const freq = intensity === 'high' ? 880 : intensity === 'medium' ? 660 : 440;

    // Primary oscillator
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, ctx.currentTime);

    // Secondary oscillator for richness
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(freq * 1.5, ctx.currentTime);

    // Gain envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + duration);
    osc2.stop(ctx.currentTime + duration);
  } catch {
    // Audio not available
  }
}
