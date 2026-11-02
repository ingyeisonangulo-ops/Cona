// Solo desarrollo local: crea la base de datos de MIGRATION_DATABASE_URL si no existe.
import pg from 'pg';
import { pgSslFromEnv } from './_env.js';

const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
const dbName = decodeURIComponent(url.pathname.slice(1));
if (!dbName) throw new Error('MIGRATION_DATABASE_URL no indica la base de datos');
url.pathname = '/postgres';

const client = new pg.Client({ connectionString: url.toString(), ssl: pgSslFromEnv() });
try {
  await client.connect();
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rows.length) {
    console.log(`[db:create] la base "${dbName}" ya existe`);
  } else {
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(dbName)} ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`[db:create] base "${dbName}" creada`);
  }
} catch (err) {
  console.error(`[db:create] ${err.message}`);
  if (/password authentication failed|SASL|client password must be a string/i.test(err.message)) {
    console.error('[db:create] Revise PGPASSWORD en backend/.env (contraseña del usuario postgres).');
  }
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
