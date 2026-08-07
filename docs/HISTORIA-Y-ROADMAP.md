# NADA — Historia del proyecto y roadmap

> Basado en el historial real de commits del repositorio (`git log`), no en memoria ni en marketing. Cada fecha y cifra de este documento se puede verificar corriendo `git log --reverse` en la raíz del proyecto.

---

## 1. Origen — 28 de julio de 2026

NADA nace como una aplicación de protección contra fraude en tiempo real: estafas románticas, phishing, manipulación psicológica. Desde el primer commit ya tenía la decisión de diseño que define todo lo que vino después: **funcionar sin que el usuario pague ni cree una cuenta**, con una capa de IA local (embeddings + kNN contra un corpus de casos reales) como base gratuita, y proveedores en la nube (Gemini, Groq, Claude, Bedrock) como opcionales.

En un solo día de desarrollo intensivo (28 jul) se construyó lo que terminó siendo el MVP completo:

- **Pipeline de detección de 5 capas**: base de datos local (IndexedDB) → patrones regex → verificación de URLs (Safe Browsing) → orquestador multi-IA → scoring de riesgo con decaimiento temporal.
- **4 estrategias de orquestación de IA**: fallback, carrera, mejor resultado, consenso.
- **App de escritorio (Electron)**: bandeja del sistema, monitor de portapapeles nativo, captura de pantalla para OCR.
- **98 pruebas automatizadas** pasando desde el primer día.
- **Precisión medida del proveedor local**: 87.5% de exactitud, 100% de recall en amenazas, 0% de falsas alarmas (medido contra un corpus etiquetado, método leave-one-out).
- Iteración rápida de identidad visual — se probaron y descartaron varias paletas (pastel mint/violeta, naranja cálido, lavanda, slate+cian) hasta asentar los dos temas actuales (Velvet claro / Gamer oscuro).
- Internacionalización completa (ES/EN), accesibilidad (aria labels, navegación por teclado, touch targets de 44px), y separación de bundles (Transformers.js, Firebase, MediaPipe) para no cargar 100+ MB de golpe.

Esa fase se cerró con un `STATUS.md` de verificación honesto: qué estaba probado, qué necesitaba prueba manual, qué quedaba pendiente y qué **no** se recomendaba hacer (agregar más proveedores de IA, reescribir arquitectura, pagar por algo que ya funcionaba gratis). Ese documento sigue en `docs/STATUS.md`.

## 2. Preparación para producción — 2 de agosto de 2026

Dos cambios de infraestructura, sin features nuevas: un esquema inicial de Prisma/PostgreSQL (para una futura capa de backend) y la corrección del base path de la build web para que funcionara detrás de hosting real (AWS Amplify).

## 3. El escudo de video deja de ser un placeholder — 5 de agosto de 2026

Hasta este punto, la puntuación de sincronía labial (una de las señales de detección de deepfake) era un valor fijo hardcodeado — no medía nada real, solo aparentaba hacerlo. Este hito la reemplazó por una medición real: correlación de Pearson entre la apertura de la boca (landmarks faciales de MediaPipe) y la energía de audio capturada en simultáneo. También se corrigió qué cámara se analiza: por defecto captura la ventana/pestaña de la videollamada (`getDisplayMedia`), no la webcam propia — el fraude está del otro lado de la llamada.

## 4. Sesión de endurecimiento — 7 de agosto de 2026

La sesión más intensa hasta ahora, con foco en cerrar la distancia entre "se ve bien" y "protege de verdad":

