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
npx vitest run                       # 115 tests
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

## Escudo de video (deepfake en videollamada)

`CameraAnalyzer.tsx` captura, por defecto, la **ventana/pestaña de la videollamada** vía `getDisplayMedia` (compartir pantalla), no la webcam propia — el fraude está del otro lado de la llamada, no en el propio reflejo. El modo "Mi cámara" (`getUserMedia`) sigue existiendo para pruebas/autochequeo, pero no es el caso de uso principal.

`visionService.ts` calcula señales biométricas por frame (EAR/parpadeo, jitter de landmarks, y **sincronía labial real**: correlación de Pearson entre la apertura de boca — MAR — y la energía RMS del audio capturado junto con el video). La correlación vive en `src/utils/lipSync.ts` como funciones puras, testeadas sin mocks de DOM/MediaPipe.

Puntos a no olvidar:

- **Sin pista de audio, la sincronía labial queda `measured: false`** y no cuenta como evidencia en `evaluateDeepfake`/`calculateConfidence`. Nunca inventar una confianza para eso — antes era un placeholder fijo en 0.9, lo que daba falsa sensación de verificación.
- `video` es un `ShieldId` más (`clipboard | screen | voice | video`) y reporta a `riskScorer` (`video-deepfake`) igual que los demás, pero **no puede arrancar solo con `protectionEngine.start()`**: `getDisplayMedia`/`getUserMedia` exigen gesto de usuario y permiso explícito, así que el usuario lo activa a mano desde `CameraAnalyzer` (patrón similar al de voz).
- Las alertas de deepfake tienen cooldown de 20s (`ALERT_COOLDOWN_MS` en `CameraAnalyzer.tsx`) porque se re-evalúan en cada frame (`requestAnimationFrame`); sin eso, un deepfake sostenido spamearía el historial de alertas.
- Es heurística basada en biometría facial (EAR, jitter, MAR/audio), no un clasificador entrenado contra deepfakes reales — comunicarlo así, no como detección infalible.
- **`blinkRate` tiene un warm-up de 20s (`BLINK_WARMUP_MS` en `visionService.ts`) antes de contar como evidencia.** Es una ventana rodante de 60s medida desde que arranca el análisis — en los primeros segundos de CUALQUIER sesión, incluida una persona real, todavía no hubo tiempo de acumular parpadeos normales. Sin el warm-up esto era un falso positivo sistemático justo al inicio de cada sesión, que es exactamente cuando alguien está mirando de cerca (demo, primera prueba). Jitter y sincronía labial no tienen ese problema (no dependen de una ventana de tiempo acumulada) y siguen contando desde el primer frame.
- **Consenso multi-IA para video (confirmar con una IA de visión en la nube antes de alertar) no está construido.** Es lo que pidió el usuario para bajar falsos positivos aún más, pero implica costo real de API por cada verificación — pendiente de decisión explícita, igual que el escaneo pasivo de fotos/video (ver "Estado real de las integraciones").

## Escudos que sobreviven la navegación (voz y video)

`VoiceAnalyzer.tsx` y `CameraAnalyzer.tsx` ya NO son dueños de `speechService`/`MediaStream`. Antes cada uno tenía su propio `useState('listening')`, y `ConsumerHome.tsx` además mantenía una TERCERA copia independiente con su propio `toggleVoice` — desmontar cualquiera de esos componentes (cambiar de pestaña) dejaba el reconocimiento de voz corriendo invisible mientras la UI volvía a mostrar "inactivo", y volver a tocar el botón era un no-op silencioso porque `speechService.start()` ya estaba corriendo. Eso es lo que se reportó como "parece que escucha pero no responde".

Ahora:

