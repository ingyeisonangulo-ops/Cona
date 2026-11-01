// Ejecuta migraciones versionadas (migrations/NNN_nombre.sql) como el rol dueño.
// 1) Crea/ajusta el rol crm_app (LOGIN, sin superusuario, sin BYPASSRLS).
// 2) Aplica en orden cada archivo pendiente dentro de su propia transacción.
// 3) Verifica checksums: un archivo ya aplicado no puede cambiar.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { sslOption } from '../src/lib/pgSsl.js';

const APP_ROLE = 'crm_app';
const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);
const LOCK_KEY = 727001; // pg_advisory_lock: evita migraciones concurrentes

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

async function ensureAppRole(client, password) {
  if (password.length < 16) throw new Error('APP_DB_PASSWORD debe tener al menos 16 caracteres');
  const { rows } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  const verb = rows.length ? 'ALTER' : 'CREATE';
  // DDL de roles no admite placeholders: se escapa el literal con la utilidad de pg.
  const pwd = client.escapeLiteral(password);
  await client.query(
    `${verb} ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pwd}`,
  );
  const db = (await client.query('SELECT current_database() AS name')).rows[0].name;
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(db)} TO ${APP_ROLE}`);
}

async function main() {
  const client = new pg.Client({
    connectionString: requireEnv('MIGRATION_DATABASE_URL'),
    ssl: sslOption(process.env.DB_SSL ?? 'verify-full'),
  });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureAppRole(client, requireEnv('APP_DB_PASSWORD'));

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     integer PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await client.query('REVOKE ALL ON schema_migrations FROM PUBLIC');

    const applied = new Map(
      (await client.query('SELECT version, name, checksum FROM schema_migrations')).rows.map((r) => [r.version, r]),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
    let count = 0;
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = applied.get(version);

      if (prev) {
        if (prev.checksum !== checksum) {
          throw new Error(`La migración ${file} cambió después de aplicarse. Cree una nueva migración.`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          version,
          file,
          checksum,
        ]);
        await client.query('COMMIT');
        console.log(`[migrate] aplicada ${file}`);
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Error en ${file}: ${err.message}`);
      }
    }
    console.log(count ? `[migrate] ${count} migración(es) aplicada(s)` : '[migrate] esquema al día');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[migrate] ${err.message}`);
  process.exit(1);
});
