# De dónde salen estas skills, y qué se comprobó

Estas dos vienen de fuera. En un repositorio cuyo protocolo de seguridad dice
que no se confía en contenido que no escribimos nosotros, meterlas sin dejar
constancia sería contradecirnos en el mismo commit — **una skill es un fichero
de instrucciones que Claude Code obedece**, así que instalar una es una decisión
de cadena de suministro, no una descarga.

## Origen

| | |
|---|---|
| Repositorio | `mukul975/anthropic-cybersecurity-skills` |
| Commit revisado | `f7626157` (2026-08-20) |
| Autor | Mahipal Jangra |
| Licencia | Apache-2.0 |
| Revisado el | 2026-08-23 |

**No es de Anthropic**, pese al nombre. Es un proyecto comunitario
independiente, y el propio repositorio lo declara: *«Community Project — Not
affiliated with Anthropic PBC»*. Quien induce a error es el título con que
circula en blogs de terceros.

De las **817** skills del repositorio se instalaron **2**. Las demás son
manuales de operador de un SOC empresarial —Cloud Security, Threat Hunting,
forense, malware— que no tienen que ver con una PWA que detecta estafas
sentimentales. Instalarlas todas habría sido meter 800 ficheros de instrucciones
ajenas para usar dos.

## Qué se comprobó, una por una

En las dos:

- **Sin `subprocess`, `os.system`, `eval`, `exec`, `__import__` ni `pickle`.**
- **Sin llamadas de red**: nada de `requests`, `urllib` ni `socket`. No
  descargan nada ni hablan con ningún servidor.
- **Sin escrituras fuera de la salida que se les pide** por parámetro.
- **Escaneadas por inyección en su propio texto.** Es el ataque obvio contra
  quien instala skills: un `SKILL.md` que contenga instrucciones dirigidas al
  agente que lo lee. No hay ninguna fuera de contexto de ejemplo.
- Las dos traen aviso propio de uso autorizado.

### Una salvedad anotada, no un defecto

`detecting-deepfake-audio-in-vishing-attacks/scripts/agent.py` usa
`joblib.load(model_path)`, y **joblib deserializa pickle: cargar un modelo
ajeno es ejecutar su código**. Se revisó el uso: solo abre una ruta que le pases
tú explícitamente, y el modelo lo entrena el mismo script. No descarga ninguno.

Es la advertencia general de Python, no un fallo de la skill — pero si alguien
te pasa un `.joblib` de deepfakes ya entrenado, no lo cargues.

### Lo que NO se hizo

El script de deepfake tiene **610 líneas y no se leyó entero**. Se auditó por
patrones peligrosos y por importaciones, que es donde aparecería cualquier
capacidad que no se haya buscado a mano. Es una revisión razonable, no una
lectura completa, y conviene que quede dicho.

## Por qué estas dos

- **`detecting-indirect-prompt-injection`** — mapea a MITRE ATLAS
  **AML.T0051.001** y NIST AI RMF **MEASURE-2.7**. Es exactamente la superficie
  de NADA que llega por OCR y portapapeles: contenido de terceros que entra al
  análisis. Da identificadores públicos a lo que `docs/PROTOCOLO-SEGURIDAD.md`
  describía con palabras propias.

- **`detecting-deepfake-audio-in-vishing-attacks`** — ATLAS **AML.T0088**,
  **AML.T0043**, **AML.T0018**, **AML.T0052**. Es el dominio del escudo de voz y
  del de vídeo, y aporta el vocabulario forense (MFCC, contraste espectral) que
  el proyecto no tenía.

## Ejecutadas, no solo instaladas

    npm run skills:setup

Crea `.venv-skills/` (548 MB), instala las dependencias de
`requirements.txt`, se trae el binario de `tesseract` si falta, y termina
lanzando el detector para que no haya duda de si quedó bien.

Se hicieron correr contra entradas reales, no solo `--help`:

| Prueba | Resultado |
|---|---|
| Texto con `Ignore all previous instructions` | `decision: block`, con la heurística que disparó |
| HTML con la carga en un comentario y en un `display:none` | La extrae de los dos sitios y bloquea |
| WAV sintético de 2 s | 238 características; marca *pitch jitter* 0,30 Hz y variación del centroide 0,046, ambas por debajo del umbral de voz genuina |

Ese último caso vale la pena leerlo: el fichero era un tono con armónicos, y lo
que señaló es exactamente lo que delata a una voz sintética — no varía lo
suficiente. Funciona.

## Lo que NO se instaló, y por qué

`llm-guard`, `transformers` y `torch` quedan fuera. **No por el tamaño: porque
se midió que sus modelos no se pueden descargar aquí.**

    huggingface.co         -> 000 (bloqueado por el proxy del entorno)
    cdn-lfs.huggingface.co -> 000
    pypi.org               -> 200

Serían ~1 GB de librerías que al ejecutarse fallarían buscando los pesos. El
camino heurístico ya produce la salida con el identificador de ATLAS, y los
campos `llmguard.available` y `model.available` salen en `false` — que es
honesto y se ve.

Donde Hugging Face sí se alcance:

    .venv-skills/bin/pip install llm-guard transformers torch

y entonces `--use-llmguard` y `--use-model` empiezan a valer.

## Por qué no está en el hook de arranque

El hook prepara la base de datos y MediaPipe en cada sesión porque el contenedor
es efímero. Estas dependencias **no** están ahí a propósito: son 548 MB y estas
skills se usan de vez en cuando. Que arrancar a escribir código costara dos
minutos de descarga sería peor negocio que teclear una orden el día que hagan
falta.

`.venv-skills/` está en `.gitignore`. Lo versionado es `requirements.txt` y el
script, que es lo que hace falta para reconstruirlo.

## Cómo actualizarlas

**No con un `git pull`.** Vuelven a revisarse igual que la primera vez, y este
fichero se actualiza con el commit nuevo y con lo que se comprobó. Una
dependencia que se actualiza sola es una dependencia en la que ya no se sabe qué
hay dentro.
