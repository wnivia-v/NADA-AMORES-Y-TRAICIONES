---
inclusion: always
---

# NADA — contexto y estándares del proyecto

Detector de estafas y fraude romántico. React 18 + TypeScript + Vite 6 + Zustand 5 + Tailwind, empaquetado también como app de escritorio con Electron 33 y como PWA.

## Quién usa esto

Personas que están siendo estafadas en este momento. Con frecuencia mayores de 60, con frecuencia asustadas, a veces guiadas en tiempo real por el estafador para que ignoren las advertencias. Un falso negativo significa que alguien pierde su dinero.

De eso se derivan dos reglas que dominan cualquier otra consideración técnica:

1. **Un falso negativo cuesta más que un falso positivo.** Ante la duda, el sistema advierte.
2. **Un fallo silencioso es el peor fallo posible.** Si el análisis se rompe y la app sigue mostrando "protegido", mentimos al usuario en el momento exacto en que nos necesita.

## Cadena de verificación

Windows con PowerShell: usar `;` como separador, nunca `&&`. Rutas con espacios entre comillas dobles.

```
npx tsc --noEmit                     # typecheck app
npx tsc -p tsconfig.electron.json    # compila electron/*.cts -> *.cjs
npx vitest run                       # 55+ tests
npx vite build                       # build web/PWA
```

El paso de Electron **emite**, no lleva `--noEmit`: `main.cts` y `preload.cts` se compilan a `main.cjs` y `preload.cjs` junto al fuente, que es lo que `package.json` (`"main": "electron/main.cjs"`) y la ruta del preload esperan. Añadir `--noEmit` no sirve aquí y `tsconfig.electron.json` no debe volver a declarar `outDir`/`rootDir` apuntando a `electron/`: TypeScript excluye el `outDir` de los inputs y el resultado es `TS18003: No inputs were found`, que dejó los tres scripts de Electron rotos en su primer paso durante todo el proyecto.

Ejecutar la cadena completa antes de dar algo por terminado. Que el build salga sin error no prueba que funcione: `electron:build` sigue sin verificarse de extremo a extremo, y el typecheck de Electron detecta poco porque esos dos archivos usan `require` y `any`.

## Arquitectura del pipeline

El análisis atraviesa cinco capas, en este orden:

1. `scamDatabase.ts` — caché IndexedDB con hashes SHA-256. Si acierta, devuelve sin llamar a la IA.
2. `scamPatterns.ts` — 25+ regex con peso. Única capa que funciona sin red ni API keys.
3. `safeBrowsingService.ts` — URLs contra Google Safe Browsing.
4. `aiProviders/` — Gemini, Claude o Bedrock, según la estrategia configurada (`fallback`, `race`, `best-result`, `consensus`).
5. `riskScorer.ts` — agrega señales con decaimiento temporal; se mezcla 80/20 con el resultado de la IA.

Umbrales: `SEGURO` 0-39, `SOSPECHOSO` 40-69, `PELIGROSO` 70-100. Están codificados en varios sitios; cambiarlos altera lo que la app le dice a una víctima y requiere aprobación explícita.

## Trampas conocidas del código

No razonar sobre estos puntos de memoria — están así hoy:

- **`geminiService.ts` tiene un único `currentAbortController` a nivel de módulo.** `analyzeText` y `analyzeVoiceFragment` lo abortan al entrar. El escudo de portapapeles, el de pantalla, el bucle de voz de 15 s y la UI pasan todos por ahí, así que se cancelan entre sí y el resultado degrada a local sin avisar.
- **Contadores duplicados.** `addAlert` y `setAnalysisResult` incrementan ambos `historyCount` y `threatsToday`, y `triggerThreatAlert` llama a los dos.
- **`partialize` en `useNadaStore`** define qué sobrevive a un recargado. Un campo nuevo que no esté en esa lista se resetea en silencio.
- **`startScreenMonitor` registra el listener `onScreenCapture` en cada `start()`**, así que alternar la protección acumula listeners.
- **`noUncheckedIndexedAccess` está activo.** `arr[0]` es `T | undefined`. Resolver con `?? fallback`, nunca con `!`.
- **Worker OCR único sin control de concurrencia** en `ocrService.ts`, compartido por el escudo de pantalla y `ImageAnalyzer`.
- **Windows no acepta SVG para iconos de Electron.** `main.cts` pasa `favicon.svg` a `BrowserWindow` y al tray; hace falta `.ico`.

## Estado real de las integraciones

Ser honesto sobre esto en documentación y en respuestas al usuario:

- **Bedrock no funciona.** `bedrockProvider.ts` es cliente de un proxy que nadie ha construido. AWS exige firma SigV4, imposible desde el navegador sin exponer credenciales.
- **`VITE_CLAUDE_API_KEY` viaja en el bundle.** `vite.config.ts` la inyecta con `define`, así que queda en texto plano en `dist/`. Aceptable en local, inaceptable en un despliegue público.
- **Sin API keys la app funciona en modo local** solo con regex. Ese camino tiene que seguir siendo válido.

## Convenciones

Español sin acentos en los strings de la UI existentes — mantener la consistencia con `translations.ts` en lugar de mezclar estilos. Todo texto visible pasa por `translations.ts`; escribir español en el JSX rompe el modo inglés en silencio.

Estilos con variables CSS (`var(--accent)`, `var(--danger)`) para que ambos temas funcionen. No introducir colores literales.

Nada de `catch {}` vacío en el pipeline de análisis. Si se ignora una condición esperada, dejarlo dicho; si es un error real, registrarlo.

Los tests se ejecutan con Vitest sobre jsdom y `fake-indexeddb`. Toda corrección de detección lleva un caso de regresión con el texto exacto que fallaba, y `src/data/scam-corpus.json` es el corpus de referencia: cada falso negativo real que aparezca se añade ahí de forma permanente.

El corpus vive en `src/data/` porque no es solo material de test: el proveedor local (`localProvider.ts`) lo importa en runtime y clasifica por similitud semántica contra él. Cambiar el corpus cambia el comportamiento del producto, no solo el de las pruebas, y obliga a volver a medir con `node bench/local-provider.mjs`.

## Coste y proveedores

NADA tiene que funcionar sin que nadie pague nada. Prioridad por defecto: `local` (en el dispositivo, sin clave), luego `gemini` (tier gratuito, exige que el proyecto de Firebase siga en plan Spark sin facturación vinculada), luego `groq` (tier gratuito sin tarjeta). `claude` y `bedrock` están desactivados por defecto porque cuestan dinero.

Nunca proponer una solución que exija una cuenta de pago sin decir antes que existe el camino gratuito. Los límites de cuota de cada proveedor están en su definición y los aplica `rateLimiter.ts`: superarlos devuelve 429, que se convierte en un resultado nulo y degrada el veredicto en silencio.

## Límites

No hacer commit ni push salvo petición explícita. No ejecutar `aws`, `firebase deploy`, `vercel` ni `npm publish` — preparar el comando y dejar que lo lance el usuario. No escribir credenciales reales en ningún archivo, `.env.example` incluido.
