# NADA — Amores y Traiciones

**Escudo contra fraude conversacional y manipulación en apps de citas y mensajería.**
PWA que analiza texto, voz, imágenes y vídeo en tiempo real.

- Repositorio: https://github.com/wnivia-v/NADA-AMORES-Y-TRAICIONES
- Presentación: [`entrega/presentacion.pdf`](presentacion.pdf) (11 diapositivas, 16:9)
- Guion del vídeo: [`entrega/guion-video.md`](guion-video.md) — minutado a los 4 min que pide la guía
- Vídeo: _(pendiente: enlace)_

---

## Objetivo

Las víctimas de estafa sentimental no caen por ingenuas: caen porque el fraude
llega **dentro de una conversación que quieren tener**. Cuando alguien duda ya
está emocionalmente comprometido, y preguntar a un familiar da vergüenza.

NADA se sienta al lado de esa conversación y avisa. Con dos reglas que definen
el producto:

1. **Nunca dice «esta persona es un estafador».** Emite indicadores de riesgo
   con su confianza y el motivo. Quien decide es la persona.
2. **Ninguna alerta salta por una señal aislada.** Hace falta corroboración de
   dos fuentes independientes. Una herramienta que grita se deja de creer, y
   una alerta que nadie cree no protege a nadie.

El problema real que había que resolver no era detectar más, sino **detectar sin
molestar**: un detector con falsos positivos entrena a su usuario a ignorarlo.

## Herramientas usadas

| Capa | Tecnología |
|---|---|
| App | React + TypeScript, Vite, PWA, Capacitor (Android), Electron |
| Detección local | Léxico propio de patrones + diccionario con conjugaciones, sin red |
| IA en la nube | Gemini (Firebase AI Logic), Groq, Venice.ai, Claude, Bedrock |
| Visión on-device | MediaPipe Face Landmarker en Web Worker |
| Voz | Web Speech API / Whisper en el dispositivo / reconocedor nativo Android |
| OCR | Tesseract |
| Backend | Node + PostgreSQL (Prisma) — proxy de IA y corpus de reportes |
| Calidad | Vitest (490 tests), ESLint, GitHub Actions |

## Resultado obtenido

Todo lo de abajo está **medido**, y cualquiera puede reproducirlo con las
órdenes que se indican.

### Detección de estafas — 65 casos etiquetados

| | Al empezar | Hoy |
|---|---|---|
| Acierto exacto | 34,1 % | **83,1 %** |
| Amenazas detectadas | 35,3 % | **87,5 %** |
| **Falsas alarmas** | 0 % | **0 %** |
| Fallos graves | 14 | **0** |

    npx tsx bench/measure-regex.ts

El 0 % de falsas alarmas es la cifra que más costó y la que más importa.

### Resistencia a manipulación del propio analizador — 51 casos

| | Al empezar | Hoy |
|---|---|---|
| Ataques detectados | 70,0 % | **40/40 (100 %)** |
| Falsas alarmas sobre conversación normal | 18,2 % | **0 %** |

    npm run bench:redteam

### Qué se comprueba solo

490 tests. La misma batería de seguridad corre contra el almacén en memoria
**y** contra PostgreSQL real.

    npm ci && npm test

## Framework de ciberseguridad

`docs/PROTOCOLO-SEGURIDAD.md` — el protocolo completo, mapeado a **MITRE ATLAS**
y **NIST AI RMF**, con el código y el test que sostienen cada defensa.

Las tres decisiones que lo definen:

- **El texto analizado es, por definición, texto escrito por el atacante.** No
  viaja como instrucción: las reglas van en el turno `system` y el mensaje en el
  `user`, entre marcadores con identificador aleatorio por petición. No existe
  la costura donde concatenarlos.
- **La decisión no la toma un LLM.** Los modelos emiten una señal —puntuación y
  confianza— que fusiona código propio y determinista. Un modelo capturado del
  todo solo puede empujar una fuente entre varias.
- **Ningún frame facial ni audio crudo se transmite ni se persiste.** Se impone
  en el tipo y en el servidor, no en un comentario: un reporte de vídeo no tiene
  campo donde meter contenido, y el servidor lo descarta aunque la petición lo
  traiga.

Contra envenenamiento del corpus: los reportes de usuarios **nunca** tocan el
corpus contra el que se mide una regla nueva. Si se juntaran, el atacante
escribiría el examen con el que se le juzga. Hay un test que impide ese cableado.

## Lo que NO hace

- No dicta veredictos ni bloquea a nadie.
- No sube fotos ni audio a ningún servidor.
- No detecta lo que no ha visto: el corpus tiene 65 casos, no todas las estafas
  del mundo.
- La batería de ataques la escribió quien escribió las defensas. Mide cobertura
  de lo previsto, no resistencia a lo imprevisto.

## Cómo probarlo

    npm ci
    npm run dev

Sin claves ni cuenta: el análisis local funciona offline. Las IAs de nube son
opcionales y sólo mejoran la precisión.

---

_Equipo Antigravity — Cohorte WomenCISO 4 / MenCISO Gen 1_
