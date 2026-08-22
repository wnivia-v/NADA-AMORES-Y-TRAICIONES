// =============================================================================
// Cliente SMTP minimo
//
// Escrito con node:net y node:tls, sin dependencias. No es por deporte: una
// libreria de correo es codigo con acceso a las credenciales del buzon y a todo
// lo que se manda por el, y aqui solo hacen falta seis ordenes del protocolo.
//
// LA PARTE DE SEGURIDAD, que es la que justifica leer este archivo:
//
//   INYECCION DE CABECERAS. La direccion de destino viene del formulario de
//   registro, o sea de fuera. En SMTP las cabeceras se separan unas de otras por
//   CRLF, asi que una direccion como
//
//       victima@ejemplo.test\r\nBcc: otros@sitio.test
//
//   convierte el correo de verificacion en un envio masivo firmado por
//   nosotros. Lo mismo con el asunto. Por eso NADA que venga de fuera se escribe
//   en una cabecera sin comprobar antes que no lleva CR ni LF, y si los lleva se
//   rechaza el envio ENTERO en vez de limpiarlo — limpiar invita a discutir
//   despues que se limpio y que no.
//
//   TLS. El certificado se valida. Un rejectUnauthorized en false aqui
//   entregaria las credenciales del buzon a cualquiera que se ponga en medio, y
//   no hay ninguna prisa que lo justifique.
// =============================================================================

import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

const CRLF = '\r\n';

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS desde el primer byte (puerto 465). Si no, se intenta STARTTLS. */
  implicitTls: boolean;
  user?: string;
  password?: string;
}

export interface Envelope {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export class SmtpError extends Error {}

/**
 * Analiza MAIL_TRANSPORT.
 *
 *   smtp://usuario:clave@host:587    STARTTLS si el servidor lo ofrece
 *   smtps://usuario:clave@host:465   TLS desde el principio
 */
export function parseTransport(url: string): SmtpConfig | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const implicitTls = parsed.protocol === 'smtps:';
  if (!implicitTls && parsed.protocol !== 'smtp:') return null;
  if (!parsed.hostname) return null;

  return {
    host: parsed.hostname,
    port: Number(parsed.port) || (implicitTls ? 465 : 587),
    implicitTls,
    ...(parsed.username ? { user: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

/**
 * Un CR o un LF en algo que va a una cabecera es un intento de inyeccion.
 *
 * No hay caso legitimo: ninguna direccion de correo ni ningun asunto razonable
 * contiene saltos de linea. Se rechaza, no se limpia.
 */
export function isHeaderSafe(value: string): boolean {
  return !/[\r\n]/.test(value) && value.length <= 998;
}

/** Conversacion SMTP sobre un socket cualquiera. */
class Session {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;

  constructor(private socket: Socket | TLSSocket) {
    this.listen(socket);
  }

  private listen(socket: Socket | TLSSocket): void {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  /**
   * Una respuesta puede venir en varias lineas: varias 250-ALGO seguidas y una
   * ultima 250 OK. La ultima es la que lleva un ESPACIO tras el codigo, y no un
   * guion. Confundirlas deja la conversacion desincronizada.
   */
  private drain(): void {
    if (!this.waiting) return;

    const lines = this.buffer.split(CRLF);
    for (let i = 0; i < lines.length; i += 1) {
      if (/^[0-9]{3} /.test(lines[i]!)) {
        const complete = lines.slice(0, i + 1).join(CRLF);
        this.buffer = lines.slice(i + 1).join(CRLF);
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.(complete);
        return;
      }
    }
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new SmtpError('el servidor no respondio')), 15_000);
      this.waiting = (line) => { clearTimeout(timer); resolve(line); };
      this.drain();
    });
  }

  write(text: string): void {
    this.socket.write(text + CRLF);
  }

  /** Manda una orden y exige un codigo concreto. */
  async command(text: string, expected: number): Promise<string> {
    this.write(text);
    const response = await this.read();
    const code = Number(/([0-9]{3}) /.exec(response)?.[1] ?? 0);
    if (code !== expected) {
      // El texto del servidor puede repetir parte de la orden, asi que no viaja
      // hacia el usuario: solo al registro de quien opera.
      throw new SmtpError(`el servidor respondio ${code} a ${text.split(' ')[0]}`);
    }
    return response;
  }

  /** Tras STARTTLS la conversacion sigue sobre el socket cifrado. */
  replace(socket: TLSSocket): void {
    this.socket = socket;
    this.buffer = '';
    this.listen(socket);
  }

  end(): void {
    this.socket.end();
  }
}

function connectPlain(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function upgrade(socket: Socket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    // El certificado SE VALIDA: sin esto, cualquiera en medio se lleva las
    // credenciales del buzon.
    const secure = tlsConnect({ socket, servername: host });
    secure.once('secureConnect', () => resolve(secure));
    secure.once('error', reject);
  });
}

