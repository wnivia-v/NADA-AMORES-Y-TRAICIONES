# NADA — Amores y Traiciones v2

> Deteccion de fraude en tiempo real con IA multi-proveedor.  
> Hackaton Kiro — 23 Julio 2026 | Equipo Antigravity

## Que es NADA?

NADA es una aplicacion de proteccion contra estafas, fraudes romanticos y manipulacion psicologica. Analiza textos, llamadas en tiempo real, imagenes y capturas de pantalla utilizando multiples inteligencias artificiales para detectar patrones de engano.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      NADA v2 Architecture                    │
├─────────────────────────────────────────────────────────────┤
│  React 18 + Zustand + Tailwind CSS (Frontend)               │
│  ├── ConsumerHome (proteccion, stats, trend chart)          │
│  ├── TextAnalyzer (pegar texto sospechoso)                  │
│  ├── VoiceAnalyzer (escucha en tiempo real c/15s)           │
│  ├── CameraAnalyzer (deepfake detection MediaPipe)          │
│  └── ImageAnalyzer (upload screenshots → OCR → IA)         │
├─────────────────────────────────────────────────────────────┤
│  Motor de Proteccion (Background)                           │
│  ├── Clipboard Shield (portapapeles c/rate limiting)        │
│  ├── Screen Shield (OCR + desktopCapturer en Electron)      │
│  └── Voice Shield (Web Speech API + analisis live)          │
├─────────────────────────────────────────────────────────────┤
│  Pipeline de Analisis (5 capas)                             │
│  1. ScamDB (IndexedDB) — cache local, lookup instantaneo   │
│  2. Regex patterns (25+ patrones de estafa)                 │
│  3. Safe Browsing API (URLs maliciosas)                     │
│  4. AI Orchestrator (Gemini / Claude / Bedrock)             │
│  5. RiskScorer (señales con decadencia temporal)            │
├─────────────────────────────────────────────────────────────┤
│  Electron (Desktop)                                         │
│  ├── System tray + clipboard monitor nativo                 │
│  ├── desktopCapturer para OCR de pantalla                   │
│  └── Notificaciones nativas del OS                          │
└─────────────────────────────────────────────────────────────┘
```

## Features

- **Funciona sin pagar y sin claves**: analisis en el dispositivo con un modelo de embeddings local + 25 patrones regex. Los proveedores en la nube son opcionales.
- **Multi-AI**: local, Gemini (gratis), Groq (gratis), Claude y Bedrock, con 4 estrategias de orquestacion: fallback, carrera, mejor resultado y consenso.
- **Privacidad**: en el camino local, los mensajes de la victima nunca salen de su equipo.
- **Deteccion de Deepfakes**: MediaPipe Face Landmarker con analisis biometrico (EAR, blink rate, jitter).
- **OCR de capturas**: Tesseract.js para extraer texto de screenshots de WhatsApp/Telegram/SMS.
- **Analisis de voz en tiempo real**: Fragmentos analizados cada 15 segundos durante la escucha.
- **Base de datos local**: IndexedDB con hashes SHA-256 para deteccion instantanea de estafas recurrentes.
- **5 capas de deteccion**: ScamDB → regex → Safe Browsing → IA → risk scoring temporal.
- **Persistencia**: Alertas, metricas y preferencias sobreviven al refresh (zustand/persist).
- **PWA**: Instalable como app, funciona offline para analisis local.
- **Electron**: App de escritorio con tray, clipboard nativo y captura de pantalla.
- **Seguridad**: CSP, sanitizacion anti-prompt-injection, Error Boundary.
- **UX**: Onboarding, alertas expandibles, compartir, exportar CSV, audio alerts, 2 temas.

## Stack Tecnico

| Capa | Tecnologia |
|------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, Zustand 5 |
| IA | Firebase AI (Gemini 2.0 Flash), Anthropic Claude, AWS Bedrock (via proxy) |
| Vision | MediaPipe Tasks Vision, TensorFlow.js |
| OCR | Tesseract.js 5 |
| Speech | Web Speech API |
| Desktop | Electron 33, electron-builder |
| Build | Vite 6, vite-plugin-pwa |
| Tests | Vitest 4 (jsdom, fake-indexeddb) — 75 tests |
| URLs | Google Safe Browsing API v4 |

## Inicio Rapido

```bash
# 1. Clonar e instalar
git clone <repo-url>
cd nada-amores-y-traiciones-kiro
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con tus API keys

# 3. Desarrollo web
npm run dev

# 4. Desarrollo Electron
npm run electron:dev

# 5. Tests
npm test                   # 75 tests, una pasada
npm run test:watch         # modo watch

