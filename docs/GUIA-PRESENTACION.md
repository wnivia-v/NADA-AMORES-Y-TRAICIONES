# NADA — Guía para presentación / entrevista

> Preguntas y respuestas preparadas para presentar el proyecto. Las cifras de precio/negocio de la sección 5 son una **propuesta razonada, no un hecho** — ajustalas a tu estrategia. Todo lo demás (qué funciona, qué no, números de tests) es verificable en el código y en `docs/HISTORIA-Y-ROADMAP.md`.

---

## 1. ¿Qué problema resuelve NADA?

Fraude que ocurre en tiempo real y en varios canales a la vez: estafas románticas (alguien pide dinero apelando al afecto), phishing, suplantación de identidad, extorsión/sextorsión, deepfakes en videollamadas, y acoso/bullying. La mayoría de las herramientas de seguridad cubren *una* de esas cosas (antivirus, gestor de contraseñas, verificador de identidad) — NADA las cubre todas desde un solo lugar y en tiempo real: mientras escribís, mientras hablás por videollamada, mientras recibís una captura de pantalla.

Contexto de mercado (cifra ampliamente reportada, no verificada por este equipo): la FTC de EE.UU. reportó más de mil millones de dólares en pérdidas anuales por estafas románticas en años recientes. Es un problema real y medible, no hipotético.

## 2. ¿Qué tiene HOY, funcionando de verdad?

- Análisis de texto (pegado manual o portapapeles automático) contra 5 capas de detección, con 5 proveedores de IA posibles.
- Reconocimiento de voz en tiempo real con transcripción visible en vivo, en web, escritorio (Electron) **y Android nativo**, con Whisper corriendo en el propio dispositivo como respaldo si la red bloquea el reconocimiento del navegador.
- Diccionario de amenazas propio: 72 patrones en 25 categorías (fraude, phishing, extorsión, sextorsión, secuestro virtual, suplantación de familiares, acoso, grooming, inducción a la autolesión…), en español, inglés y portugués, con 26 reglas de combinación. Está construido sobre los avisos publicados por **INCIBE**, el instituto nacional de ciberseguridad de España — campañas reales, fechadas y documentadas, no ejemplos inventados.
- OCR de capturas de pantalla (WhatsApp, Telegram, SMS, Messenger) con preprocesamiento de imagen.
- Detección de deepfake en videollamada (heurística biométrica: parpadeo, estabilidad facial, sincronía labial real entre audio y movimiento de boca).
- Funciona sin pagar y sin crear cuenta — la detección local no necesita red, cuenta ni clave de API.
- App de escritorio (Windows, vía Electron) con ícono flotante siempre visible.
- App Android (APK directo, no requiere Play Store).
- 198 pruebas automatizadas en 16 archivos, todas en verde, cubriendo desde los patrones de detección hasta la lógica de reintentos de red.

## 3. ¿Qué es heurística/beta y qué es producción real? (para no prometer de más)

Ser honesto acá genera más confianza que sobrevender:

- La detección de deepfake es una heurística de biometría facial (parpadeo, jitter, sincronía labial), **no un modelo entrenado específicamente contra deepfakes reales**. Es una señal fuerte, no una certeza absoluta — por eso la recomendación siempre es "verificá por otro canal", no "es 100% falso".
- El clasificador de IA local (el que funciona sin pagar) está diseñado para **declinar responder** cuando no está seguro, en vez de arriesgar una falsa alarma. Esto es una decisión de diseño, no una limitación oculta.
- Sin ninguna clave de IA en la nube configurada (que es como corre hoy la demo), el diccionario de amenazas es la capa que forma la opinión. Funciona y es instantáneo, pero reconoce guiones conocidos; el fraseo completamente nuevo es donde la IA en la nube aporta, y activarla es agregar una clave gratuita de Groq.
- Captura de pantalla y overlay siempre-encima en Android todavía no existen — son plugins nativos por construir (ver roadmap).
- No hay verificación por consenso de múltiples IAs de visión en la nube todavía (tiene costo real de API).
- No hay una tasa de acierto medida sobre un conjunto grande y representativo. Hay 198 tests con casos reales, que es otra cosa: demuestran que casos concretos se detectan, no cuánto acierta en promedio sobre el mundo.

