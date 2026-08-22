// =============================================================================
// Transporte HTTP — node:http, sin dependencias
//
// No hay framework a proposito. Son dos rutas, y NADA presume de funcionar sin
// pagar nada: cada dependencia nueva es superficie de cadena de suministro en un
// proceso que ahora custodia las claves de API.
// =============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ALLOWED_ORIGINS, PORT, VERIFY_URL_BASE, configuredUpstreams } from './config';
import { handleAnalyze, handleHealth, type HandlerResponse } from './handler';
import { handlePolicy } from './policy';
import {
  handleRegister, handleVerify, handleLogin, handleLogout,
  handleDeleteAccount, authenticate, type RequestContext,
} from './handlers/accounts';
import { handleFeedback } from './handlers/feedback';
import { mailerMode } from './auth/mailer';
import { initStore } from './store';

/** Tope de cuerpo. Corta la lectura en cuanto se pasa, sin acumular en memoria. */
const MAX_BODY_BYTES = 64 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Electron y las pruebas locales llegan sin cabecera Origin. Se aceptan, pero
 * sin devolver comodin: `Access-Control-Allow-Origin: *` con credenciales seria
 * abrir el proxy a cualquier pagina del navegador del usuario.
 */
function corsHeaders(origin: string | undefined): Record<string, string> {
  const base = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (!origin) return base;
  if (!ALLOWED_ORIGINS.includes(origin)) return base;
  return { ...base, 'Access-Control-Allow-Origin': origin };
}

function send(res: ServerResponse, origin: string | undefined, { status, body }: HandlerResponse) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...corsHeaders(origin),
  });
  res.end(payload);
}

/** El token de sesion viaja en Authorization: Bearer, no en cookie.
 *
 * La app es de otro origen que el API, asi que una cookie exigiria SameSite=None
 * y traeria consigo el problema de CSRF. Una cabecera que el navegador no manda
 * sola no lo tiene.
 */
function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Clave para el limite de ritmo.
 *
 * Se usa SOLO para contar y nunca se guarda: no hay tabla de IPs ni registro de
 * accesos. Una direccion IP es un dato personal, y aqui es un contador en
 * memoria que se olvida al reiniciar.
 */
function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? req.socket.remoteAddress ?? 'desconocido').trim();
}

function requestContext(req: IncomingMessage): RequestContext {
  return {
    clientKey: clientKey(req),
    verifyUrlBase: VERIFY_URL_BASE,
  };
}

/** Lee el cuerpo, lo parsea y delega. Un JSON roto es 400, no una excepcion. */
function withJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | undefined,
  handler: (parsed: unknown) => Promise<HandlerResponse>,
): void {
  readBody(req)
    .then((rawBody) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        send(res, origin, { status: 400, body: { error: 'JSON invalido' } });
        return undefined;
      }
      return handler(parsed).then((result) => send(res, origin, result));
    })
    .catch(() => send(res, origin, { status: 413, body: { error: 'cuerpo demasiado grande' } }));
}

/** Resuelve la sesion y delega, o responde 401. */
function withAuth(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | undefined,
  handler: (auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>) => Promise<HandlerResponse>,
): void {
  void authenticate(bearerToken(req)).then((auth) => {
    if (!auth) {
      send(res, origin, { status: 401, body: { error: 'sesion invalida' } });
      return;
    }
    return handler(auth).then((result) => send(res, origin, result));
  });
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, origin, handleHealth());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/policy') {
    // Sin autenticacion: el aviso de privacidad hay que poder enseñarlo antes
    // de pedirle nada a nadie, incluida una cuenta.
    send(res, origin, handlePolicy(url.searchParams.get('region')));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/analyze') {
    withJsonBody(req, res, origin, handleAnalyze);
    return;
  }

  // --- Cuentas ---

  if (req.method === 'POST' && url.pathname === '/v1/accounts') {
    withJsonBody(req, res, origin, (parsed) => handleRegister(parsed, requestContext(req)));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/accounts/verify') {
    withJsonBody(req, res, origin, handleVerify);
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/accounts') {
    withAuth(req, res, origin, handleDeleteAccount);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/sessions') {
    withJsonBody(req, res, origin, (parsed) => handleLogin(parsed, requestContext(req)));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/sessions') {
    void handleLogout(bearerToken(req)).then((result) => send(res, origin, result));
    return;
  }

  // --- Reportes ---

  if (req.method === 'POST' && url.pathname === '/v1/feedback') {
    withAuth(req, res, origin, (auth) =>
      new Promise<HandlerResponse>((resolve) => {
        readBody(req)
          .then((rawBody) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(rawBody);
            } catch {
              resolve({ status: 400, body: { error: 'JSON invalido' } });
              return undefined;
            }
            return handleFeedback(parsed, auth).then(resolve);
          })
          .catch(() => resolve({ status: 413, body: { error: 'cuerpo demasiado grande' } }));
      }),
    );
    return;
  }

  send(res, origin, { status: 404, body: { error: 'no encontrado' } });
});

// El almacen se elige ANTES de escuchar: aceptar peticiones sin saber donde se
// van a guardar las cuentas seria aceptar a ciegas.
void initStore().then((kind) => {
  console.log(`[NADA][server] almacen: ${kind}`);
});

server.listen(PORT, () => {
  const upstreams = configuredUpstreams();
  // Un despliegue sin transporte de correo deja a todo el mundo sin poder
  // verificar su cuenta. Se avisa al arrancar, no cuando lo descubra un usuario.
  if (mailerMode() === 'missing') {
    console.error('[NADA][server] SIN MAIL_TRANSPORT: nadie podra verificar su cuenta');
  }
  console.log(`[NADA][server] escuchando en http://127.0.0.1:${PORT}`);
  console.log(
    upstreams.length > 0
      ? `[NADA][server] proveedores configurados: ${upstreams.join(', ')}`
      : '[NADA][server] sin proveedores configurados — la app seguira funcionando en local',
  );
});