- **Bug arquitectónico raíz de "parece que escucha pero no responde"**: tres copias independientes del estado de escucha (en tres pantallas distintas) manejaban el mismo micrófono por su cuenta. Se centralizó todo en un motor único (`protectionEngine`) que sobrevive a cambiar de pestaña — apagar el escudo pasó a ser una decisión explícita del usuario, nunca un efecto secundario de navegar.
- **Escudo flotante persistente** en todas las secciones de la app, y overlay siempre-encima en la versión de escritorio (Electron).
- **Android nativo vía Capacitor**: la app deja de ser solo web/escritorio. Reconocimiento de voz nativo (`android.speech.SpeechRecognizer`, porque la Web Speech API no existe en el WebView de Android) construido como plugin propio.
- **Remoción completa de referencias a la herramienta de hackathon** con la que se arrancó el proyecto, para entrega a cliente.
- **Paleta de color elevada** a un tono más "herramienta de seguridad seria" (índigo/cian profundos) en vez de colores genéricos de app de consumo.
- **Detección de acoso/bullying** agregada — el pipeline solo cubría fraude financiero; un mensaje de puro acoso (insultos, sin señales de dinero) daba 0/100. Corregido con categorías de lenguaje agresivo cuyo peso escala según cuántos insultos distintos aparecen.
- **Calidad de OCR**: preprocesamiento de imagen (escalado + contraste) antes de leer texto — capturas de chat nítidas que antes salían "ilegibles" ahora se leen.
- **Menos falsos positivos en detección de deepfake**: se identificó y corrigió un sesgo sistemático que marcaba a personas reales como sospechosas en los primeros ~20 segundos de cualquier videollamada, simplemente porque no había pasado tiempo suficiente para medir una tasa de parpadeo normal.

## 5. Estado actual (esta build)

| Área | Estado |
|---|---|
| Detección de texto (portapapeles, pegado manual) | Funcional, multi-capa, 5 proveedores de IA disponibles |
| Detección de voz en tiempo real | Funcional en web/Electron y Android (nativo) |
| OCR de capturas de pantalla | Funcional, con preprocesamiento de imagen |
| Detección de deepfake en videollamada | Funcional, heurística biométrica (no un modelo entrenado contra deepfakes reales) |
| Escritorio (Electron) | Funcional, con overlay siempre-encima |
| Android (Capacitor) | APK directo, voz nativa funcional; captura de pantalla y overlay siempre-encima **aún no** (requieren plugins nativos adicionales) |
| iOS | No existe — Apple no permite overlays sobre otras apps bajo ninguna circunstancia; una app iOS nativa es un proyecto aparte |
| Pruebas automatizadas | 121 tests, todos en verde |

---

## 6. Roadmap

### Corto plazo (gratis, sin nueva infraestructura)
- Activar una clave de Groq (gratis, sin tarjeta) para que el análisis de texto/voz generalice a frases dichas con fraseo distinto a los ejemplos conocidos — hoy, sin ninguna clave de nube, la única IA activa es el clasificador local, deliberadamente conservador.
- Ampliar el corpus de casos conocidos (`src/data/scam-corpus.json`) con ejemplos reales — cada caso agregado mejora la generalización del clasificador local.
- Firmar el instalador de Windows (~$80–300/año) si se va a distribuir públicamente sin advertencias de "editor desconocido".

### Mediano plazo (requiere desarrollo nativo, sin costo de API)
- **Captura de pantalla en Android** (`MediaProjection`) para el modo "Videollamada" del escudo de video — hoy solo funciona en escritorio/web.
- **Overlay siempre-encima en Android** (`SYSTEM_ALERT_WINDOW`) — el ícono flotante persistente hoy solo existe en Electron.
- **Notificaciones confiables en Android** vía `@capacitor/local-notifications` en vez de la Web Notification API.
- Publicación en Google Play (hoy es distribución por APK directo).

### Mediano-largo plazo (implica costo real de API — requiere decisión de negocio)
- **Consenso multi-IA para video**: confirmar con una IA de visión en la nube (Gemini Vision u otra) antes de declarar un deepfake, reduciendo falsos positivos aún más. Pendiente porque cada verificación tiene costo real por llamada.
- **Escaneo pasivo de fotos/video en toda la app** (no solo lo que el usuario sube manualmente) — mismo tema de costo.
- **Filtrado de llamadas telefónicas reales** (no solo videollamadas por apps) vía la API nativa de Android `CallScreeningService`.

### Largo plazo (producto/negocio)
- Backend propio (ya hay un esquema Prisma inicial) para: sincronizar alertas entre dispositivos, modo "familiar/tutor" (un tercero recibe alerta si se detecta riesgo alto — pensado para adultos mayores), y mover las claves de proveedores pagos fuera del bundle del cliente.
- Apertura de la capa de detección como API para terceros (bancos, apps de citas, telcos) — ver `docs/GUIA-PRESENTACION.md` para el modelo de negocio propuesto.
