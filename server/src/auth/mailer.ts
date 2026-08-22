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
// Cuando haya proveedor (SES, Postmark, lo que sea), se implementa `deliver` y
// nada mas de este archivo cambia.
// =============================================================================

export type MailerMode = 'console' | 'configured' | 'missing';

function isProduction(): boolean {
  return (process.env['NODE_ENV'] ?? '').toLowerCase() === 'production';
}

export function mailerMode(): MailerMode {
  if (process.env['MAIL_TRANSPORT']) return 'configured';
  return isProduction() ? 'missing' : 'console';
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

    case 'configured':
      // Aqui ira el proveedor real. Mientras no exista, no se finge que si.
      console.warn('[NADA][mail] MAIL_TRANSPORT definido pero no implementado');
      return { ok: false };

    case 'missing':
      console.error(
        '[NADA][mail] produccion sin MAIL_TRANSPORT: nadie podra verificar su cuenta',
      );
      return { ok: false };
  }
}
