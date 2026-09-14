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
`Entrega proyecto final - Wladimir Nivia`.

## Sobre los pasos 3 y 4: subir el proyecto entero, con su historia

La guía describe arrastrar archivos en la web. Eso sube una foto suelta de los
archivos y pierde el historial. Aquí se sube el repositorio completo: **87
commits** que enseñan cómo se llegó al resultado, no sólo el resultado. Ocupa
7,9 MB, así que no es un problema de tamaño.

No hace falta copiar nada a la raíz: el README del repositorio ya abre con una
tabla que apunta a `entrega/` —resumen, presentación, guion y protocolo de
seguridad— y a las cifras con la orden que reproduce cada una.

### Vía A — desde la web, sin terminal (la más simple)

GitHub tiene un importador que copia un repositorio entero, con su historia, sin
que haya que clonar nada. Y crea el repositorio de destino, así que el paso 3 va
incluido.

1. Entrar a **github.com/new/import**
2. *The URL for your source repository*:
   `https://github.com/wnivia-v/NADA-AMORES-Y-TRAICIONES`
3. *Owner*: elegir **WomenCISO-MenCISO** (no la cuenta personal)
4. *Repository name*: **`NADA`**
5. Marcar **Private**
6. **Begin import**

Tarda un par de minutos. Al terminar, el repositorio de la organización tiene
todo: código, tests, documentación y la carpeta `entrega/`.

### Vía B — desde la terminal

Si se prefiere hacerlo a mano, primero crear el repositorio **vacío** y privado
llamado `NADA` dentro de la organización, y después:

    git clone https://github.com/wnivia-v/NADA-AMORES-Y-TRAICIONES
    cd NADA-AMORES-Y-TRAICIONES
    git remote add entrega https://github.com/WomenCISO-MenCISO/NADA
    git push entrega main

### Si GitHub responde que no se puede crear el repositorio

Al intentarlo desde aquí, GitHub contestó:

    403 You need admin access to the organization before adding a repository

Puede ser una limitación de este entorno, pero también puede ser que la
organización no deje crear repositorios a sus miembros —es una casilla que el
dueño de la organización activa o desactiva—. Si al intentarlo sale ese mismo
mensaje, no es culpa de nada que se pueda arreglar por esta parte: hay que
escribir a **mentorias@womenciso.com.mx** y pedir que creen el repositorio
`NADA` y den permiso de escritura, o que suban el permiso de miembro.

## Antes de subir: comprobar que el vídeo se ve

El vídeo está en Google Drive, y ahí lo que decide si alguien puede verlo no es
el enlace sino el **permiso de la carpeta o del archivo**. Un enlace correcto
sobre un archivo restringido enseña «Solicitar acceso», y quien lo abre no ve
nada.

Se comprueba en treinta segundos, y hay que hacerlo desde **fuera de la propia
cuenta**, porque desde la cuenta del dueño siempre se ve:

1. Abrir una **ventana de incógnito** en el navegador.
2. Pegar ahí el enlace del vídeo.
3. Si pide iniciar sesión o solicitar acceso, hay que cambiarlo: en Drive,
   botón derecho sobre el archivo → **Compartir** → **Cualquier usuario con el
   enlace** → permiso **Lector**.

Es el fallo más caro posible en una entrega: todo el trabajo está hecho y quien
evalúa se encuentra una puerta cerrada.

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
      video.md           estructura del pitch y enlace al vídeo
