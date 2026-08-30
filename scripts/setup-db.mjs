// =============================================================================
// Prepara PostgreSQL para desarrollo.
//
// Crea el rol, las dos bases (la de trabajo y la de tests) y aplica las
// migraciones. Es idempotente: se puede volver a ejecutar sin romper nada.
//
// Existe porque el paso de "levantar la base" es justo donde un proyecto se
// vuelve imposible de arrancar para quien llega nuevo, y porque yo mismo di por
// hecho que aqui no habia PostgreSQL cuando SI lo habia — solo que sus binarios
// no estan en el PATH, que es lo normal en Debian y Ubuntu.
// =============================================================================

import { execFileSync } from 'node:child_process';

const USER = process.env.NADA_DB_USER ?? 'nada';
const PASSWORD = process.env.NADA_DB_PASSWORD ?? 'nada_dev';
const HOST = process.env.NADA_DB_HOST ?? '127.0.0.1';
const PORT = process.env.NADA_DB_PORT ?? '5432';

function psql(sql) {
  return execFileSync('su', ['postgres', '-c', `psql -tAc ${JSON.stringify(sql)}`], {
    encoding: 'utf-8',
  }).trim();
}

function run(cmd, args, env = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
}

try {
  if (!psql(`SELECT 1 FROM pg_roles WHERE rolname='${USER}'`)) {
    psql(`CREATE ROLE ${USER} LOGIN PASSWORD '${PASSWORD}'`);
    console.log(`[NADA][db] rol ${USER} creado`);
  }
  // CREATEDB hace falta para la "shadow database" que Prisma usa al comparar
  // migraciones. Sin ese permiso, `migrate dev` falla con P3014.
  psql(`ALTER ROLE ${USER} CREATEDB`);

  for (const db of ['nada', 'nada_test']) {
    if (!psql(`SELECT 1 FROM pg_database WHERE datname='${db}'`)) {
      execFileSync('su', ['postgres', '-c', `createdb -O ${USER} ${db}`]);
      console.log(`[NADA][db] base ${db} creada`);
    }
    const url = `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${db}?schema=public`;
    run('npx', ['prisma', 'migrate', 'deploy'], { DATABASE_URL: url });
    console.log(`[NADA][db] ${db} migrada`);
  }

  console.log('\n[NADA][db] listo. Para los tests contra la base real:');
  console.log(`  TEST_DATABASE_URL="postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/nada_test?schema=public" npm test`);
} catch (error) {
  console.error('[NADA][db] fallo:', error.message);
  console.error('[NADA][db] ¿esta el cluster arrancado? Prueba `npm run db:up`.');
  process.exit(1);
}
