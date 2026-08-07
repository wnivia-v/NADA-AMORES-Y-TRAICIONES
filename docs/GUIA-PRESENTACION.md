# NADA — Guía para presentación / entrevista

> Preguntas y respuestas preparadas para presentar el proyecto. Las cifras de precio/negocio de la sección 5 son una **propuesta razonada, no un hecho** — ajustalas a tu estrategia. Todo lo demás (qué funciona, qué no, números de tests) es verificable en el código y en `docs/HISTORIA-Y-ROADMAP.md`.

---

## 1. ¿Qué problema resuelve NADA?

Fraude que ocurre en tiempo real y en varios canales a la vez: estafas románticas (alguien pide dinero apelando al afecto), phishing, suplantación de identidad, extorsión/sextorsión, deepfakes en videollamadas, y acoso/bullying. La mayoría de las herramientas de seguridad cubren *una* de esas cosas (antivirus, gestor de contraseñas, verificador de identidad) — NADA las cubre todas desde un solo lugar y en tiempo real: mientras escribís, mientras hablás por videollamada, mientras recibís una captura de pantalla.

Contexto de mercado (cifra ampliamente reportada, no verificada por este equipo): la FTC de EE.UU. reportó más de mil millones de dólares en pérdidas anuales por estafas románticas en años recientes. Es un problema real y medible, no hipotético.

## 2. ¿Qué tiene HOY, funcionando de verdad?

- Análisis de texto (pegado manual o portapapeles automático) contra 5 capas de detección, con 5 proveedores de IA posibles.
- Reconocimiento de voz en tiempo real con transcripción visible en vivo, en web, escritorio (Electron) **y Android nativo**.
- OCR de capturas de pantalla (WhatsApp, Telegram, SMS, Messenger) con preprocesamiento de imagen.
- Detección de deepfake en videollamada (heurística biométrica: parpadeo, estabilidad facial, sincronía labial real entre audio y movimiento de boca).
- Funciona sin pagar y sin crear cuenta — hay una capa de IA local que corre en el dispositivo del usuario.
- App de escritorio (Windows, vía Electron) con ícono flotante siempre visible.
- App Android (APK directo, no requiere Play Store).
- 121 pruebas automatizadas, todas en verde, cubriendo desde los patrones de detección hasta la lógica de reintentos de red.

## 3. ¿Qué es heurística/beta y qué es producción real? (para no prometer de más)

Ser honesto acá genera más confianza que sobrevender:

- La detección de deepfake es una heurística de biometría facial (parpadeo, jitter, sincronía labial), **no un modelo entrenado específicamente contra deepfakes reales**. Es una señal fuerte, no una certeza absoluta — por eso la recomendación siempre es "verificá por otro canal", no "es 100% falso".
- El clasificador de IA local (el que funciona sin pagar) está diseñado para **declinar responder** cuando no está seguro, en vez de arriesgar una falsa alarma. Esto es una decisión de diseño, no una limitación oculta.
- Captura de pantalla y overlay siempre-encima en Android todavía no existen — son plugins nativos por construir (ver roadmap).
- No hay verificación por consenso de múltiples IAs de visión en la nube todavía (tiene costo real de API).

## 4. ¿Cómo funciona técnicamente? (resumen de 30 segundos)

React + TypeScript en el frontend, empaquetado tres veces: como PWA (navegador), como app de escritorio (Electron) y como app Android (Capacitor) — mismo código, tres formas de instalarlo. El análisis pasa por 5 capas: primero una base de datos local de estafas ya conocidas (instantáneo), luego patrones de texto, luego verificación de URLs maliciosas, luego un orquestador que puede consultar hasta 5 proveedores de IA distintos (local, Gemini, Groq, Claude, Bedrock) con 4 estrategias posibles (el más rápido responde, todos votan, etc.), y por último un sistema de puntuación de riesgo que pondera señales recientes más que viejas.

## 5. Modelo de negocio y precio — propuesta

### 5.1 Precio al consumidor (B2C)

Modelo freemium, con la capa gratuita ya construida como gancho de adopción:

