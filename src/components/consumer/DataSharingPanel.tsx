// =============================================================================
// Contribuir a mejorar la deteccion — y poder dejar de hacerlo
//
// Sustituye al panel de cuenta. Ya no hay correo ni contraseña: lo que
// identifica un envio es un numero aleatorio generado en este aparato.
//
// Se enseña ENTERO lo que sale, campo por campo y con su valor real, no una
// frase que diga "datos tecnicos". Quien quiera saber que manda su telefono lo
// puede leer aqui sin buscar en ningun documento — y quien lo lea antes de
// decidir esta decidiendo de verdad, que es de lo que se trata.
// =============================================================================

import { useState } from 'react';
import { Share2, ShieldOff, Trash2, Smartphone } from 'lucide-react';
import { useNadaStore } from '@/store/useNadaStore';
import {
  mayShareReports,
  mayShareTelemetry,
  recordConsent,
  revoke,
  currentPack,
} from '@/services/policyService';
import { collectDeviceContext, forgetInstall, installId } from '@/services/telemetryService';
import { proxyBaseUrl, hasProxy } from '@/services/aiProviders/proxyClient';
import type { DeviceContext } from '@/shared/telemetry/types';

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11px] font-mono py-0.5">
      <span style={{ color: 'var(--text-muted)' }}>{etiqueta}</span>
      <span className="text-right truncate" style={{ color: 'var(--text-secondary)' }}>{valor}</span>
    </div>
  );
}

