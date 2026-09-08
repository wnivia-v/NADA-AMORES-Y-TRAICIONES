# Cómo entregar — pasos exactos

> Reescrito con `instruccionescompetencia_V1.docx`. **La entrega ya no es un
> Pull Request.** La guía anterior mandaba hacer fork de
> `lorenabravo-design/Final-AI-Cibersecurity-Projects-MenCISO-Gen-1` y abrir un
> PR con una carpeta dentro de `/proyectos-finales`. Eso queda anulado: ahora
> cada proyecto tiene **su propio repositorio privado dentro de una
> organización**. Por eso la carpeta que había preparada ya no se llama
> `proyectos-finales/wnivia-v` sino [`NADA/`](NADA/): el nombre ya no es el del
> usuario, es el del proyecto, porque es el nombre que llevará el repositorio.

## Los cuatro pasos

**1 · Avisar de la cuenta de GitHub.** Escribir a **mentorias@womenciso.com.mx**
diciendo qué cuenta de GitHub va asociada al proyecto — `wnivia-v`. De ahí sale
la invitación a la organización. Una sola cuenta por proyecto.

**2 · Aceptar la invitación** a la organización **github.com/WomenCISO-MenCISO**.
La guía avisa de que la aprobación puede tardar.

**3 · Crear el repositorio**, dentro de la organización y **privado**, con el
nombre simplificado del proyecto: **`NADA`**.

**4 · Subir el proyecto**, con un mensaje de commit del estilo
`Entrega proyecto final - [tu nombre]`.

## Sobre el paso 4: subir el código, no sólo los archivos

La guía describe arrastrar archivos en la web. Funciona, pero para un proyecto
de este tamaño es mejor empujar el repositorio entero: va el código con su
historia —sesenta y tantos commits que enseñan cómo se llegó aquí— en vez de una
foto suelta de los archivos.

Con el repositorio ya creado y vacío en la organización:

    cd /ruta/a/NADA-AMORES-Y-TRAICIONES

    # 1. La documentación de entrega, en la raíz
    cp entrega/NADA/README.md      ENTREGA.md
    cp entrega/NADA/presentacion.pdf .
    cp entrega/NADA/video.md       .

    git add ENTREGA.md presentacion.pdf video.md
    git commit -m "Entrega proyecto final - [tu nombre]"

    # 2. Empujar todo al repositorio de la organización
    git remote add entrega https://github.com/WomenCISO-MenCISO/NADA
    git push entrega HEAD:main

Si se prefiere la vía de la guía —arrastrar archivos en la web— entonces se
suben los tres de [`NADA/`](NADA/) y basta: el README que llevan enlaza al
repositorio público con todo el código.

## Lo que queda pendiente

- **El vídeo.** [`NADA/video.md`](NADA/video.md) tiene el enlace en blanco. El
  guion está minutado en [`guion-video.md`](guion-video.md).

## Fechas

**Este documento nuevo no trae ninguna.** Las que había en la guía anterior eran
registro hasta el 6 de septiembre, semifinalistas el 11 y presentación en vivo
el 17 (4 min de pitch + 4 de preguntas). Si el plazo se amplió, conviene que
quede por escrito de quien lo amplió — no está en el documento.

## Qué se sube

    NADA/
      README.md          objetivo, herramientas, resultados medidos, framework
                         de seguridad, mapa del código y lo que NO hace
      presentacion.pdf   11 diapositivas, 16:9
      video.md           estructura del pitch y enlace (pendiente)
