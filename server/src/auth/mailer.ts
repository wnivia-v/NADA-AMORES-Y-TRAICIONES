// =============================================================================
// Entrega del correo de verificacion
//
// No hay transporte configurado en este repositorio, y eso NO se disimula.
//
// La tentacion seria dar el registro por bueno y seguir; el resultado es un
// producto que parece funcionar y en el que nadie puede verificar su cuenta.
// Asi que:
//
//   - En desarrollo el enlace se escribe en el registro del servidor. Sirve
//     para probar el flujo entero sin montar un SMTP.
//   - En produccion sin transporte configurado, el servidor AVISA al arrancar y
//     el registro devuelve un error explicito. Es preferible fallar en el
//     despliegue a fallar en silencio en manos de un usuario.
//
// El transporte ya existe: un cliente SMTP minimo escrito con node:net y
// node:tls (server/src/auth/smtp.ts), probado contra un servidor de mentira que
// se levanta en el propio test.
// =============================================================================

import { parseTransport, sendMail, SmtpError } from './smtp';

export type MailerMode = 'console' | 'configured' | 'missing';

function isProduction(): boolean {
  return (process.env['NODE_ENV'] ?? '').toLowerCase() === 'production';
}

export function mailerMode(): MailerMode {
  const transport = process.env['MAIL_TRANSPORT'];
  // Una URL de transporte que no se entiende es peor que no tenerla: parece
  // configurado y no manda nada. Cuenta como ausente.
  if (transport && parseTransport(transport)) return 'configured';
  if (transport) {
    console.error(`[NADA][mail] MAIL_TRANSPORT no se entiende: "${transport}"`);
  }
  return isProduction() ? 'missing' : 'console';
}

/** Remitente. Configuracion de despliegue, como el resto de las direcciones. */
function sender(): string {
  return process.env['MAIL_FROM'] ?? 'nada@localhost';
}

export interface DeliveryResult {
  ok: boolean;
  /** Solo en modo consola: el enlace, para poder seguirlo a mano. */
  devLink?: string;
}

/**
 * Entrega el enlace de verificacion.
 *
 * `verifyUrlBase` sale de la configuracion del despliegue: el servidor no sabe
 * por que dominio se le llega.
 */
export async function deliverVerification(
  email: string,
  token: string,
  verifyUrlBase: string,
): Promise<DeliveryResult> {
  const link = `${verifyUrlBase}?token=${encodeURIComponent(token)}`;

  switch (mailerMode()) {
    case 'console':
      console.log(`[NADA][mail] verificacion para ${email}: ${link}`);
      return { ok: true, devLink: link };

    case 'configured': {
      const config = parseTransport(process.env['MAIL_TRANSPORT'] ?? '');
      if (!config) return { ok: false };

      try {
        await sendMail(config, {
          from: sender(),
          to: email,
          subject: 'Verifica tu cuenta de NADA',
          text: [
            'Alguien —esperamos que tu— ha creado una cuenta de NADA con este correo.',
            '',
            'Para poder enviar reportes, confirma que es tuyo aqui:',
            link,
            '',
            'El enlace caduca en 24 horas y solo sirve una vez.',
            'Si no has sido tu, ignora este mensaje: sin confirmar, la cuenta no puede hacer nada.',
          ].join('\n'),
        });
        return { ok: true };
      } catch (error) {
        // El motivo va al registro del operador, no al usuario: puede contener
        // el nombre del servidor de correo y parte de la conversacion.
        console.error(
          '[NADA][mail] no se pudo entregar:',
          error instanceof SmtpError ? error.message : error,
        );
        return { ok: false };
      }
    }

    case 'missing':
      console.error(
        '[NADA][mail] produccion sin MAIL_TRANSPORT: nadie podra verificar su cuenta',
      );
      return { ok: false };
  }
}
