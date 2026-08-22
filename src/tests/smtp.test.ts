// @vitest-environment node
//
// Contra un servidor SMTP de mentira levantado aqui mismo. Un cliente de correo
// que nunca ha hablado con nada no es codigo probado, es codigo escrito.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';

import {
  sendMail, parseTransport, isHeaderSafe, normaliseBody, SmtpError,
} from '../../server/src/auth/smtp';

const CRLF = '\r\n';

interface Recibido {
  ordenes: string[];
  datos: string;
}

/** Servidor SMTP suficiente para una conversacion completa. */
function servidorDeMentira(recibido: Recibido, opciones: { auth?: boolean } = {}): Server {
  return createServer((socket: Socket) => {
    // El estado del protocolo es POR CONEXION. La primera version lo dedujo del
    // array compartido de ordenes y se confundia entre un test y el siguiente:
    // fallaba el servidor de mentira, no el cliente.
    let enDatos = false;
    let esperandoAuth = false;
    let lineasBase64 = 0;
    socket.setEncoding('utf8');
    socket.write('220 mentira.test listo' + CRLF);

    socket.on('data', (chunk: string) => {
      for (const linea of chunk.split(CRLF)) {
        if (linea === '' && !enDatos) continue;

        if (enDatos) {
          if (linea === '.') {
            enDatos = false;
            socket.write('250 aceptado' + CRLF);
          } else {
            recibido.datos += linea + '\n';
          }
          continue;
        }

        recibido.ordenes.push(linea);
        const orden = linea.split(' ')[0]?.toUpperCase();

        if (orden === 'EHLO') {
          socket.write('250-mentira.test' + CRLF);
          socket.write(opciones.auth ? '250 AUTH LOGIN' + CRLF : '250 OK' + CRLF);
        } else if (orden === 'AUTH') {
          esperandoAuth = true;
          lineasBase64 = 0;
          socket.write('334 VXNlcm5hbWU6' + CRLF);
        } else if (esperandoAuth && /^[A-Za-z0-9+/=]+$/.test(linea)) {
          lineasBase64 += 1;
          if (lineasBase64 >= 2) {
            esperandoAuth = false;
            socket.write('235 autenticado' + CRLF);
          } else {
            socket.write('334 UGFzc3dvcmQ6' + CRLF);
          }
        } else if (orden === 'MAIL' || orden === 'RCPT') {
          socket.write('250 OK' + CRLF);
        } else if (orden === 'DATA') {
          enDatos = true;
          socket.write('354 adelante' + CRLF);
        } else if (orden === 'QUIT') {
          socket.write('221 adios' + CRLF);
          socket.end();
        }
      }
    });
  });
}

