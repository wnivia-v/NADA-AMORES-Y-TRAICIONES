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

## Cómo actualizarlas

**No con un `git pull`.** Vuelven a revisarse igual que la primera vez, y este
fichero se actualiza con el commit nuevo y con lo que se comprobó. Una
dependencia que se actualiza sola es una dependencia en la que ya no se sabe qué
hay dentro.
