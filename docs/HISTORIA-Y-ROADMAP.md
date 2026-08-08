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

## 5. La sesión de campo — 8 de agosto de 2026

Las fases anteriores se probaron con tests y con casos de ejemplo. Esta se probó con **material real**: audios de estafas telefónicas grabadas, capturas de conversaciones de acoso reales, videollamadas en vivo. Y el material real rompió cosas que los tests no veían.

- **El escudo de voz se reescribió desde cero.** La versión anterior era un solo motor (Web Speech API) con parches encima, y fallaba de tres formas distintas según el dispositivo y la red. Se rehízo como una cadena de motores con sustitución automática (`src/services/voice/`): en Android arranca el plugin nativo, en escritorio el del navegador, y si ese queda bloqueado por VPN o firewall, cae solo a **Whisper corriendo en el dispositivo** — sin red, sin cuenta, sin poder ser bloqueado. Multilenguaje (ES/EN/PT/FR/IT/DE).
- **Se descubrió por qué Whisper transcribía disparates**: el audio se cortaba en bloques fijos de 4 segundos, partiendo palabras a la mitad. Whisper nunca dice "no entendí" — inventa. Se reemplazó por corte en los silencios reales de la conversación, con 300 ms de margen previo.
- **Se corrigió el fallo más grave del proyecto**: mensajes con amenazas explícitas se reportaban como **0/100, SEGURO**. La causa era que el veredicto de la IA y el análisis local se promediaban, así que una IA distraída podía hundir una detección local sólida. Ahora el análisis local es un **piso**, no un voto: si la capa local ve una amenaza explícita, ningún promedio puede taparla.
- **Diccionario de amenazas multilenguaje** (`src/utils/threatLexicon.ts`): 51 patrones en 19 categorías, en español, inglés y portugués — y sobre todo **11 reglas de combinación**. Esa es la idea central: una estafa tiene *forma*, no palabras clave. "Andá al Banco Azteca" es inocente; "no cuelgues" es inocente; "tengo a tu hijo" separado es una frase de película. Las tres juntas son un secuestro virtual, y esa combinación es la que dispara la alerta. Los pesos individuales quedan a propósito por debajo del umbral para que la herramienta no grite por cualquier cosa y enseñe al usuario a ignorarla.
- **Memoria de amenazas** (`src/services/threatMemory.ts`): cuando un mensaje se confirma peligroso, el sistema recuerda su fraseo distintivo para reconocer el mismo guion la próxima vez, offline. Deliberadamente conservador — solo aprende de veredictos confirmados, y lo aprendido nunca alcanza por sí solo para declarar peligro. Aprender de la propia salida es como un detector se envenena a sí mismo.
- **Alertas que se trababan**: tras la primera alerta el escudo de voz se quedaba mudo. Los análisis se cancelaban entre sí (la IA tarda 8 segundos, se lanzaba uno nuevo cada 3). Se separó en dos pasadas: una local instantánea que no se puede cancelar, y la de IA como refuerzo. Las alertas ahora se diferencian por *tipo de amenaza*, no por la frase exacta — mientras alguien habla el texto cambia todo el tiempo aunque el peligro sea el mismo.
- **180 pruebas automatizadas** en verde, incluyendo tests escritos con las transcripciones textuales de los casos reales que fallaron.

## 6. Estado actual (esta build)

| Área | Estado |
|---|---|
| Detección de texto (portapapeles, pegado manual) | Funcional, multi-capa, 5 proveedores de IA disponibles |
| Detección de voz en tiempo real | Funcional en web/Electron y Android (nativo), con Whisper local como respaldo si la red bloquea el reconocimiento del navegador |
| Diccionario de amenazas | 51 patrones, 19 categorías, 11 reglas de combinación, ES/EN/PT |
| OCR de capturas de pantalla | Funcional, con preprocesamiento de imagen |
| Detección de deepfake en videollamada | Funcional, heurística biométrica (no un modelo entrenado contra deepfakes reales) |
| Escritorio (Electron) | Funcional, con overlay siempre-encima |
| Android (Capacitor) | APK directo, voz nativa funcional; captura de pantalla y overlay siempre-encima **aún no** (requieren plugins nativos adicionales) |
| iOS | No existe — Apple no permite overlays sobre otras apps bajo ninguna circunstancia; una app iOS nativa es un proyecto aparte |
| Pruebas automatizadas | 180 tests en 15 archivos, todos en verde |

---

## 7. Roadmap

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