function Interruptor({
  titulo,
  detalle,
  activo,
  onToggle,
}: {
  titulo: string;
  detalle: string;
  activo: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{titulo}</p>
        <p className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-muted)' }}>{detalle}</p>
      </div>
      <button
        onClick={onToggle}
        className="px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all hover:scale-105 shrink-0"
        style={{
          background: activo ? 'var(--accent)' : 'var(--bg-primary)',
          color: activo ? 'var(--bg-primary)' : 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        {activo ? 'ACTIVADO' : 'DESACTIVADO'}
      </button>
    </div>
  );
}

export function DataSharingPanel() {
  const { language } = useNadaStore();
  const [reportes, setReportes] = useState(() => mayShareReports());
  const [telemetria, setTelemetria] = useState(() => mayShareTelemetry());
  const [aviso, setAviso] = useState<string | null>(null);

  // El contexto se DERIVA en cada render en vez de guardarse en estado.
  //
  // Guardarlo obligaba a un efecto que lo recalculara al cambiar el idioma, y
  // eso es escribir estado dentro de un efecto — cascada de renders y aviso del
  // linter. Calcularlo aqui cuesta leer navigator y localStorage, que es nada, y
  // ademas no puede quedarse desincronizado de los interruptores de arriba.
  //
  // Solo se calcula si esta encendido: llamarlo antes crearia el identificador
  // de instalacion de quien precisamente lo tiene apagado.
  const contexto: DeviceContext | null = telemetria ? collectDeviceContext(language) : null;

  const refrescar = () => {
    setReportes(mayShareReports());
    setTelemetria(mayShareTelemetry());
  };

  const cambiar = (scope: 'reports' | 'telemetry', encender: boolean) => {
    if (encender) {
      recordConsent({
        ageConfirmed: true,
        scopes: {
          protection: true,
          reports: scope === 'reports' ? true : reportes,
          // Encender telemetria sin reportes no tiene sentido: el contexto solo
          // viaja pegado a un reporte. Se enciende la contribucion con el.
          telemetry: scope === 'telemetry' ? true : telemetria,
        },
      });
    } else {
      revoke(scope);
      if (scope === 'telemetry') forgetInstall();
    }
    refrescar();
  };

  const borrar = async () => {
    if (!hasProxy()) {
      setAviso('No hay servidor configurado, asi que no se ha enviado nada que borrar.');
      return;
    }
    try {
      const res = await fetch(`${proxyBaseUrl()}/v1/reports`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: collectDeviceContext(language) }),
      });
      const data = (await res.json()) as { deleted?: number };
      setAviso(
        res.ok
          ? `Borrados ${data.deleted ?? 0} reportes enviados desde este aparato.`
          : 'No se pudo borrar ahora. Intentalo mas tarde.',
      );
    } catch {
      setAviso('Sin conexion con el servidor. No se ha borrado nada.');
    }
    refrescar();
  };

  return (
    <div className="card p-4 space-y-1">
      <div className="flex items-center gap-3 mb-2">
        <Share2 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {language === 'es' ? 'Ayudar a mejorar la deteccion' : 'Help improve detection'}
        </span>
      </div>

      <Interruptor
        titulo={language === 'es' ? 'Enviar mis correcciones' : 'Send my corrections'}
        detalle={
          language === 'es'
            ? 'Cuando marcas que un analisis acerto o se equivoco, ese analisis viaja para poder corregir el algoritmo. Incluye el texto analizado, que puede contener mensajes de otras personas.'
            : 'When you flag an analysis as right or wrong, that analysis is sent so the algorithm can be corrected. It includes the analysed text, which may contain other people messages.'
        }
        activo={reportes}
        onToggle={() => cambiar('reports', !reportes)}
      />

      <div className="border-t" style={{ borderColor: 'var(--border)' }} />

      <Interruptor
        titulo={language === 'es' ? 'Acompañar con datos del aparato' : 'Include device data'}
        detalle={
          language === 'es'
            ? 'Sirve para distinguir un fallo real de alguien mandando informacion falsa a mano: cien quejas desde cien aparatos no significan lo mismo que cien desde uno. Solo se usa para eso.'
            : 'Used to tell a real failure from someone feeding false information: a hundred complaints from a hundred devices do not mean the same as a hundred from one. Used for nothing else.'
        }
        activo={telemetria}
        onToggle={() => cambiar('telemetry', !telemetria)}
      />

      {/* Lo que sale, con sus valores de verdad. */}
      {contexto && (
        <div
          className="rounded-lg p-2.5 mt-1"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Smartphone className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {language === 'es' ? 'Esto es lo que sale' : 'This is what is sent'}
            </p>
          </div>
          <Fila etiqueta="instalacion" valor={contexto.installId} />
          <Fila etiqueta="plataforma" valor={contexto.platform} />
          <Fila etiqueta="sistema" valor={contexto.os} />
          <Fila etiqueta="modelo" valor={contexto.deviceModel ?? '(no disponible)'} />
          <Fila etiqueta="version" valor={contexto.appVersion} />
          <Fila etiqueta="idioma" valor={contexto.uiLanguage} />
          <p className="text-[10px] leading-snug mt-2" style={{ color: 'var(--text-muted)' }}>
            {language === 'es'
              ? 'El servidor anota ademas la direccion IP de la conexion, porque es el unico dato que no se puede falsear desde aqui. La direccion MAC no se recoge: los sistemas operativos dejaron de darla hace años.'
              : 'The server also records the connection IP, the only value that cannot be faked from here. MAC addresses are not collected: operating systems stopped exposing them years ago.'}
          </p>
        </div>
      )}

      {!telemetria && reportes && (
        <p className="text-[11px] leading-snug pt-1" style={{ color: 'var(--text-muted)' }}>
          <ShieldOff className="w-3 h-3 inline mr-1" />
          {language === 'es'
            ? 'Tus correcciones siguen ayudando; simplemente no llevan de que aparato salen.'
            : 'Your corrections still help; they just do not say which device they came from.'}
        </p>
      )}

      <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => void borrar()}
          className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer transition-all hover:opacity-80"
          style={{ color: 'var(--danger)' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          {language === 'es' ? 'Borrar lo que he enviado' : 'Delete what I have sent'}
        </button>
        <p className="text-[10px] leading-snug mt-1" style={{ color: 'var(--text-muted)' }}>
          {language === 'es'
            ? `Borra del servidor los reportes enviados desde esta instalacion (${installId().slice(0, 8)}…). Si borras los datos de la app o la reinstalas, ese identificador se pierde y ya no habra forma de reclamarlos.`
            : `Deletes reports sent from this install (${installId().slice(0, 8)}…). Clearing app data or reinstalling loses that identifier, and with it any way to claim them.`}
        </p>
        {aviso && (
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>{aviso}</p>
        )}
      </div>

      <p className="text-[10px] leading-snug pt-2" style={{ color: 'var(--text-muted)' }}>
        {language === 'es'
          ? `Region aplicada: ${currentPack().region}. Todo lo recogido se trata solo para mejorar la precision de la deteccion.`
          : `Applied region: ${currentPack().region}. Everything collected is processed only to improve detection accuracy.`}
      </p>
    </div>
  );
}
