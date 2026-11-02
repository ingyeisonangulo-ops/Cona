// Arnés de pruebas: PostgreSQL en memoria (PGlite) expuesto por socket, con las
// migraciones y el seed REALES, y la API REAL conectada con el rol crm_app.
// Lo usan test/integration/* y scripts/audit-security.js. Requiere las
// devDependencies @electric-sql/pglite y @electric-sql/pglite-socket.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);
export const BACKEND = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
export const ORIGIN = 'http://localhost:5173';
export const PASSWORDS = { superAdmin: 'SuperAdmin#2026!', dev: 'DevPassword#2026' };
export const EMAILS = {
  superAdmin: 'admin@clinica.test',
  gerente: 'gerente@clinica.test',
  asistente: 'asistente@clinica.test',
  colaborador: 'colaborador@clinica.test',
};

// extraScripts: scripts adicionales (p. ej. seed-demo) que se ejecutan como dueño
// antes de conectar la API (PGlite atiende una sola conexión a la vez).
export async function startHarness({ env: extraEnv = {}, port = 54329, quiet = false, extraScripts = [] } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

  const url = `postgresql://postgres:x@127.0.0.1:${port}/postgres`;
  const pg = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' });
  await server.start();

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    MIGRATION_DATABASE_URL: url,
    APP_DB_PASSWORD: 'app-password-1234567890',
    DB_SSL: 'disable',
    SEED_SUPERADMIN_EMAIL: EMAILS.superAdmin,
    SEED_SUPERADMIN_PASSWORD: PASSWORDS.superAdmin,
    SEED_DEV_PASSWORD: PASSWORDS.dev,
    SEED_DEV_EMAIL_DOMAIN: 'clinica.test',
  };
  const run = async (script) => {
    const { stdout, stderr } = await execFileP('node', [script], { cwd: BACKEND, env });
    if (!quiet) console.log((stdout + stderr).trim());
  };
  await run('scripts/migrate.js');
  await run('scripts/migrate.js'); // idempotencia
  await run('scripts/seed.js');
  await run('scripts/seed.js'); // idempotencia
  for (const script of extraScripts) await run(script);

  // PGlite comparte una única sesión: desde aquí es la del rol de la app.
  await pg.exec('SET ROLE crm_app');

  Object.assign(process.env, {
    NODE_ENV: 'development',
    APP_ORIGIN: ORIGIN,
    APP_DATABASE_URL: url,
    DB_SSL: 'disable',
    DB_POOL_MAX: '1',
    JWT_ACCESS_SECRET: 'x'.repeat(48),
    COOKIE_SECURE: 'false',
    ...extraEnv,
  });
  const { createApp } = await import(pathToFileURL(`${BACKEND}/src/app.js`).href);
  const { db } = await import(pathToFileURL(`${BACKEND}/src/db.js`).href);
  const appRole = await db.assertRestrictedRole();
  const http = createApp().listen(0);
  const base = `http://127.0.0.1:${http.address().port}/api`;

  class Client {
    jar = {};
    async req(method, path, body, { origin = ORIGIN } = {}) {
      const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
      if (origin) headers.origin = origin;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of res.headers.getSetCookie()) {
        const [kv] = c.split(';');
        const [k, ...v] = kv.split('=');
        const val = v.join('=');
        if (!val || /Expires=Thu, 01 Jan 1970/.test(c)) delete this.jar[k];
        else this.jar[k] = val;
      }
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* cuerpo no JSON */
      }
      return { status: res.status, data, text, cookies: res.headers.getSetCookie() };
    }
    login(email, password) {
      return this.req('POST', '/auth/login', { email, password });
    }
    static async as(email, password = PASSWORDS.dev) {
      const c = new Client();
      const r = await c.login(email, password);
      if (r.status !== 200) throw new Error(`No se pudo iniciar sesión como ${email}: ${r.status}`);
      return c;
    }
  }

  // Ejecuta SQL como dueño (fuera de RLS) y vuelve al rol de la app.
  async function asOwner(fn) {
    await pg.exec('RESET ROLE');
    try {
      return await fn(pg);
    } finally {
      await pg.exec('SET ROLE crm_app');
    }
  }

  let fails = 0;
  let passes = 0;
  const check = (cond, label, extra = '') => {
    if (cond) passes++;
    else fails++;
    console.log(`${cond ? '  OK    ' : '  FALLA '} ${label}${cond || !extra ? '' : ` — ${extra}`}`);
    return cond;
  };

  async function close() {
    http.close();
    await db.close();
    await server.stop();
    await pg.close();
  }

  return { pg, base, appRole, Client, asOwner, check, close, results: () => ({ fails, passes }) };
}
