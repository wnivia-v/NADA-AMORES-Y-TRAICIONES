// =============================================================================
// Compila el worker de vision como script CLASICO, fuera del pipeline de Vite.
//
// El worker no puede ser de tipo module: el cargador WASM de MediaPipe usa
// importScripts, que en un worker de tipo module no existe (ver la cabecera de
// src/workers/vision.worker.ts). Y Vite no puede darnos uno clasico donde hace
// falta: `worker.format: 'iife'` solo se aplica al construir; en desarrollo
// sirve TODOS los workers como modulos ES. Se comprobo en Chromium — la URL
// que carga el navegador termina en `?worker_file&type=module` pase lo que
// pase.
//
// Eso producia el peor tipo de fallo: funcionaba compilado y se rompia
// programando. Compilandolo aqui, dev y produccion cargan exactamente el mismo
// artefacto y no hay divergencia que descubrir mas tarde.
//
// Uso:  node scripts/build-vision-worker.mjs [--dev] [--watch]
//
// En desarrollo va en modo --watch junto a Vite (ver el script `dev`). Sin
// vigilancia, editar el worker no recompila nada y el navegador sigue sirviendo
// el bundle anterior sin decir ni pio — un fallo silencioso que ya costo una
// sesion entera de depuracion.
// =============================================================================

import { build, context } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [resolve(root, 'src/workers/vision.worker.ts')],
  outfile: resolve(root, 'public/vision-worker.js'),
  bundle: true,
  // IIFE, no ESM: es lo que hace de esto un worker clasico de verdad.
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: !dev,
  sourcemap: dev,
  alias: { '@': resolve(root, 'src') },
  logLevel: 'info',
  metafile: true,
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[NADA] Worker de vision: vigilando cambios...');
} else {
  const result = await build(options);
  const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
  console.log(`[NADA] Worker de vision: public/vision-worker.js (${Math.round(bytes / 1024)} kB)`);
}
