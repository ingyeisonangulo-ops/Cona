// SOLO DESARROLLO: API local sobre PostgreSQL embebido (PGlite), sin instalar
// ni configurar PostgreSQL. Los datos persisten en backend/.local-db/.
//
//   npm run dev:pglite        (desde backend/)
//
// 1) Levanta PGlite y lo expone por socket en 127.0.0.1:5433.
// 2) Aplica migraciones, seed y datos ficticios (todo idempotente) como dueño.
// 3) Cambia la sesión al rol restringido crm_app (RLS activo) y arranca la API en :3000.
// Limitación: PGlite atiende una sola conexión, por eso el pool usa 1 conexión.
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.NODE_ENV === 'production') {
  console.error('[dev:pglite] Solo para desarrollo local.');
  process.exit(1);
}

const BACKEND = fileURLToPath(new URL('../', import.meta.url));
const DATA_DIR = fileURLToPath(new URL('../.local-db/', import.meta.url));
const PORT_DB = Number(process.env.PGLITE_PORT ?? 5433);
const url = `postgresql://postgres:local@127.0.0.1:${PORT_DB}/postgres`;

const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

mkdirSync(DATA_DIR, { recursive: true });
const pg = await PGlite.create(DATA_DIR);
const server = new PGLiteSocketServer({ db: pg, port: PORT_DB, host: '127.0.0.1' });
await server.start();
console.log(`[dev:pglite] PostgreSQL embebido en 127.0.0.1:${PORT_DB} (datos en backend/.local-db)`);

const env = {
  ...process.env,
  NODE_ENV: 'development',
  MIGRATION_DATABASE_URL: url,
  APP_DB_PASSWORD: process.env.APP_DB_PASSWORD || 'local-app-password-123',
  DB_SSL: 'disable',
};
for (const script of ['scripts/migrate.js', 'scripts/seed.js', 'scripts/seed-demo.js']) {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [script], { cwd: BACKEND, env });
  console.log((stdout + stderr).trim());
}

// La única sesión de PGlite pasa a ser la del rol de la app (sin BYPASSRLS).
await pg.exec('SET ROLE crm_app');

Object.assign(process.env, {
  NODE_ENV: 'development',
  APP_DATABASE_URL: url,
  DB_SSL: 'disable',
  DB_POOL_MAX: '1',
});
await import(pathToFileURL(`${BACKEND}src/server.js`).href);

const shutdown = async () => {
  await server.stop().catch(() => {});
  await pg.close().catch(() => {});
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