## 4. ¿Cómo funciona técnicamente? (resumen de 30 segundos)

React + TypeScript en el frontend, empaquetado tres veces: como PWA (navegador), como app de escritorio (Electron) y como app Android (Capacitor) — mismo código, tres formas de instalarlo. El análisis pasa por 5 capas: primero una base de datos local de estafas ya conocidas (instantáneo), luego el diccionario de amenazas con sus reglas de combinación (ver 4.1), luego verificación de URLs maliciosas, luego un orquestador que puede consultar hasta 5 proveedores de IA distintos (local, Gemini, Groq, Claude, Bedrock) con 4 estrategias posibles (el más rápido responde, todos votan, etc.), y por último un sistema de puntuación de riesgo que pondera señales recientes más que viejas.

### 4.1 La idea técnica que vale la pena defender: una estafa tiene *forma*, no palabras clave

Si te preguntan "¿esto no es una lista de palabras prohibidas?", esta es la respuesta, y es el corazón del proyecto.

Buscar palabras sueltas no funciona, por dos motivos opuestos: los estafadores cambian las palabras, y las palabras "peligrosas" aparecen todo el tiempo en conversaciones normales. Una lista de palabras da falsos positivos y falsos negativos a la vez.

NADA puntúa la **estructura** del guion. Cada señal suelta pesa poco — a propósito, por debajo del umbral de alerta:

| Frase | ¿Sospechosa sola? |
|---|---|
| "Andá al Banco Azteca" | No. Es un banco real. |
| "No cuelgues, quedate en la línea" | No. Se lo decís a tu mamá. |
| "Tengo a tu muchacho" | No necesariamente. |

Las tres juntas son un **secuestro virtual**, y hay una regla de combinación exactamente para eso. Lo mismo con la extorsión por autoridad falsa (identidad de policía + causa penal inventada + amenaza de ir al domicilio) o la estafa romántica (afecto acelerado + emergencia + pedido de dinero + aislamiento del entorno).

Ese diseño es lo que evita el problema que hunde a estas herramientas en la práctica: **si alerta por cualquier cosa, el usuario aprende a ignorarla**, y entonces no protege a nadie el día que la alerta es real. Hay tests dedicados a verificar que frases cotidianas ("no cuelgues que ya te paso con mi mamá", "voy al banco y después paso por tu casa") **no** disparen alarma.

Única excepción por decisión ética explícita: la inducción al suicidio o la autolesión alerta sola, sin necesitar corroboración de nada más.

### 4.2 El diccionario que aprende

Un diccionario escrito a mano solo reconoce lo que a alguien se le ocurrió escribir. Por eso, cuando un mensaje se confirma peligroso, el sistema guarda su fraseo distintivo y reconoce ese mismo guion la próxima vez sin depender de la nube.

Lo importante para los jueces es **cómo está limitado**, porque acá es donde estos sistemas se rompen solos:

- Solo aprende de veredictos **confirmados como peligrosos**; de los dudosos no aprende nada, porque ahí es donde más se equivoca.
- Solo frases de 3 a 5 palabras con contenido real — nunca conectores comunes.
- Lo aprendido tiene un tope y **nunca alcanza por sí solo** para declarar peligro: corrobora, no decide.
- Todo queda en el dispositivo. No se sube ni se comparte con nadie.

El motivo es concreto: aprender de la propia salida es como un detector se envenena. Un veredicto equivocado enseña una frase que después produce más veredictos equivocados, y nadie se da cuenta hasta que la herramienta grita por todo.

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

## 7. Guion de demo (5 minutos, en orden)

Preparar **antes** de presentar, y probar todo una vez el mismo día:

