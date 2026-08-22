// =============================================================================
// Piloto de Chromium para el banco de humo del worker
//
// Habla CDP a pelo sobre el WebSocket global de Node 22, sin instalar nada. No
// es purismo: meter Playwright en package.json por una comprobacion de humo
// añadiria una dependencia de desarrollo grande a un proyecto cuyo brief dice
// que el stack no se toca sin consultar. El binario de Chromium ya esta en el
// entorno, y CDP es la misma interfaz que usaria Playwright por debajo.
//
// Uso:  node bench/chromium-smoke.mjs [url]
// =============================================================================

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:5173/bench/worker-smoke.html';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'nada-chrome-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  // El banco arranca el <video> sin que nadie haya hecho clic.
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const chromeLog = [];
chrome.stderr.on('data', (b) => chromeLog.push(b.toString()));

function cleanup(code) {
  chrome.kill('SIGKILL');
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* da igual */ }
  process.exit(code);
}

async function waitForDevTools() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* todavia no escucha */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Chromium no abrio el puerto de depuracion.\n${chromeLog.join('')}`);
}

/** Cliente CDP minimo: un id incremental y un mapa de promesas pendientes. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  let nextId = 1;

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      return;
    }
    events.push(message);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('no se pudo abrir el WebSocket de CDP')));
  });

  return {
    ready,
    events,
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      });
    },
  };
}

async function main() {
  await waitForDevTools();

  // /json/new abre una pestaña y devuelve su propio endpoint de depuracion.
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_)}`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error(`no se pudo abrir la pestaña: ${res.status}`);
  const target = await res.json();

  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');

  // El servidor de desarrollo recarga la pagina la primera vez que descubre una
  // dependencia nueva que optimizar (MediaPipe lo es), asi que el contexto de
  // ejecucion se destruye debajo de los pies. Se espera a que aparezca uno
  // ESTABLE: runSmoke presente y quieto durante varias comprobaciones seguidas.
  let stable = 0;
  for (let i = 0; i < 120 && stable < 4; i += 1) {
    try {
      const probe = await cdp.send('Runtime.evaluate', {
        expression: 'typeof window.runSmoke',
        returnByValue: true,
      });
      stable = probe.result.value === 'function' ? stable + 1 : 0;
    } catch {
      // "Execution context was destroyed": justo la recarga que esperabamos.
      stable = 0;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (stable < 4) throw new Error('la pagina del banco nunca expuso runSmoke');

  // Engancharse a los workers antes de arrancar: es la unica forma de ver que
  // pasa DENTRO del worker de vision, que es donde vive todo lo interesante.
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  const pendingRun = cdp.send('Runtime.evaluate', {
    expression: 'window.runSmoke()',
    awaitPromise: true,
    returnByValue: true,
    timeout: 180_000,
  });

  // Mientras corre, se le pregunta al worker por su contexto de ejecucion.
  const workerProbes = [];
  const seen = new Set();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && workerProbes.length === 0) {
    for (const event of cdp.events.filter((e) => e.method === 'Target.attachedToTarget')) {
      const { sessionId, targetInfo } = event.params;
      if (seen.has(sessionId) || !targetInfo.type.includes('worker')) continue;
      seen.add(sessionId);
      try {
        await cdp.send('Runtime.enable', {}, sessionId);
        await cdp.send('Network.enable', {}, sessionId);
        const probe = await cdp.send('Runtime.evaluate', {
          expression:
            'JSON.stringify({ importScripts: typeof importScripts, document: typeof document, ' +
            'moduleFactory: typeof self.ModuleFactory, url: self.location.href })',
          returnByValue: true,
        }, sessionId);
        workerProbes.push({ url: targetInfo.url, context: probe.result.value });
      } catch (error) {
        workerProbes.push({ url: targetInfo.url, error: String(error) });
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const result = await pendingRun;

  // Peticiones fallidas hechas DESDE el worker: es donde se descargan el
  // runtime WASM y el modelo, y un fallo ahi solo se ve como "Failed to fetch".
  const urlByRequest = new Map(
    cdp.events
      .filter((e) => e.method === 'Network.requestWillBeSent')
      .map((e) => [e.params.requestId, e.params.request.url]),
  );
  const workerNetwork = cdp.events
    .filter((e) => e.method === 'Network.loadingFailed')
    .map((e) => `${e.params.errorText} ${urlByRequest.get(e.params.requestId) ?? '(url desconocida)'}`);
  const workerResponses = cdp.events
    .filter((e) => e.method === 'Network.responseReceived' && e.params.response.url.includes('/mediapipe/'))
    .map((e) => `${e.params.response.status} ${e.params.response.url}`);

  const value = result.result?.value;
  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text);

  // Un 404 en consola no dice QUE falto. Con el dominio Network si.
  const badRequests = cdp.events
    .filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400)
    .map((e) => `${e.params.response.status} ${e.params.response.url}`);

  console.log(JSON.stringify(
    { result: value, workerProbes, workerNetwork, workerResponses, consoleErrors: errors, badRequests },
    null, 2,
  ));
  cleanup(value?.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('[banco] fallo:', error.message);
  console.error(chromeLog.join('').split('\n').slice(-20).join('\n'));
  cleanup(1);
});
