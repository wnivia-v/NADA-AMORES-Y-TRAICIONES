#!/bin/bash
# =============================================================================
# Arranque de sesion — deja el entorno listo sin pasos manuales
#
# El contenedor de una sesion web es efimero: se recicla, y con el se va el
# proceso de PostgreSQL. Sin esto, cada sesion empezaba con la base caida, los
# tests contra la base real saltandose y alguien teniendo que acordarse de
# ejecutar tres ordenes.
#
# Nada de lo que hay aqui es necesario en produccion. Alli la base es un
# servicio gestionado (RDS, segun el brief) que esta siempre encendido y al que
# solo se apunta con una cadena de conexion.
#
# Es idempotente: se puede volver a ejecutar sin romper nada.
# =============================================================================
set -euo pipefail

# Solo en el entorno remoto. En la maquina de alguien, arrancar servicios y
# tocar bases de datos por su cuenta seria pasarse.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

echo "[NADA][hook] instalando dependencias..."
npm install --no-audit --no-fund

# --- PostgreSQL -------------------------------------------------------------
#
# Los binarios NO estan en el PATH: Debian y Ubuntu los ponen en
# /usr/lib/postgresql/<version>/bin. Buscarlos con `which postgres` da vacio
# aunque este instalado, que es exactamente el error que me hizo dar por hecho
# durante dos commits que aqui no habia base de datos.
DB_LISTA=0
if command -v pg_ctlcluster > /dev/null 2>&1; then
  echo "[NADA][hook] arrancando PostgreSQL..."
  pg_ctlcluster 16 main start 2>/dev/null || true

  for _ in $(seq 1 20); do
    if su postgres -c "pg_isready -q" 2>/dev/null; then DB_LISTA=1; break; fi
    sleep 0.5
  done
fi

if [ "$DB_LISTA" = "1" ]; then
  echo "[NADA][hook] preparando rol, bases y migraciones..."
  node scripts/setup-db.mjs

  # Con estas dos, `npm test` corre la bateria COMPLETA —incluida la vuelta
  # contra PostgreSQL— sin que nadie tenga que acordarse de la variable. Sin
  # ellas los tests siguen pasando, pero 22 se saltan.
  {
    echo 'export DATABASE_URL="postgresql://nada:nada_dev@127.0.0.1:5432/nada?schema=public"'
    echo 'export TEST_DATABASE_URL="postgresql://nada:nada_dev@127.0.0.1:5432/nada_test?schema=public"'
  } >> "${CLAUDE_ENV_FILE:-/dev/null}"
else
  # No se aborta: el servidor funciona en memoria y el resto del proyecto no
  # depende de la base. Pero se dice, porque una sesion donde 22 tests se saltan
  # en silencio es una sesion donde se puede romper algo sin enterarse.
  echo "[NADA][hook] AVISO: sin PostgreSQL. El servidor ira en memoria y 22 tests se saltaran."
fi

# El cliente de Prisma se genera en node_modules, asi que hay que rehacerlo
# despues de cada npm install.
echo "[NADA][hook] generando el cliente de Prisma..."
npx prisma generate > /dev/null

# --- Recursos que no vienen del repositorio ---------------------------------
#
# El runtime WASM de MediaPipe y el modelo pesan ~37 MB y no se versionan; el
# worker de vision se compila aparte con esbuild. Sin esto, `npm run dev` sirve
# un escudo de video que no arranca.
echo "[NADA][hook] preparando MediaPipe y el worker de vision..."
npm run mediapipe:assets
node scripts/build-vision-worker.mjs --dev

echo "[NADA][hook] listo."