- **`protectionEngine.ts`** posee el ciclo de vida completo de voz (`startVoiceMonitoring`/`stopVoiceMonitoring`, transcript, análisis por fragmento con cooldown de 6s en vez de un poll fijo de 15s). `VoiceAnalyzer` y el card de voz en `ConsumerHome` son vistas delgadas sobre el mismo estado (`shieldStatus.voice`, `voiceTranscript`, `voiceRealtimeVerdict`, `voiceSpeechActive` en el store) — llamar a la acción desde cualquiera de los dos lugares mueve la MISMA sesión.
- **`videoShieldService.ts`** (nuevo) posee el `MediaStream` y el loop de `requestAnimationFrame`, con un `<video>` desprendido del DOM como fuente de frames para MediaPipe. `CameraAnalyzer` solo pide `attachPreview(videoEl)` para mostrar la imagen; cerrar la pestaña de cámara ya no mata la sesión.
- **`speechService.ts`** ahora expone `onError`/`onSpeechActivity` además del callback de transcript. Antes `onerror` con `'not-allowed'` llamaba a `stop()` sin avisarle a nadie — el shield quedaba "activo" en la UI para una sesión que ya estaba muerta. `onspeechstart`/`onspeechend` alimentan `voiceSpeechActive`, que es la única fuente real de "te estamos escuchando ahora" (antes era una suposición optimista, no una confirmación).
- `protectionEngine.start()` ahora también arranca voz automáticamente (el permiso de micrófono, una vez concedido, no vuelve a pedirse). Video NO se puede auto-arrancar — `getDisplayMedia` exige gesto de usuario fresco cada vez, no hay forma de saltarse eso — así que sigue siendo manual desde `CameraAnalyzer`/el card de video en Home.
- `FloatingBubble` se renderiza en TODAS las pestañas de `App.tsx` (incluida `debug`), no solo en modo consumidor — antes desaparecía justo al entrar a las herramientas técnicas donde vive `VoiceAnalyzer`/`CameraAnalyzer`.

## Overlay de escritorio (Electron)

Un `BrowserWindow` sin marco, transparente y `alwaysOnTop`, creado en `electron/main.cts` (`createOverlayWindow`) cuando `isProtectionActive` es true y destruido cuando se desactiva — es la respuesta real a "el escudo debe verse siempre encima de todo". Solo existe en Electron: ninguna pestaña de navegador puede dibujar sobre otras apps nativas del sistema operativo, es una barrera de seguridad de la plataforma, no una limitación de este código.

- Carga el mismo `dist/index.html`/servidor de Vite con `?overlay=1`; `main.tsx` detecta ese query param y renderiza `OverlayShield.tsx` en vez de `<App />` — sin store, sin router, un árbol de React aparte.
- El estado (activo/escaneando/último veredicto) viaja por IPC desde la ventana principal (`App.tsx` → `electronAPI.updateOverlayStatus`) hacia `main.cts` (`update-overlay-status`) y de ahí a la ventana overlay (`overlay-status-update`). No comparte Zustand/localStorage entre ventanas — cada `BrowserWindow` tiene su propio contexto de JS y el store no sincroniza entre procesos de renderer por sí solo.
- Clic en el overlay solo hace foco en la ventana principal (`focus-main-window`); apagar la protección de verdad exige la acción explícita en la ventana principal — evita que un toque accidental en una burbuja de 64px desactive la protección.
- **No probado en runtime** (este entorno no tiene display ni Electron corriendo) — verificar con `npm run electron:dev` que la ventana aparece, se mantiene encima de otras apps, y sobrevive a cambiar de espacio de trabajo/pantalla completa.

## Android (Capacitor)

`capacitor.config.ts` + carpeta `android/` envuelven el mismo `dist/` web en un WebView nativo — cero duplicación de UI/logica, es el mismo bundle de React. `android/app/src/main/assets/public` (la copia sincronizada de `dist/`) está en `.gitignore`, igual que `dist/` — se regenera con `npm run android:sync` antes de abrir el proyecto en Android Studio. `npm run android:open` abre Android Studio (o falla si no está instalado/en el PATH).

**Lo que funciona igual que en web/PWA sin tocar nada**: TextAnalyzer, ImageAnalyzer (OCR), clipboard shield, notificaciones locales del sistema (con matices, ver abajo), y el modo "Mi camara" de CameraAnalyzer (usa `getUserMedia`, que el WebView de Android sí soporta con el permiso `CAMERA`/`RECORD_AUDIO` ya declarado en el manifest).

