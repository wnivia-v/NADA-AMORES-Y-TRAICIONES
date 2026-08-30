import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

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
            'mediapipe': ['@mediapipe/tasks-vision'],
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
      'import.meta.env.VITE_GROQ_API_KEY': JSON.stringify(env.VITE_GROQ_API_KEY || ''),
      'import.meta.env.VITE_GROQ_MODEL': JSON.stringify(env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile'),
      'import.meta.env.VITE_CLAUDE_API_KEY': JSON.stringify(env.VITE_CLAUDE_API_KEY || ''),
      'import.meta.env.VITE_CLAUDE_MODEL': JSON.stringify(env.VITE_CLAUDE_MODEL || 'claude-sonnet-4-20250514'),
      'import.meta.env.VITE_BEDROCK_ENDPOINT': JSON.stringify(env.VITE_BEDROCK_ENDPOINT || ''),
      'import.meta.env.VITE_BEDROCK_API_KEY': JSON.stringify(env.VITE_BEDROCK_API_KEY || ''),
      'import.meta.env.VITE_BEDROCK_MODEL': JSON.stringify(env.VITE_BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0'),
      // Firebase App Check — needed for Gemini to work
      'import.meta.env.VITE_RECAPTCHA_ENTERPRISE_KEY': JSON.stringify(env.VITE_RECAPTCHA_ENTERPRISE_KEY || ''),
      // Venice.ai
      'import.meta.env.VITE_VENICE_API_KEY': JSON.stringify(env.VITE_VENICE_API_KEY || ''),
      'import.meta.env.VITE_VENICE_MODEL': JSON.stringify(env.VITE_VENICE_MODEL || 'llama-3.3-70b'),
    },
    plugins: [
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
          globIgnores: ['**/*.wasm'],
          runtimeCaching: [
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
        '/api/venice': {
          target: 'https://api.venice.ai',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/venice/, ''),
        },
      },
    },
  };
});