- [ ] Navegador **Edge** o Chrome (en Edge el reconocimiento de voz respondió mejor en pruebas reales).
- [ ] Audio de una estafa telefónica listo para reproducir (el del secuestro virtual funciona muy bien).
- [ ] Dos capturas de pantalla guardadas: una de acoso y una de estafa romántica.
- [ ] Una videollamada o video con una cara real, para mostrar el escudo de video.
- [ ] Micrófono probado y permisos ya aceptados. **No dejes que la primera vez que la app pida permiso sea delante del jurado.**

**Orden sugerido**, de lo más rápido de entender a lo más impactante:

1. **Texto (15 segundos).** Pegá el mensaje de una estafa. Alerta inmediata. Sirve para que entiendan qué hace la herramienta antes de mostrar nada complicado.
2. **Captura de pantalla (30 segundos).** Subí la imagen de acoso. Mostrá que lee el texto de la imagen y lo clasifica. Este caso conecta emocionalmente: no es dinero, es una persona.
3. **Voz en vivo (90 segundos).** Activá el escudo de voz y reproducí el audio de la estafa. Mostrá el recuadro con la transcripción apareciendo en vivo — eso demuestra que está escuchando de verdad — y después la alerta. **Este es el momento fuerte de la demo.**
4. **Video (60 segundos).** Escudo de video sobre una cara real. Explicá que da una probabilidad, no un veredicto absoluto, y por qué eso es lo correcto.
5. **El cierre (30 segundos).** Decilo así: *"Todo lo que acaban de ver funciona sin cuenta, sin pagar y sin internet. La detección corre en el dispositivo."* Es el diferenciador más fuerte que tenés.

**Si algo falla en vivo**, no lo tapes: decí qué pasó y por qué. "El reconocimiento del navegador se apoya en un servicio de Google y esta red lo está bloqueando — por eso construimos el respaldo local" es una respuesta que suma puntos. Fingir que no pasó nada, no.

## 8. Lo que salió mal y cómo se arregló (para la pregunta de ingeniería)

Los jurados técnicos valoran más un equipo que encuentra sus propios errores que uno que asegura no tener ninguno. Estos son reales, con causa y solución:

- **Amenazas explícitas se reportaban como "0/100, seguro".** El veredicto de la IA y el análisis local se promediaban, así que una IA distraída hundía una detección local sólida. Se cambió a un **piso**: si la capa local ve una amenaza explícita, ningún promedio puede taparla.
- **Tras la primera alerta, el escudo de voz se quedaba mudo.** Los análisis se cancelaban entre sí: la IA tarda hasta 8 segundos y se lanzaba uno nuevo cada 3, así que cada pedido moría antes de contestar. Se separó en una pasada local instantánea (que no se puede cancelar) más la IA como refuerzo.
- **La transcripción local inventaba palabras.** El audio se cortaba en bloques fijos de 4 segundos, partiendo palabras al medio. Whisper nunca dice "no entendí" — completa con lo que le parece. Se cambió a cortar en los silencios reales del habla.
- **El detector de deepfake marcaba personas reales en los primeros 20 segundos.** Usaba la tasa de parpadeo antes de tener tiempo suficiente para medirla. Ahora esa señal espera hasta tener datos.
- **Capturas nítidas salían "ilegibles".** Faltaba preprocesar la imagen (escalado y contraste) antes de leerla.

Todos tienen tests escritos con el material real que los destapó, para que no vuelvan.

## 9. Preguntas difíciles — respuestas preparadas

**"¿Qué pasa si falla y le dice a alguien que un fraude real es seguro?"**
Por eso el pipeline nunca depende de una sola señal: combina base de datos conocida, patrones, IA y contexto histórico. Y por diseño, cuando el sistema no está seguro, prefiere no responder (o marcar como sospechoso) antes que arriesgar un falso "seguro". Ningún sistema de detección es infalible — por eso las recomendaciones siempre incluyen verificar por otro canal, nunca "confiá ciegamente en la app".