# 6. Build produccion
npm run build              # Web/PWA -> dist/
npm run electron:build     # Instalador Windows -> release/
```

`npm run electron:build` produce `release/NADA-Shield-2.0.0-Setup.exe` (~78 MB). El icono se genera desde `scripts/generate-icon.mjs` (sin dependencias externas) y se puede regenerar solo con `npm run icon`.

### Cadena de verificacion

En Windows/PowerShell usa `;` como separador, no `&&`:

```powershell
npx tsc --noEmit                     # typecheck app
npx tsc -p tsconfig.electron.json    # compila electron/*.cts -> *.cjs (emite, sin --noEmit)
npx vitest run                       # tests
npx vite build                       # build web/PWA
```

## Coste: NADA funciona sin pagar nada

Esto no es un modo degradado, es el camino principal. **Sin ninguna clave, sin cuenta y sin tarjeta**, NADA analiza con dos capas propias:

- **Proveedor local** — un modelo de embeddings multilingue que corre en tu dispositivo y compara el mensaje contra el corpus de estafas conocidas. Nada sale de tu equipo.
- **Patrones regex** — 25+ firmas de estafa, instantaneas y sin red.

Los proveedores en la nube son una mejora opcional, no un requisito.

| Proveedor | Coste | Que necesitas | Cuota |
|-----------|-------|---------------|-------|
| **Local** | Gratis, en tu dispositivo | Nada | Sin limite |
| **Gemini** | Gratis | Proyecto Firebase en plan Spark (sin tarjeta) | ~14/min |
| **Groq** | Gratis | Cuenta en console.groq.com (sin tarjeta) | 30/min, 1000/dia |
| Claude | De pago | API key de Anthropic | — |
| Bedrock | De pago | Cuenta AWS **+ un proxy que debes desplegar** | — |

### El tier gratuito de Gemini

El detalle que importa: la Gemini Developer API tiene tier gratuito **siempre que el proyecto de Firebase NO este vinculado a una cuenta de Cloud Billing**, es decir, mientras siga en el plan Spark. Si activas facturacion, sales del tier gratuito. Ver [Firebase AI Logic pricing](https://firebase.google.com/docs/ai-logic/pricing).

Pasos: crear proyecto en [console.firebase.google.com](https://console.firebase.google.com), dejarlo en Spark, activar Firebase AI Logic, y copiar `VITE_FIREBASE_API_KEY` y `VITE_FIREBASE_PROJECT_ID` a `.env.local`.

### Variables de Entorno

Todas opcionales. Sin ninguna, la app funciona en local.

| Variable | Coste | Descripcion |
|----------|-------|-------------|
| `VITE_FIREBASE_API_KEY` | Gratis | Firebase project API key (para Gemini) |
| `VITE_FIREBASE_PROJECT_ID` | Gratis | Firebase project ID |
| `VITE_GROQ_API_KEY` | Gratis | Groq, sin tarjeta de credito |
| `VITE_GROQ_MODEL` | — | Por defecto `llama-3.3-70b-versatile` |
| `VITE_SAFE_BROWSING_API_KEY` | Gratis | Google Safe Browsing |
| `VITE_CLAUDE_API_KEY` | De pago | Ver advertencia abajo |
| `VITE_BEDROCK_ENDPOINT` | De pago | URL del proxy que firma hacia Bedrock |
| `VITE_BEDROCK_API_KEY` | De pago | API key de ese proxy |

### Cuotas

`rateLimiter.ts` cuenta las consultas por minuto y por dia de cada proveedor, y persiste el contador diario. Un proveedor sin cuota disponible se descarta antes de llamarlo, porque un 429 se convierte en resultado nulo y degradaria el veredicto sin avisar a nadie. Los intervalos de los escudos estan fijados por esa cuota, no por lo rapido que se podria sondear.

## Estado actual

Honestidad sobre lo que funciona hoy:

| Area | Estado |
|------|--------|
| PWA / web | Funciona. `vite build` verde. |
| Instalador Windows | Funciona. Verificado: la app arranca, carga el renderer desde el `app.asar` y se mantiene estable. |
| Proveedor local | **Medido**: 87.5% precision exacta, 100% recall de amenazas, 0% falsas alarmas sobre el corpus. Sin verificar todavia dentro del navegador/Electron (medido en Node). |
| Gemini (via Firebase) | Implementado. Sin medir: requiere credenciales que aun no se han configurado. |
| Groq | Implementado. Sin medir: requiere una clave gratuita. |
| Claude | Implementado, **de pago, y la clave viaja en el bundle del cliente**. Ver abajo. |
| AWS Bedrock | **No funciona sin trabajo extra.** `bedrockProvider.ts` es el cliente de un proxy que no viene incluido. |
| Deteccion local (regex) | Funciona. Precision y recall aun sin medir contra el corpus. |
| OCR en produccion | Sin verificar en runtime. Tesseract carga su worker desde `cdn.jsdelivr.net`; la CSP ya lo permite, pero no se ha ejecutado un OCR real en el build empaquetado. |

Dos advertencias que importan antes de publicar:

- **No despliegues publicamente con `VITE_CLAUDE_API_KEY` configurada.** Vite la inyecta con `define`, asi que queda en texto plano en `dist/assets/*.js` y cualquiera puede extraerla y gastar tu cuota. Para produccion, esa llamada debe pasar por un backend.
- **Bedrock exige firma SigV4**, imposible desde el navegador sin exponer credenciales de AWS. Por eso el provider espera un proxy (API Gateway + Lambda) que reciba `{ model, prompt, max_tokens }` y reenvie a `bedrock-runtime`.
- **El instalador no esta firmado**, asi que Windows SmartScreen mostrara una advertencia. Para una app que pide portapapeles, pantalla y microfono, eso afecta la confianza del usuario.

## Estrategias Multi-IA

Configurable desde Ajustes > Proveedores de IA:

1. **Fallback** — Intenta proveedores en orden de prioridad.
2. **Carrera** — Dispara todos en paralelo, usa el mas rapido.
3. **Mejor resultado** — Consulta a todos, elige el mas cauteloso (protege al usuario).
4. **Consenso** — Mayoria decide. Sin acuerdo, usa el mas cauteloso.

## Estructura del Proyecto

```
src/
├── components/
│   ├── analysis/       # TextAnalyzer, VoiceAnalyzer, CameraAnalyzer, ImageAnalyzer
│   ├── consumer/       # ConsumerHome, AlertsView, SettingsView, FloatingBubble
│   ├── layout/         # Header, StatusBar
│   └── ui/             # SplashScreen, Onboarding, ErrorBoundary, ThreatChart, ScanlineEffect
├── services/
│   ├── aiProviders/    # Gemini, Claude, Bedrock providers + orchestrator
│   ├── geminiService   # Pipeline principal de analisis
│   ├── protectionEngine# Motor de proteccion en background
│   ├── scamDatabase    # IndexedDB cache de estafas
│   ├── notificationService # PWA + Electron notifications
│   ├── ocrService      # Tesseract.js OCR
│   ├── speechService   # Web Speech API
│   ├── visionService   # MediaPipe deepfake detection
│   └── safeBrowsingService # Google Safe Browsing
├── store/              # Zustand store con persist
├── tests/              # Vitest: patrones, riskScorer, scamDB, scoping, store, OCR
│   └── fixtures/       # scam-corpus.json — corpus etiquetado de referencia
└── utils/              # Prompts, patterns, riskScorer, translations, audioAlert
electron/
├── main.cts            # Main process (tray, clipboard, desktopCapturer, CSP)
└── preload.cts         # Context bridge (secure IPC)
scripts/
└── generate-icon.mjs   # Rasteriza el icono a PNG sin dependencias
build/                  # Recursos de electron-builder (icon.png)
.kiro/
├── agents/             # Agentes especializados (verify, cso, detector, ...)
├── hooks/              # Guard de infra viva, guard de cambios en deteccion
└── steering/           # Contexto y estandares del proyecto
```

## Deteccion: como se mide

`src/data/scam-corpus.json` es el corpus etiquetado (33 casos: SEGURO / SOSPECHOSO / PELIGROSO). No es solo material de test: el proveedor local lo importa en runtime y clasifica por similitud contra el. Incluye casos de precision que **no** deben dispararse, variantes sin acentos y vocabulario regional, y un caso de prompt injection en español.

```bash
node bench/local-provider.mjs   # evalua el proveedor local (leave-one-out)
node bench/local-sweep.mjs      # barrido de parametros del clasificador
```

Resultado medido del proveedor local sobre el corpus (leave-one-out, 33 casos):

| Metrica | Valor |
|---------|-------|
| Precision exacta | 87.5% |
| Recall de amenazas | 100% |
| Falsas alarmas | 0% |
| Fallos graves (PELIGROSO leido como SEGURO) | 0 |
| Casos respondidos | 16 de 33 |

Responde a la mitad de los casos y declina el resto. Eso es deliberado: cuando el vecindario de casos similares no es concluyente, cede el turno a la capa regex o a un proveedor en la nube en lugar de arriesgar un veredicto equivocado. Los parametros del clasificador (K=7, temperatura 0.1, confianza minima 0.6) salieron del barrido, no de la intuicion: la version inicial promediaba puntuaciones y daba 46% de precision con 63% de falsas alarmas.

Con 33 casos esto es una señal, no una prueba. La forma de subir el techo es agrandar el corpus con estafas reales.

Regla del proyecto: ningun cambio en patrones, pesos o corpus sin un antes/despues medido, y todo falso negativo real se añade como caso permanente.

## Licencia

Proyecto para Hackaton Kiro 2026. Equipo Antigravity.
