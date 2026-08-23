// =============================================================================
// Que motor escucha
//
// Reportado usando la app: con el escudo puesto y un podcast sonando, Spotify
// se pausaba y volvia una y otra vez, hasta que el escudo dejaba de recibir
// audio y entonces Spotify seguia normal.
//
// No era un fallo que se arregle en un sitio: es como abre el microfono cada
// motor. El reconocedor del sistema abre una sesion nueva cada pocos segundos y
// cada arranque pide el foco de audio, que en Android pausa lo que suene. El
// motor local abre el microfono una sola vez y lo mantiene.
//
// Los dos son correctos para casos distintos, asi que esto se elige, no se
// adivina — y el compromiso se cuenta entero, porque poner el local delante
// cuesta precision y una descarga la primera vez. Quien lo lea decide sabiendo
// que pierde.
// =============================================================================

import { useState } from 'react';
import { Mic, Music, CloudOff, Volume2 } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import {
  voicePreference, setVoicePreference, type VoicePreference,
  micMode, setMicMode, type MicMode,
} from '@/services/voice';

interface Opcion {
  id: VoicePreference;
  titulo: { es: string; en: string };
  bien: { es: string; en: string };
  coste: { es: string; en: string };
}

const OPCIONES: Opcion[] = [
  {
    id: 'auto',
    titulo: { es: 'Automatico', en: 'Automatic' },
    bien: {
      es: 'El mas rapido y preciso de este aparato, con el otro de respaldo.',
      en: 'The fastest and most accurate on this device, with the other as backup.',
    },
    coste: {
      es: 'Empieza por el reconocedor del sistema, asi que interrumpe la reproduccion.',
      en: 'Starts with the system recognizer, so it interrupts playback.',
    },
  },
  {
    id: 'on-device',
    titulo: { es: 'En el dispositivo', en: 'On-device' },
    bien: {
      es: 'No interrumpe Spotify ni ningun otro audio, no suena la campanita de "escuchando", y el audio no sale del aparato.',
      en: 'Does not interrupt Spotify or any other audio, no "listening" chime, and audio never leaves the device.',
    },
    coste: {
      es: 'Mas lento y menos preciso. La primera vez descarga un modelo.',
      en: 'Slower and less accurate. Downloads a model the first time.',
    },
  },
  {
    id: 'system',
    titulo: { es: 'Reconocedor del sistema', en: 'System recognizer' },
    bien: {
      es: 'Lo mas rapido y preciso, sin descargas.',
      en: 'Fastest and most accurate, no downloads.',
    },
    coste: {
      es: 'Pausa lo que este sonando cada vez que reabre la escucha, y en la version web manda el audio a servidores de Google.',
      en: 'Pauses whatever is playing each time it reopens, and on the web it sends audio to Google servers.',
    },
  },
];

