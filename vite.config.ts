import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    base: '/',
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'transformers': ['@huggingface/transformers'],
            'firebase': ['firebase/app', 'firebase/ai', 'firebase/app-check'],
          },
        },
      },
    },
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(env.VITE_FIREBASE_API_KEY || ''),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN || ''),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(env.VITE_FIREBASE_PROJECT_ID || ''),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET || ''),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(env.VITE_FIREBASE_APP_ID || ''),
      'import.meta.env.VITE_SAFE_BROWSING_API_KEY': JSON.stringify(env.VITE_SAFE_BROWSING_API_KEY || ''),
      // Multi-AI providers
      // Las claves de Groq, Claude y Bedrock YA NO SE INYECTAN AQUI.
      //
      // `define` sustituye estas expresiones por el valor literal dentro del
      // bundle, asi que cualquier clave que aparezca en esta lista acaba en
      // texto plano en dist/assets/*.js. Viven ahora en el entorno del servidor
      // (server/src/config.ts), sin prefijo VITE_ y sin cruzar al navegador.
      //
      // No añadas aqui ninguna credencial: si algo necesita una clave secreta,
      // es que va en el backend.
      'import.meta.env.VITE_NADA_API_URL': JSON.stringify(env.VITE_NADA_API_URL || ''),
      // Version de la app, leida de package.json. Va en cada reporte de
      // feedback: sin ella no se puede saber si una queja se refiere a algo que
      // ya se arreglo. No es un secreto ni una credencial, solo una etiqueta.
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(
        JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version,
      ),
      // Firebase App Check — needed for Gemini to work
      'import.meta.env.VITE_RECAPTCHA_ENTERPRISE_KEY': JSON.stringify(env.VITE_RECAPTCHA_ENTERPRISE_KEY || ''),
    },
    plugins: [
      // La CSP de index.html se arma aqui para que connect-src refleje a donde
      // habla de verdad esta build. api.anthropic.com y api.groq.com salieron
      // de la lista: esas llamadas las hace ahora el servidor. Si alguien
      // reintroduce una llamada directa desde el navegador, la CSP la bloquea y
      // se nota, en vez de volver a filtrar una clave en silencio.
      {
        name: 'nada-csp',
        transformIndexHtml(html: string) {
          const apiOrigin = env.VITE_NADA_API_URL
            ? new URL(env.VITE_NADA_API_URL).origin
            : '';
          return html.replace('%NADA_API_ORIGIN%', apiOrigin);
        },
      },
      // MediaPipe carga su runtime con un import() en tiempo de ejecucion. En la
      // build eso es una peticion estatica normal y funciona, pero el servidor
      // de desarrollo lo ve como un modulo del grafo y se niega a servirlo:
      // "This file is in /public ... should not be imported from source code".
      // O sea que el detector facial funcionaba compilado y no funcionaba
      // programando, que es la peor forma de romperse.
      //
      // Este middleware devuelve esos archivos tal cual, antes de que el
      // pipeline de transformacion los toque.
      {
        name: 'nada-mediapipe-runtime',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = (req.url ?? '').split('?')[0] ?? '';
            if (!url.startsWith('/mediapipe/')) return next();

            const file = path.resolve(__dirname, 'public', url.replace(/^\//, ''));
            if (!file.startsWith(path.resolve(__dirname, 'public/mediapipe'))) return next();
            if (!fs.existsSync(file)) return next();

            res.setHeader(
              'Content-Type',
              file.endsWith('.wasm') ? 'application/wasm'
                : file.endsWith('.js') ? 'text/javascript'
                : 'application/octet-stream',
            );
            fs.createReadStream(file).pipe(res);
          });
        },
      },
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon.png'],
        manifest: {
          name: 'NADA Amores y Traiciones — Scam Shield',
          short_name: 'NADA Shield',
          description: 'Deteccion de fraude en tiempo real con IA',
          theme_color: '#0A0E17',
          background_color: '#0A0E17',
          display: 'standalone',
          orientation: 'portrait',
          // A raster icon is required for reliable install prompts and
          // maskable icons; SVG-only manifests are poorly supported on Android.
          icons: [
            { src: 'icon.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // The onnxruntime WASM that powers the on-device model is ~21MB.
          // Precaching it would force every user to download it during install,
          // which is exactly wrong for people on poor connections. It is cached
          // on first use instead, so the app installs light and still works
          // offline afterwards.
          // Al runtime de MediaPipe se le aplica la misma regla que al de onnx,
          // y por el mismo motivo: son tres variantes del cargador (~320 KB
          // cada una) de las que cada dispositivo usa exactamente UNA, segun
          // tenga SIMD o hilos. Precachearlas las tres obligaria a todo el
          // mundo a bajarse un mega de mas durante la instalacion, dos tercios
          // del cual no va a ejecutar nunca.
          globIgnores: ['**/*.wasm', 'mediapipe/**'],
          runtimeCaching: [
            {
              // Runtime de MediaPipe servido desde nuestro origen. CacheFirst
              // es lo que hace que el detector facial arranque sin conexion.
              urlPattern: /\/mediapipe\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'nada-mediapipe-runtime',
                expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // onnxruntime binaries served from our own origin
              urlPattern: /\.wasm$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'nada-onnx-runtime',
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Embedding model weights, fetched from Hugging Face on first use
              urlPattern: /^https:\/\/(huggingface\.co|[^/]+\.hf\.co)\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'nada-local-model',
                expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 180 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      // Proxy Groq API calls to avoid CORS errors in the browser.
      // The browser cannot call api.groq.com directly from localhost.
      proxy: {
        '/api/groq': {
          target: 'https://api.groq.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/groq/, ''),
        },
      },
    },
  };
});