function connectTls(host: string, port: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ host, port, servername: host });
    secure.once('secureConnect', () => resolve(secure));
    secure.once('error', reject);
  });
}

/**
 * Manda un correo.
 *
 * allowPlaintext existe SOLO para los tests, que levantan un servidor de mentira
 * sin TLS en localhost. En cualquier otro sitio mandar credenciales por un canal
 * sin cifrar no es una opcion, y por eso hay que pedirlo explicitamente en vez
 * de que ocurra por omision.
 */
export async function sendMail(
  config: SmtpConfig,
  envelope: Envelope,
  options: { allowPlaintext?: boolean } = {},
): Promise<void> {
  // Lo primero, antes de abrir ningun socket.
  for (const campo of ['from', 'to', 'subject'] as const) {
    if (!isHeaderSafe(envelope[campo])) {
      throw new SmtpError(`"${campo}" lleva saltos de linea: inyeccion de cabeceras`);
    }
  }

  let socket: Socket | TLSSocket = config.implicitTls
    ? await connectTls(config.host, config.port)
    : await connectPlain(config.host, config.port);
  let encrypted = config.implicitTls;

  const session = new Session(socket);

  try {
    await session.read(); // saludo 220
    let greeting = await session.command('EHLO nada', 250);

    if (!encrypted && /STARTTLS/i.test(greeting)) {
      await session.command('STARTTLS', 220);
      const secure = await upgrade(socket as Socket, config.host);
      socket = secure;
      session.replace(secure);
      encrypted = true;
      greeting = await session.command('EHLO nada', 250);
    }

    if (config.user && config.password) {
      if (!encrypted && !options.allowPlaintext) {
        throw new SmtpError('el servidor no ofrece TLS: no se mandan credenciales en claro');
      }
      await session.command('AUTH LOGIN', 334);
      await session.command(Buffer.from(config.user).toString('base64'), 334);
      await session.command(Buffer.from(config.password).toString('base64'), 235);
    }

    await session.command(`MAIL FROM:<${envelope.from}>`, 250);
    await session.command(`RCPT TO:<${envelope.to}>`, 250);
    await session.command('DATA', 354);

    const cuerpo = [
      `From: ${envelope.from}`,
      `To: ${envelope.to}`,
      `Subject: ${envelope.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      // Un punto solo en una linea termina el mensaje, asi que si el texto lleva
      // uno se dobla. Es el "dot stuffing" del protocolo.
      normaliseBody(envelope.text),
      '.',
    ].join(CRLF);

    session.write(cuerpo);
    const enviado = await session.read();
    if (!/^250 /m.test(enviado)) throw new SmtpError('el servidor no acepto el mensaje');

    session.write('QUIT');
  } finally {
    session.end();
  }
}

/** Saltos de linea a CRLF y puntos iniciales doblados. */
export function normaliseBody(text: string): string {
  return text.split(/\r?\n/).map((line) => (line.startsWith('.') ? '.' + line : line)).join(CRLF);
}