function puerto(server: Server): number {
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

describe('lo que va a una cabecera se comprueba', () => {
  it('un salto de linea en la direccion NO se limpia: se rechaza', async () => {
    // El ataque: la direccion viene del formulario de registro. Con un CRLF
    // dentro, el correo de verificacion se convierte en un envio masivo firmado
    // por nosotros.
    const inyectada = 'victima@ejemplo.test\r\nBcc: otros@sitio.test';
    expect(isHeaderSafe(inyectada)).toBe(false);

    await expect(sendMail(
      { host: '127.0.0.1', port: 1, implicitTls: false },
      { from: 'nada@ejemplo.test', to: inyectada, subject: 'hola', text: 'texto' },
    )).rejects.toBeInstanceOf(SmtpError);
  });

  it('tampoco en el asunto', () => {
    expect(isHeaderSafe('Verifica tu cuenta\r\nBcc: alguien@sitio.test')).toBe(false);
    expect(isHeaderSafe('Verifica tu cuenta')).toBe(true);
  });

  it('se rechaza ANTES de abrir el socket', async () => {
    // El puerto 1 no escucha nada. Que el error sea de inyeccion y no de
    // conexion demuestra que la comprobacion va primero.
    await expect(sendMail(
      { host: '127.0.0.1', port: 1, implicitTls: false },
      { from: 'a\r\nX: y', to: 'b@c.test', subject: 's', text: 't' },
    )).rejects.toThrow(/inyeccion/);
  });

  it('una cabecera absurdamente larga tampoco pasa', () => {
    expect(isHeaderSafe('a'.repeat(1200))).toBe(false);
  });
});

describe('conversacion completa con un servidor', () => {
  let server: Server;
  const recibido: Recibido = { ordenes: [], datos: '' };

  beforeAll(async () => {
    server = servidorDeMentira(recibido);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  it('manda el correo entero y en el orden del protocolo', async () => {
    await sendMail(
      { host: '127.0.0.1', port: puerto(server), implicitTls: false },
      {
        from: 'nada@ejemplo.test',
        to: 'alguien@ejemplo.test',
        subject: 'Verifica tu cuenta',
        text: 'Entra aqui: https://ejemplo.test/?token=abc',
      },
    );

    const ordenes = recibido.ordenes.map((o) => o.split(' ')[0]);
    expect(ordenes).toContain('EHLO');
    expect(ordenes).toContain('MAIL');
    expect(ordenes).toContain('RCPT');
    expect(ordenes).toContain('DATA');

    expect(recibido.datos).toContain('Subject: Verifica tu cuenta');
    expect(recibido.datos).toContain('token=abc');
  });
});

describe('credenciales', () => {
  let server: Server;
  const recibido: Recibido = { ordenes: [], datos: '' };

  beforeAll(async () => {
    server = servidorDeMentira(recibido, { auth: true });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  it('SIN TLS no se mandan, aunque el servidor las pida', async () => {
    // Un servidor que ofrece AUTH sobre un canal en claro es exactamente donde
    // se pierden las credenciales del buzon.
    await expect(sendMail(
      { host: '127.0.0.1', port: puerto(server), implicitTls: false, user: 'u', password: 'p' },
      { from: 'a@b.test', to: 'c@d.test', subject: 's', text: 't' },
    )).rejects.toThrow(/TLS/);
  });

  it('con permiso explicito si, y van en base64', async () => {
    await sendMail(
      { host: '127.0.0.1', port: puerto(server), implicitTls: false, user: 'usuario', password: 'clave' },
      { from: 'a@b.test', to: 'c@d.test', subject: 's', text: 't' },
      { allowPlaintext: true },
    );

    expect(recibido.ordenes).toContain(Buffer.from('usuario').toString('base64'));
  });
});

describe('detalles del protocolo', () => {
  it('un punto al principio de linea se dobla', () => {
    // Un punto solo en una linea TERMINA el mensaje. Sin doblarlo, un texto que
    // empiece por punto corta el correo por la mitad.
    expect(normaliseBody('hola\n.\nadios')).toBe('hola' + CRLF + '..' + CRLF + 'adios');
  });

  it('los saltos se normalizan a CRLF', () => {
    expect(normaliseBody('una\ndos')).toBe('una' + CRLF + 'dos');
  });
});

describe('MAIL_TRANSPORT', () => {
  it('smtp y smtps, con sus puertos por defecto', () => {
    expect(parseTransport('smtp://host.test')).toMatchObject({ port: 587, implicitTls: false });
    expect(parseTransport('smtps://host.test')).toMatchObject({ port: 465, implicitTls: true });
  });

  it('usuario y clave se decodifican', () => {
    const config = parseTransport('smtp://u%40dominio:cla%2Bve@host.test:2525');
    expect(config).toMatchObject({ user: 'u@dominio', password: 'cla+ve', port: 2525 });
  });

  it('cualquier otra cosa es null, no una suposicion', () => {
    for (const malo of ['', 'http://host.test', 'no-es-una-url', 'smtp://']) {
      expect(parseTransport(malo)).toBeNull();
    }
  });
});