export function VoiceEnginePanel() {
  const { language } = useNadaStore();
  const idioma = language === 'es' ? 'es' : 'en';
  const [elegido, setElegido] = useState<VoicePreference>(() => voicePreference());
  const [modoMic, setModoMic] = useState<MicMode>(() => micMode());

  const cambiarMic = (m: MicMode) => {
    setMicMode(m);
    setModoMic(m);
  };

  const elegir = (id: VoicePreference) => {
    setVoicePreference(id);
    setElegido(id);
  };

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 mb-1">
        <Mic className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {idioma === 'es' ? 'Motor del escudo de voz' : 'Voice shield engine'}
        </span>
      </div>

      <p className="text-[11px] leading-snug mb-3" style={{ color: 'var(--text-muted)' }}>
        <Music className="w-3 h-3 inline mr-1" />
        {idioma === 'es'
          ? 'Si escuchas musica o un podcast mientras vigilas, elige "En el dispositivo": es el unico que no le quita el audio a la otra app.'
          : 'If you listen to music or a podcast while monitoring, pick "On-device": it is the only one that does not steal audio from the other app.'}
      </p>

      <div className="space-y-2">
        {OPCIONES.map((op) => {
          const activo = elegido === op.id;
          return (
            <button
              key={op.id}
              onClick={() => elegir(op.id)}
              className="w-full text-left rounded-xl p-3 cursor-pointer transition-all hover:opacity-90"
              style={{
                background: activo ? 'var(--accent-light)' : 'var(--bg-elevated)',
                border: `1.5px solid ${activo ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className="text-sm font-bold"
                  style={{ color: activo ? 'var(--accent)' : 'var(--text-primary)' }}
                >
                  {op.titulo[idioma]}
                </span>
                {op.id === 'on-device' && (
                  <span
                    className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--success)', color: 'var(--bg-primary)' }}
                  >
                    <CloudOff className="w-2.5 h-2.5" />
                    {idioma === 'es' ? 'SIN RED' : 'OFFLINE'}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                {op.bien[idioma]}
              </p>
              {/* El coste, con el mismo tamaño que la ventaja. Una eleccion en la
                  que solo se leen las ventajas no es una eleccion. */}
              <p className="text-[11px] leading-snug mt-1" style={{ color: 'var(--warning)' }}>
                {op.coste[idioma]}
              </p>
            </button>
          );
        })}
      </div>

      {/* Como se PIDE el microfono. Es lo que de verdad decide si Spotify se
          para, y va aparte del motor porque afecta tambien al escudo de video. */}
      <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Volume2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {idioma === 'es' ? 'Compartir el microfono con otras apps' : 'Share the microphone with other apps'}
          </span>
        </div>

        <p className="text-[11px] leading-snug mb-2" style={{ color: 'var(--text-muted)' }}>
          {idioma === 'es'
            ? 'Por defecto NADA pide el microfono con cancelacion de eco, y Android lo interpreta como una llamada: pausa lo que este sonando. Activando esto se pide el microfono corriente, que convive.'
            : 'By default NADA asks for the microphone with echo cancellation, which Android treats as a call: it pauses whatever is playing. Turning this on asks for the plain microphone, which coexists.'}
        </p>

        {/* Solo sirve con el motor local. El reconocedor del sistema abre el
            microfono por su cuenta y no acepta restricciones nuestras: decir lo
            contrario dejaria a alguien peleandose con un interruptor que en su
            configuracion no puede hacer nada. */}
        {elegido === 'system' && (
          <p
            className="text-[11px] leading-snug mb-2 rounded-lg p-2"
            style={{ color: 'var(--warning)', background: 'var(--suspicious-bg)' }}
          >
            {idioma === 'es'
              ? 'Con el reconocedor del sistema elegido, esto no tiene efecto: ese motor abre el microfono por su cuenta y no acepta estas opciones. Cambia a "En el dispositivo" para que sirva.'
              : 'With the system recognizer selected this has no effect: that engine opens the microphone itself and ignores these options. Switch to "On-device" for it to work.'}
          </p>
        )}

        <button
          onClick={() => cambiarMic(modoMic === 'convivir' ? 'aislado' : 'convivir')}
          className="w-full text-left rounded-xl p-3 cursor-pointer transition-all hover:opacity-90"
          style={{
            background: modoMic === 'convivir' ? 'var(--accent-light)' : 'var(--bg-elevated)',
            border: `1.5px solid ${modoMic === 'convivir' ? 'var(--accent)' : 'var(--border)'}`,
          }}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold" style={{ color: modoMic === 'convivir' ? 'var(--accent)' : 'var(--text-primary)' }}>
              {idioma === 'es' ? 'No interrumpir otro audio' : 'Do not interrupt other audio'}
            </span>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
              style={{
                background: modoMic === 'convivir' ? 'var(--accent)' : 'var(--bg-primary)',
                color: modoMic === 'convivir' ? 'var(--bg-primary)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {modoMic === 'convivir' ? 'ON' : 'OFF'}
            </span>
          </span>
          <span className="block text-[11px] leading-snug mt-1.5" style={{ color: 'var(--warning)' }}>
            {idioma === 'es'
              ? 'Coste: sin cancelacion de eco el escudo OYE el altavoz del propio movil. Lo que suene entra en la transcripcion y se analiza, asi que un podcast puede provocar avisos sobre su contenido en vez de sobre una llamada.'
              : 'Cost: without echo cancellation the shield HEARS the phone speaker. Whatever plays enters the transcript and gets analysed, so a podcast can trigger warnings about its content instead of a call.'}
          </span>
        </button>
      </div>

      <p className="text-[10px] leading-snug mt-2" style={{ color: 'var(--text-muted)' }}>
        {idioma === 'es'
          ? 'El cambio se aplica la proxima vez que actives el escudo de voz. Si el motor elegido no puede arrancar en este aparato, el otro sigue detras como respaldo.'
          : 'Takes effect next time you turn the voice shield on. If the chosen engine cannot start here, the other one still runs as a fallback.'}
      </p>
    </div>
  );
}