**"¿Qué pasa con la privacidad de los mensajes de la víctima?"**
El camino gratuito (proveedor local) nunca envía el mensaje a ningún servidor — el análisis corre en el dispositivo. Solo si el usuario activa un proveedor en la nube (opcional) el texto viaja a ese proveedor, y eso está documentado y es decisión del usuario.

**"¿Cuánto cuesta operar esto a escala?"**
Con el proveedor local, prácticamente nada por usuario (el costo es una sola vez, en el dispositivo). Con IA en la nube, depende del volumen — hoy usa tiers gratuitos (Groq, Gemini) diseñados para eso; a escala real habría que pasar a tiers pagos o negociar contratos por volumen, que es justo lo que se factura en el modelo B2B de la sección 5.2.

**"¿Por qué no simplemente le pego el mensaje a ChatGPT y le pregunto si es una estafa?"**
Por tres motivos, y ninguno es que el modelo sea malo. Primero, **el momento**: la víctima de una estafa en curso no abre otra app a pedir una segunda opinión — está bajo presión y le están diciendo que no corte y que no hable con nadie. NADA escucha mientras pasa. Segundo, **el canal**: no podés pegarle a un chatbot una llamada en vivo ni una videollamada. Tercero, **la disponibilidad**: si no hay internet, no hay cuenta o la red está bloqueada, el chatbot no existe y la detección local sí.

**"¿Por qué no usar solo un modelo de lenguaje y olvidarse de las reglas?"**
Porque cuando probamos con material real, la IA falló justo en los casos que más importaban — devolvió "seguro" sobre una extorsión explícita. Las reglas son la red de seguridad: son instantáneas, funcionan sin red, y su comportamiento es **auditable** — se puede señalar exactamente qué disparó una alerta. La IA aporta lo que las reglas no pueden: fraseo nuevo que nadie escribió todavía. Cada capa cubre la debilidad de la otra; por eso están las dos.

**"¿De dónde salen los patrones? ¿Los inventaste vos?"**
Al principio salían del material real que iba fallando en pruebas. Eso tiene un sesgo obvio: solo reconoce las estafas que a uno se le ocurrió probar. Por eso el diccionario se amplió con los **avisos publicados por INCIBE**, el instituto nacional de ciberseguridad de España, y con los casos de su línea de ayuda 017 — campañas fechadas y documentadas, con los ganchos textuales que se usaron contra personas reales. Cuatro familias enteras eran invisibles antes de leer esos avisos: el familiar en apuros ("se me rompió el móvil, este es mi nuevo número"), las tasas de aduana por un paquete retenido, el Bizum inverso en plataformas de compraventa, y el soporte falso que pide instalar AnyDesk. Ninguna de las cuatro tiene una sola palabra peligrosa, y por eso ninguna se detectaba.

**"¿Funciona en otros idiomas o solo en español?"**
El diccionario cubre español, inglés y portugués hoy. El reconocimiento de voz suma francés, italiano y alemán. Agregar un idioma al diccionario es agregar patrones a un archivo — la arquitectura ya lo contempla, no hay que rehacer nada. Además el texto se normaliza antes de analizarse (acentos, mayúsculas, espacios), porque tanto la transcripción de voz como el OCR escriben de forma inconsistente, y sería absurdo dejar pasar una amenaza por una tilde faltante.

**"¿Quién es el usuario? ¿Un adulto mayor va a instalar esto?"**
Hoy, realistamente, lo instala un familiar: el hijo o el nieto que ya está preocupado. Por eso el modo familiar está en el roadmap — que la alerta le llegue también a esa persona de confianza. Y por eso funciona sin crear cuenta: cada paso de registro es gente que se pierde en el camino.

**"¿Cómo sé que de verdad funciona y no es una demo armada?"**
Las pruebas están escritas con las transcripciones y capturas reales que fallaron, palabra por palabra, y están en el repositorio. Se corren con un comando y son 198. Lo que no voy a decir es que tenga una tasa de acierto medida sobre un conjunto grande y representativo — para eso hace falta un corpus etiquetado que hoy no tenemos, y sería inventar una cifra.
