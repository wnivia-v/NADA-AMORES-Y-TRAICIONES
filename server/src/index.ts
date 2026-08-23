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
import { handleFeedback, handleDeleteReports, type Sender } from './handlers/feedback';
import { parseDeviceContext } from '../../src/shared/telemetry/types';
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


/** Lee el cuerpo, lo parsea y delega. Un JSON roto es 400, no una excepcion. */
function withJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | undefined,
  handler: (parsed: unknown) => Promise<HandlerResponse>,
): void {
  // Los dos fallos posibles se distinguen a proposito.
  //
  // La primera version tenia un solo .catch() al final que respondia 413 a todo,
  // asi que una base de datos caida se reportaba como "cuerpo demasiado grande"
  // — y quien fuera a depurarlo se iba a mirar el tamaño de las peticiones. Un
  // mensaje de error que apunta al sitio equivocado cuesta mas tiempo que no
  // tener mensaje.
  readBody(req)
    .catch(() => {
      send(res, origin, { status: 413, body: { error: 'cuerpo demasiado grande' } });
      return null;
    })
    .then((rawBody) => {
      if (rawBody === null) return undefined;

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        send(res, origin, { status: 400, body: { error: 'JSON invalido' } });
        return undefined;
      }

      return handler(parsed)
        .then((result) => send(res, origin, result))
        .catch((error: unknown) => {
          // El motivo va al registro del operador, no al cliente: puede llevar
          // dentro la cadena de conexion o parte de la consulta.
          console.error('[NADA][server] fallo al procesar la peticion:', error);
          send(res, origin, { status: 500, body: { error: 'error interno' } });
        });
    });
}

/**
 * Quien envia, segun el servidor.
 *
 * La IP se lee SIEMPRE, y de la conexion — nunca de lo que diga el cliente. El
 * contexto del aparato solo llega si la telemetria esta encendida, y llega
 * dentro del cuerpo: no hay cabecera propia porque no es una credencial, es
 * un dato mas del reporte.
 */
function senderOf(req: IncomingMessage, body: unknown): Sender {
  const device = typeof body === 'object' && body !== null
    ? parseDeviceContext((body as Record<string, unknown>)['device'])
    : null;
  return { ip: clientKey(req), device };
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

  // --- Reportes ---

  if (req.method === 'POST' && url.pathname === '/v1/feedback') {
    withJsonBody(req, res, origin, (parsed) => handleFeedback(parsed, senderOf(req, parsed)));
    return;
  }

  // Derecho de supresion sin cuenta: se borra lo de esta instalacion. El
  // identificador viaja en el cuerpo, igual que al enviar.
  if (req.method === 'DELETE' && url.pathname === '/v1/reports') {
    withJsonBody(req, res, origin, (parsed) =>
      handleDeleteReports(senderOf(req, parsed)));
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
  console.log(`[NADA][server] escuchando en http://127.0.0.1:${PORT}`);
  console.log(
    upstreams.length > 0
      ? `[NADA][server] proveedores configurados: ${upstreams.join(', ')}`
      : '[NADA][server] sin proveedores configurados — la app seguira funcionando en local',
  );
});