| Plan | Precio propuesto | Qué incluye |
|---|---|---|
| **Gratis** | $0 | Todo el análisis local (sin cuenta, sin nube), 1 dispositivo |
| **Premium individual** | US$4.99–7.99/mes | IA en la nube (mejor precisión y velocidad), sincronización entre dispositivos, modo familiar/tutor (alerta a un tercero de confianza) |
| **Familiar** | US$9.99–14.99/mes | Premium para hasta 5 perfiles — pensado para hijos/padres cuidando a un adulto mayor |

Referencia de mercado: apps comparables de protección de identidad/fraude (Aura, LifeLock y similares) cobran entre US$10 y US$25/mes. NADA cubre un problema más específico (fraude conversacional + deepfake) con menos infraestructura detrás, por eso el rango propuesto es más bajo — es una entrada de mercado, no una copia de esos productos.

### 5.2 Licenciamiento B2B (el ángulo de mayor valor a mediano plazo)

Bancos, apps de citas, telcos y aseguradoras tienen el mismo problema a escala: necesitan detectar fraude conversacional en sus propios canales (chat de soporte, mensajería in-app, líneas de atención). Ahí el motor de detección se vende como API, no como app:

- **Por volumen**: US$0.01–0.03 por verificación de texto/imagen.
- **Contrato anual**: US$15,000–150,000+/año según volumen e integración, con SLA propio.

Esto requiere el backend que hoy es solo un esquema inicial (Prisma) — es trabajo real, no algo que se activa con una bandera.

### 5.3 "¿En cuánto se vendería el proyecto completo?"

Esta pregunta es distinta a la del precio del producto — es una pregunta de valuación, y depende de tracción (usuarios activos, ingresos reales), no solo de la tecnología. Con honestidad: sin datos de usuarios/ingresos, cualquier cifra concreta sería una adivinanza. El marco que se usa normalmente:

- **Pre-tracción** (lo que hay hoy: producto funcional, sin usuarios pagos todavía): se valora por tecnología + equipo + oportunidad de mercado, típicamente en rondas semilla/pre-seed. Rango de referencia amplio para un MVP funcional con esta profundidad técnica: **US$150,000–1,000,000**, muy dependiente de a quién se le presente y qué tan urgente sea el problema para esa audiencia.
- **Con tracción** (usuarios activos, ingresos recurrentes): SaaS en etapa temprana suele valorarse en múltiplos de ingreso anual recurrente (ARR), típicamente 3x–8x ARR.

No hay que inventar un número fijo en la entrevista — es más creíble decir "hoy vale por la tecnología y el problema que resuelve; el valor de mercado se define cuando haya usuarios reales" que dar una cifra sin base.

## 6. Qué sigue (roadmap corto, para cerrar la presentación)

1. Activar IA en la nube gratuita (Groq) para mejorar la generalización del análisis.
2. Completar Android nativo (captura de pantalla, overlay siempre-encima).
3. Publicación en Google Play.
4. Backend propio para sincronización y modo familiar.
5. Explorar el ángulo B2B (banca, apps de citas) una vez validado el consumo B2C.

## 7. Preguntas difíciles — respuestas preparadas

**"¿Qué pasa si falla y le dice a alguien que un fraude real es seguro?"**
Por eso el pipeline nunca depende de una sola señal: combina base de datos conocida, patrones, IA y contexto histórico. Y por diseño, cuando el sistema no está seguro, prefiere no responder (o marcar como sospechoso) antes que arriesgar un falso "seguro". Ningún sistema de detección es infalible — por eso las recomendaciones siempre incluyen verificar por otro canal, nunca "confiá ciegamente en la app".

**"¿Qué pasa con la privacidad de los mensajes de la víctima?"**
El camino gratuito (proveedor local) nunca envía el mensaje a ningún servidor — el análisis corre en el dispositivo. Solo si el usuario activa un proveedor en la nube (opcional) el texto viaja a ese proveedor, y eso está documentado y es decisión del usuario.

**"¿Cuánto cuesta operar esto a escala?"**
Con el proveedor local, prácticamente nada por usuario (el costo es una sola vez, en el dispositivo). Con IA en la nube, depende del volumen — hoy usa tiers gratuitos (Groq, Gemini) diseñados para eso; a escala real habría que pasar a tiers pagos o negociar contratos por volumen, que es justo lo que se factura en el modelo B2B de la sección 5.2.