**Escudo de voz — ahora nativo en Android.** La Web Speech API no existe en el WebView de Android, así que `protectionEngine.ts` ya no habla directamente con `speechService.ts` (esa sigue siendo la implementación web/Electron): pasa por `speechRecognitionService.ts`, que en runtime elige entre `speechService.ts` (Web Speech API) y `nativeSpeechService.ts` (bridge a un plugin Capacitor propio, `android/app/src/main/java/com/antigravity/nada/SpeechRecognitionPlugin.java`, sobre `android.speech.SpeechRecognizer`) según `Capacitor.getPlatform()`. El plugin simula escucha continua reiniciando el reconocedor tras cada resultado/error transitorio — mismo patrón de reinicio que `speechService.ts` usa en `onend` — y emite los mismos tres eventos (`transcript`, `speechActivity`, `error`) que el lado web, así que `protectionEngine.ts` no distingue de qué plataforma vienen. Sin probar en un dispositivo real todavía (este entorno no tiene SDK de Android); revisar permisos en runtime (`RECORD_AUDIO`) y el flujo de reinicio en un demo largo antes de confiar en él para una grabación en vivo.

**Lo que NO funciona sin un plugin nativo nuevo** — no asumir que "ya está" solo porque compila:

- **Modo "Videollamada" del escudo de video**: `getDisplayMedia` no existe en un WebView de Android. Capturar la pantalla en Android requiere la API nativa `MediaProjection` vía un plugin propio — no hay un plugin comunitario maduro y listo para esto, es trabajo nativo real (Kotlin) a construir.
- **Overlay flotante siempre-encima** (el equivalente al de Electron): en Android existe (`SYSTEM_ALERT_WINDOW`, "dibujar sobre otras apps"), pero exige un plugin nativo que pida ese permiso especial (no es un permiso de manifest normal, el usuario lo concede en una pantalla de Ajustes aparte) y dibuje la ventana. No implementado todavía; el permiso ni siquiera está declarado en el manifest hasta que se construya.
- **Notificaciones**: el código actual usa la Web Notification API (`notificationService.ts`), cuyo soporte dentro de un WebView es inconsistente entre versiones de Android System WebView. Para notificaciones confiables hace falta `@capacitor/local-notifications` en vez de la API web.

**Distribución**: pensado para APK directo (sin Play Store) — sin cuenta de desarrollador ni revisión de Google, el usuario instala habilitando "origenes desconocidos". Requiere generar un keystore de firma (`keytool -genkeypair ...`) y configurar `android/app/build.gradle` con `signingConfigs` antes de `./gradlew assembleRelease`; sin eso solo se puede generar un APK de debug (`assembleDebug`), instalable pero sin firma de release.

**No compilado en este entorno** (sin SDK/JDK de Android acá) — el andamiaje (`npx cap add android`) se generó y el manifest se edito a mano, pero nunca se corrió `./gradlew` de verdad. Verificar en una maquina con Android Studio.

## Trampas conocidas del código

No razonar sobre estos puntos de memoria — están así hoy:

- **`partialize` en `useNadaStore`** define qué sobrevive a un recargado. Un campo nuevo que no esté en esa lista se resetea en silencio.
- **`noUncheckedIndexedAccess` está activo.** `arr[0]` es `T | undefined`. Resolver con `?? fallback`, nunca con `!`.
- **`getByteTimeDomainData` (Web Audio API) exige `Uint8Array<ArrayBuffer>`, no `Uint8Array<ArrayBufferLike>`.** Desde TypeScript 5.7, `new Uint8Array(n)` sola ya no alcanza para ese tipo; hace falta `new Uint8Array(new ArrayBuffer(n))` y anotar el campo como `Uint8Array<ArrayBuffer>`. Ver `visionService.ts`.

### Ya resueltos (no reabrir sin evidencia nueva)

Estos bugs figuraban antes en esta lista; el código actual ya los corrige. Si algo de esto vuelve a fallar, es una regresión, no un bug conocido pendiente:

