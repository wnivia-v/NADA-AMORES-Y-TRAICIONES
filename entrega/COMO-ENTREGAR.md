# Cómo entregar — pasos exactos

La carpeta [`proyectos-finales/wnivia-v/`](proyectos-finales/wnivia-v/) ya está
montada con la estructura que pide la guía oficial. Sólo hay que copiarla al
repositorio de la cohorte y abrir el Pull Request.

**Esto no lo pude hacer yo:** esta sesión sólo puede tocar
`wnivia-v/NADA-AMORES-Y-TRAICIONES`. Intentar leer o escribir en
`lorenabravo-design/Final-AI-Cibersecurity-Projects-MenCISO-Gen-1` se rechaza,
y sin autenticar el repositorio devuelve 404 —lo que no prueba que no exista,
un repositorio privado devuelve lo mismo—. Hay que hacerlo desde una cuenta con
acceso, o desde una sesión nueva abierta directamente sobre ese repositorio.

---

## 1. Antes de nada: el registro

**El registro de proyectos cerró el domingo 6 de septiembre.** Si el proyecto no
quedó registrado ese día, eso es lo primero, por delante del PR. La guía deja un
formulario de pre-registro para quien no llegó:

https://docs.google.com/forms/d/e/1FAIpQLSfRsQUgmNagGxB0kyc6Akht7y9Ng6jAvuvDsC12LdmIzVkCeQ/viewform

Fechas que quedan: **semifinalistas el viernes 11** y **presentación en vivo el
17 de septiembre** (4 min de pitch + 4 min de preguntas).

## 2. El fork y la copia

    # 1. Fork desde la web:
    #    https://github.com/lorenabravo-design/Final-AI-Cibersecurity-Projects-MenCISO-Gen-1

    git clone https://github.com/<tu-usuario>/Final-AI-Cibersecurity-Projects-MenCISO-Gen-1
    cd Final-AI-Cibersecurity-Projects-MenCISO-Gen-1
    git checkout -b entrega-nada

    # 2. Copiar la carpeta ya preparada
    cp -r /ruta/a/NADA-AMORES-Y-TRAICIONES/entrega/proyectos-finales/wnivia-v \
          proyectos-finales/

    git add proyectos-finales/wnivia-v
    git commit -m "Entrega: NADA — Amores y Traiciones"
    git push -u origin entrega-nada

    # 3. Pull Request desde la web hacia la rama principal del repo oficial.

**Antes de copiar, comprueba dos cosas en el repositorio oficial:**

- Que la carpeta raíz se llama de verdad `proyectos-finales`. La guía la da como
  «estructura sugerida»; si el repositorio ya tiene otras entregas, imita cómo
  están puestas.
- Cómo han nombrado su carpeta los demás. Ahora mismo la mía se llama
  `wnivia-v`, que es el usuario de GitHub. Si el resto usa nombre y apellido,
  renómbrala: es un `mv` y no toca nada de dentro.

## 3. Lo que queda pendiente dentro de la carpeta

- `video.md` tiene el enlace del vídeo en blanco. El guion minutado está en
  [`guion-video.md`](guion-video.md); grabado y subido, se pega el enlace ahí y
  en el README.

## Qué lleva la carpeta

    proyectos-finales/wnivia-v/
      README.md          objetivo, herramientas, resultados medidos, framework
                         de seguridad y lo que NO hace
      presentacion.pdf   11 diapositivas, 16:9
      video.md           estructura del pitch y enlace (pendiente)
      codigo/README.md   enlace al repositorio y mapa de por dónde leerlo

El código no se copia dentro: duplicar veinte mil líneas en el repositorio de la
cohorte deja dos copias que se separan a la primera corrección, y la que se
evalúa sería la vieja. La guía pide «enlace a su repositorio personal de
GitHub», que es lo que va.
