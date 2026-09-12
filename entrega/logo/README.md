# Logo y piezas para el vídeo

## El logo

| Archivo | Para qué |
|---|---|
| `nada-logo-1024.png` · `-512` · `-256` | El icono de la app, con su placa oscura. Para cualquier sitio que espere un icono. |
| `nada-logo-transparente-1024.png` · `-512` | Sin fondo. Para sobreponerlo a una grabación o a una diapositiva que no sea oscura. |

Colores de marca: fondo `#0A0E17`, verde `#00FF88`.

Los genera `node scripts/generate-icon.mjs`, que dibuja el escudo
analíticamente y codifica el PNG sin ninguna librería. Una sola fuente de
verdad: si cambia la marca, cambian todos a la vez.

## Piezas de 1920×1080 para el vídeo

| Archivo | Para qué |
|---|---|
| `portada-video-1920x1080.png` | La carátula de los primeros 15 s, mientras te presentas. |
| `marca-esquina-1920x1080.png` | Fondo transparente con el distintivo abajo a la derecha. Se pone como capa encima de toda la grabación y deja el logo fijo en la esquina. |

Las dos salen de su HTML (`portada-video.html`, `marca-esquina.html`), así que
se reeditan cambiando el texto y volviendo a capturar:

    /ruta/a/headless_shell --disable-gpu --no-sandbox --hide-scrollbars \
      --window-size=1920,1080 --screenshot=portada-video-1920x1080.png \
      --virtual-time-budget=2500 file://$PWD/portada-video.html

Para la de esquina, añadir `--default-background-color=00000000` para que el
fondo salga transparente.

> Usar `headless_shell`, no `chrome --headless`: este último deja el área
> visible en 993 px aunque se le pidan 1080, y el distintivo de la esquina sale
> cortado por abajo. Se vio midiendo los píxeles opacos del PNG, no mirándolo.