- `geminiService.ts` cancelaba análisis entre sí por un `AbortController` único. Ahora `controllers` es un `Map<AnalysisScope, AbortController>` — cada lane (`ui`/`clipboard`/`screen`/`voice`) se cancela solo a sí misma.
- `addAlert` y `setAnalysisResult` contaban el mismo evento dos veces. `addAlert` ya no toca contadores; `setAnalysisResult`/`recordDailyScan` son la única fuente de verdad.
- `startScreenMonitor` duplicaba el listener `onScreenCapture` en cada `start()`. Ahora se registra una sola vez en `init()` vía `bindScreenCaptureListener` con una bandera de guardia.
- El worker de OCR no serializaba trabajos concurrentes. `ocrService.ts` ahora encola cada `recognize()` en una cadena de promesas (`enqueue`).
- El icono de Electron era un SVG (`favicon.svg`), que Windows no acepta para `BrowserWindow`/`Tray`. Ahora usa `build/icon.png` vía `scripts/generate-icon.mjs`.
- `ocrService.ts` mandaba la imagen cruda a Tesseract sin preprocesar. Capturas de chat (texto chico, burbujas de color) salían ilegibles ("borroso") aunque la imagen fuera nítida. Ahora hay un paso de escalado + escala de grises + contraste antes del OCR (`preprocess()` en `ocrService.ts`); si el preprocesado falla por lo que sea, cae de vuelta a la imagen original en vez de perder el OCR entero.
- `scamPatterns.ts` solo cubría fraude financiero — un mensaje de puro acoso/bullying (insultos, sin ninguna señal de dinero/urgencia) daba 0/100. Ahora hay categorías de lenguaje agresivo y hostigamiento severo con peso `repeatable` (escala con cuántos insultos distintos aparecen, no un peso fijo) — un insulto suelto sigue sin disparar alerta, varios en la misma conversación sí.

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

NADA tiene que funcionar sin que nadie pague nada. Prioridad por defecto: `local` (en el dispositivo, sin clave), luego `groq` (tier gratuito sin tarjeta), luego `gemini` (tier gratuito, exige que el proyecto de Firebase siga en plan Spark sin facturación vinculada). `claude` y `bedrock` están desactivados por defecto porque cuestan dinero. Estrategia por defecto: `race` (dispara todos los proveedores activos y usa el que responda primero); configurable por el usuario en Settings (`STRATEGY_INFO` en `SettingsView.tsx`).

Nunca proponer una solución que exija una cuenta de pago sin decir antes que existe el camino gratuito. Los límites de cuota de cada proveedor están en su definición y los aplica `rateLimiter.ts`: superarlos devuelve 429, que se convierte en un resultado nulo y degrada el veredicto en silencio.

**Sin ninguna clave de nube configurada, la única IA activa es `local`** — un clasificador de embeddings que decide por vecinos-mas-cercanos contra `src/data/scam-corpus.json` y **declina a propósito** (devuelve `null`) cuando la similitud o el consenso del vecindario es bajo (`MIN_SIMILARITY`/`MIN_CONFIDENCE` en `localProvider.ts`, ajustados con un barrido documentado en el propio archivo — no tocar esos numeros sin volver a correr el barrido). Cuando `local` declina, el pipeline cae al escaneo de patrones regex (`scamPatterns.ts`), que es deliberadamente estrecho: solo dispara con frases que calzan casi literalmente. El resultado practico es que frases de extorsion o amenaza dichas con fraseo distinto al de los ejemplos no producen ninguna alerta — no es un bug de "bloqueo", es el diseño sin IA de nube configurada. La palanca real para mejorar el recall en frases arbitrarias es activar `groq` (gratis, sin tarjeta) en `.env.local`, no bajar los umbrales del clasificador local.

## Límites

No hacer commit ni push salvo petición explícita. No ejecutar `aws`, `firebase deploy`, `vercel` ni `npm publish` — preparar el comando y dejar que lo lance el usuario. No escribir credenciales reales en ningún archivo, `.env.example` incluido.
