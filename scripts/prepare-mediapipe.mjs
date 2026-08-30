// =============================================================================
// Deja los recursos de MediaPipe en public/ para servirlos desde el origen
// propio: el runtime WASM (copiado de node_modules) y el modelo de landmarks
// faciales (descargado de Google la primera vez).
//
// Antes se cargaba desde un CDN de terceros
// (cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm), y eso traia tres
// problemas que no se ven hasta que muerden:
//
//   1. `@latest`. El JS de MediaPipe sale del bundle (npm, version fijada) y el
//      WASM salia del CDN sin fijar. Son dos mitades del mismo binario: si el
//      CDN publica una version nueva, la mitad de fuera cambia sola y deja de
//      encajar con la de dentro, sin que nadie despliegue nada.
//   2. La CSP tenia que permitir ejecutar SCRIPT de un dominio de terceros. En
//      una herramienta de seguridad eso es dar permiso de ejecucion arbitraria
//      a quien controle ese dominio.
//   3. Es una PWA que dice funcionar sin conexion, y el detector facial no
//      arrancaba sin internet ni con el service worker caliente.
//
// Sirviendolo desde el propio origen desaparecen los tres. Cuesta ~33 MB en
// dist, de los que el navegador descarga solo la variante que le toca (~11 MB,
// una vez, y despues cacheada) segun tenga SIMD o no.
//
// El modelo (3,7 MB) va por el mismo camino y por el tercer motivo: una PWA que
// se instala para acompañarte en una videollamada no puede necesitar internet
// para encender el detector. Se descarga una vez en el primer build y se
// reutiliza; si ya esta, no se vuelve a pedir.
//
// Nada de esto se versiona: el runtime sale de node_modules y el modelo de su
// URL oficial, que son las dos unicas fuentes de verdad.
// =============================================================================

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const target = resolve(root, 'public/mediapipe/wasm');

if (!existsSync(source)) {
  console.error(
    '[NADA] No esta el runtime WASM de MediaPipe en node_modules.\n' +
    '       Ejecuta `npm install` antes de construir.',
  );
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log('[NADA] Runtime WASM de MediaPipe copiado a public/mediapipe/wasm');

// --- Modelo de landmarks faciales -------------------------------------------

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const modelPath = resolve(root, 'public/mediapipe/face_landmarker.task');
/** Por debajo de esto el fichero esta a medias o es una pagina de error. */
const MIN_MODEL_BYTES = 1_000_000;

if (existsSync(modelPath) && statSync(modelPath).size >= MIN_MODEL_BYTES) {
  console.log('[NADA] Modelo de landmarks ya presente, no se vuelve a descargar');
} else {
  console.log('[NADA] Descargando el modelo de landmarks faciales...');
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    console.error(
      `[NADA] No se pudo descargar el modelo (HTTP ${response.status}).\n` +
      '       Hace falta red la PRIMERA vez que se construye. Despues ya no.',
    );
    process.exit(1);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < MIN_MODEL_BYTES) {
    console.error(`[NADA] El modelo descargado ocupa ${bytes.length} bytes: eso no es el modelo.`);
    process.exit(1);
  }

  writeFileSync(modelPath, bytes);
  console.log(`[NADA] Modelo en public/mediapipe/face_landmarker.task (${Math.round(bytes.length / 1024 / 1024)} MB)`);
}
