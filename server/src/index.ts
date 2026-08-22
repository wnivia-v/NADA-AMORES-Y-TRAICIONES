// =============================================================================
// Transporte HTTP — node:http, sin dependencias
//
// No hay framework a proposito. Son dos rutas, y NADA presume de funcionar sin
// pagar nada: cada dependencia nueva es superficie de cadena de suministro en un
// proceso que ahora custodia las claves de API.
// =============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ALLOWED_ORIGINS, PORT, configuredUpstreams } from './config';
import { handleAnalyze, handleHealth, type HandlerResponse } from './handler';
import { handlePolicy } from './policy';

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
    readBody(req)
      .then((raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          send(res, origin, { status: 400, body: { error: 'JSON invalido' } });
          return undefined;
        }
        return handleAnalyze(parsed).then((result) => send(res, origin, result));
      })
      .catch(() => send(res, origin, { status: 413, body: { error: 'cuerpo demasiado grande' } }));
    return;
  }

  send(res, origin, { status: 404, body: { error: 'no encontrado' } });
});

server.listen(PORT, () => {
  const upstreams = configuredUpstreams();
  console.log(`[NADA][server] escuchando en http://127.0.0.1:${PORT}`);
  console.log(
    upstreams.length > 0
      ? `[NADA][server] proveedores configurados: ${upstreams.join(', ')}`
      : '[NADA][server] sin proveedores configurados — la app seguira funcionando en local',
  );
});
