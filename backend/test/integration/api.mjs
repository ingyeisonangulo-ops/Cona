// Prueba de integración de la API real contra PGlite (sesión compartida, pool=1).
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
import { fileURLToPath, pathToFileURL } from 'node:url';

const BACKEND = fileURLToPath(new URL('../../', import.meta.url)).replace(/[/]$/, '');
const PORT = 54329;
const ORIGIN = 'http://localhost:5173';
const url = `postgresql://postgres:x@127.0.0.1:${PORT}/postgres`;

const pg = await PGlite.create();
const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' });
await server.start();

const env = {
  ...process.env,
  NODE_ENV: 'development',
  MIGRATION_DATABASE_URL: url,
  APP_DB_PASSWORD: 'app-password-1234567890',
  DB_SSL: 'disable',
  SEED_SUPERADMIN_EMAIL: 'admin@clinica.test',
  SEED_SUPERADMIN_PASSWORD: 'SuperAdmin#2026!',
  SEED_DEV_PASSWORD: 'DevPassword#2026',
  SEED_DEV_EMAIL_DOMAIN: 'clinica.test',
};
const run = async (script) => { const { stdout, stderr } = await execFileP('node', [script], { cwd: BACKEND, env }); console.log((stdout + stderr).trim()); };
await run('scripts/migrate.js');
await run('scripts/migrate.js'); // idempotente
await run('scripts/seed.js');
await run('scripts/seed.js'); // idempotente

await pg.exec('SET ROLE crm_app'); // la sesión compartida pasa a ser la del rol de la app

Object.assign(process.env, {
  APP_ORIGIN: ORIGIN,
  APP_DATABASE_URL: url,
  DB_SSL: 'disable',
  DB_POOL_MAX: '1',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  COOKIE_SECURE: 'false',
  LOCKOUT_MAX_ATTEMPTS_IP: '9',
});
const { createApp } = await import(pathToFileURL(`${BACKEND}/src/app.js`).href);
const { db } = await import(pathToFileURL(`${BACKEND}/src/db.js`).href);
console.log('rol app:', await db.assertRestrictedRole());
const http = createApp().listen(0);
const base = `http://127.0.0.1:${http.address().port}/api`;

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log(`${c ? 'PASS' : 'FAIL'} ${m}${c ? '' : ' ' + extra}`);
  if (!c) fails++;
};

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
    const data = await res.json().catch(() => null);
    return { status: res.status, data, cookies: res.headers.getSetCookie() };
  }
  login(email, password) {
    return this.req('POST', '/auth/login', { email, password });
  }
}

try {
  const anon = new Client();
  let r = await anon.req('POST', '/auth/login', { email: 'gerente@clinica.test', password: 'mala-clave-123' });
  ok(r.status === 401 && r.data.error.message === 'Email o contraseña incorrectos', 'login fallido genérico');
  r = await anon.req('POST', '/auth/login', { email: 'noexiste@clinica.test', password: 'mala-clave-123' });
  ok(r.status === 401 && r.data.error.message === 'Email o contraseña incorrectos', 'cuenta inexistente: mismo mensaje');
  r = await anon.req('GET', '/users');
  ok(r.status === 401, 'sin sesión → 401');

  const ger = new Client();
  r = await ger.login('gerente@clinica.test', 'DevPassword#2026');
  ok(r.status === 200 && r.data.user.role === 'Gerente', 'login gerente');
  ok(r.cookies.every((c) => /HttpOnly/i.test(c) && /SameSite=Strict/i.test(c)), 'cookies HttpOnly + SameSite=Strict');
  r = await ger.req('POST', '/categorias', { nombre: 'Sin origen' }, { origin: null });
  ok(r.status === 403, 'POST sin Origin → 403');

  // Catálogo
  r = await ger.req('POST', '/categorias', { nombre: 'Periodoncia' });
  ok(r.status === 201, 'crear categoría', JSON.stringify(r.data));
  const catId = r.data.categoria.id;
  r = await ger.req('POST', '/categorias', { nombre: 'periodoncia' });
  ok(r.status === 409, 'categoría duplicada → 409');
  r = await ger.req('POST', '/servicios', { categoriaId: catId, nombre: 'Curetaje', valorPublico: 250000.5, costoClinica: 80000, puntos: 30 });
  ok(r.status === 201 && r.data.servicio.valorPublico === 250000.5, 'crear servicio', JSON.stringify(r.data));
  const servId = r.data.servicio.id;
  r = await ger.req('PUT', `/servicios/${servId}`, { categoriaId: catId, nombre: 'Curetaje por cuadrante', valorPublico: 260000, costoClinica: 80000, puntos: 32 });
  ok(r.status === 200 && r.data.servicio.nombre === 'Curetaje por cuadrante', 'editar servicio');
  r = await ger.req('PATCH', `/categorias/${catId}/status`, { status: 'inactive' });
  ok(r.status === 400 && r.data.error.code === 'HAS_ACTIVE_SERVICES', 'no desactiva categoría con servicios activos');
  r = await ger.req('PATCH', `/servicios/${servId}/status`, { status: 'inactive' });
  ok(r.status === 200 && r.data.servicio.status === 'inactive', 'desactivar servicio');
  r = await ger.req('PATCH', `/categorias/${catId}/status`, { status: 'inactive' });
  ok(r.status === 200, 'desactivar categoría');
  r = await ger.req('PATCH', `/servicios/${servId}/status`, { status: 'active' });
  ok(r.status === 400, 'no activa servicio con categoría inactiva');
  r = await ger.req('POST', '/convenios', { nombre: 'Policía', entidad: 'Policía Nacional', porcentajeDescuentoCategoria: { [catId]: 15 } });
  ok(r.status === 201 && r.data.convenio.porcentajeDescuentoCategoria[catId] === 15, 'crear convenio', JSON.stringify(r.data));
  r = await ger.req('POST', '/convenios', { nombre: 'Malo', entidad: 'X entidad', porcentajeDescuentoCategoria: { [catId]: 150 } });
  ok(r.status === 400, 'descuento > 100 → 400');
  r = await ger.req('POST', '/convenios', { nombre: 'Malo2', entidad: 'X entidad', porcentajeDescuentoCategoria: { '00000000-0000-4000-8000-000000000000': 5 } });
  ok(r.status === 400, 'categoría inexistente en convenio → 400');
  r = await ger.req('GET', '/servicios?status=all');
  ok(r.status === 200 && r.data.servicios.length >= 7, 'listar servicios (seed + nuevo)');
  r = await ger.req('GET', '/servicios/00000000-0000-4000-8000-000000000000');
  ok(r.status === 404, 'servicio inexistente → 404');

  // Asistente: lee pero no escribe
  const asi = new Client();
  await asi.login('asistente@clinica.test', 'DevPassword#2026');
  r = await asi.req('GET', '/convenios');
  ok(r.status === 200, 'asistente lee convenios');
  r = await asi.req('POST', '/categorias', { nombre: 'Intento' });
  ok(r.status === 403, 'asistente no crea categoría → 403');
  r = await asi.req('GET', '/users');
  ok(r.status === 403, 'asistente no gestiona usuarios → 403');
  r = await asi.req('GET', '/audit-logs');
  ok(r.status === 403, 'asistente no ve auditoría → 403');

  // Usuarios
  r = await ger.req('GET', '/users');
  ok(r.status === 200 && r.data.users.length === 4, 'gerente lista usuarios');
  const superId = r.data.users.find((u) => u.role === 'Super Admin').id;
  const colabId = r.data.users.find((u) => u.role === 'Colaborador').id;
  r = await ger.req('GET', `/users/${superId}`);
  ok(r.status === 404, 'gerente → Super Admin = 404');
  r = await ger.req('PATCH', `/users/${superId}/status`, { status: 'inactive' });
  ok(r.status === 404, 'gerente no desactiva Super Admin (404)');
  r = await ger.req('POST', '/users', { email: 'nuevo@clinica.test', fullName: 'Nuevo Usuario', role: 'Super Admin', password: 'TemporalSegura1' });
  ok(r.status === 403, 'gerente no crea Super Admin');
  r = await ger.req('POST', '/users', { email: 'nuevo@clinica.test', fullName: 'Nuevo Usuario', role: 'Asistente', password: 'corta' });
  ok(r.status === 400, 'política de contraseña en creación');
  r = await ger.req('POST', '/users', { email: 'Nuevo@Clinica.test', fullName: 'Nuevo Usuario', role: 'Asistente', password: 'TemporalSegura1' });
  ok(r.status === 201 && r.data.user.mustChangePassword, 'crear usuario con clave temporal', JSON.stringify(r.data));
  const nuevoId = r.data.user.id;

  const col = new Client();
  await col.login('colaborador@clinica.test', 'DevPassword#2026');
  r = await col.req('GET', '/auth/me');
  ok(r.status === 200 && r.data.user.role === 'Colaborador', 'colaborador /me');
  r = await ger.req('PATCH', `/users/${colabId}`, { role: 'Asistente' });
  ok(r.status === 200 && r.data.user.role === 'Asistente', 'cambio de rol');
  r = await col.req('GET', '/auth/me');
  ok(r.status === 401, 'cambio de rol invalida la sesión del afectado');
  r = await ger.req('PATCH', `/users/${(await ger.req('GET', '/auth/me')).data.user.id}`, { role: 'Colaborador' });
  ok(r.status === 400, 'no puede cambiar su propio rol');

  // Lockout + desbloqueo
  const atk = new Client();
  for (let i = 0; i < 5; i++) await atk.login('nuevo@clinica.test', 'incorrecta-xx-' + i);
  for (let i = 0; i < 2; i++) await atk.login('otro@clinica.test', 'incorrecta-yy-' + i);
  r = await atk.login('nuevo@clinica.test', 'TemporalSegura1');
  ok(r.status === 429, 'cuenta bloqueada tras 5 fallos (incluso con clave correcta)');
  r = await ger.req('GET', '/users');
  ok(r.data.users.find((u) => u.id === nuevoId).lockedUntil, 'lista muestra bloqueo');
  // La IP también quedó bloqueada (todo viene de 127.0.0.1): se valida que el desbloqueo de cuenta funcione a nivel de BD.
  r = await ger.req('POST', `/users/${nuevoId}/unlock`);
  ok(r.status === 200 && !r.data.user.lockedUntil, 'desbloquear cuenta');

  // Reset de contraseña
  r = await ger.req('POST', `/users/${nuevoId}/reset-password`);
  ok(r.status === 200 && r.data.resetUrl.includes('#token='), 'emitir enlace de reset');
  const token = r.data.resetUrl.split('#token=')[1];
  r = await anon.req('POST', '/auth/reset-password', { token, password: 'corta' });
  ok(r.status === 400, 'reset valida política');
  r = await anon.req('POST', '/auth/reset-password', { token, password: 'NuevaClaveSegura#1' });
  ok(r.status === 200, 'consumir reset');
  r = await anon.req('POST', '/auth/reset-password', { token, password: 'OtraClaveSegura#2' });
  ok(r.status === 400, 'reset de un solo uso');

  // Refresh rotativo + reutilización
  const rt = new Client();
  r = await rt.login('admin@clinica.test', 'SuperAdmin#2026!');
  // La IP de prueba está bloqueada por los 5 fallos anteriores; se espera 429 aquí.
  ok(r.status === 429, 'bloqueo por IP activo (9 fallos desde la misma IP)');
  await pg.exec('RESET ROLE');
  await pg.exec('DELETE FROM auth_throttle');
  await pg.exec('SET ROLE crm_app');
  r = await rt.login('admin@clinica.test', 'SuperAdmin#2026!');
  ok(r.status === 200, 'login super admin');
  const refreshName = Object.keys(rt.jar).find((k) => k.includes('rt'));
  const oldRefresh = rt.jar[refreshName];
  r = await rt.req('POST', '/auth/refresh');
  ok(r.status === 200 && rt.jar[refreshName] !== oldRefresh, 'refresh rota el token');
  const thief = new Client();
  thief.jar[refreshName] = oldRefresh;
  r = await thief.req('POST', '/auth/refresh');
  ok(r.status === 401, 'reutilización de refresh → 401');
  r = await rt.req('POST', '/auth/refresh');
  ok(r.status === 401, 'familia revocada tras reutilización');

  // Super Admin
  const sa = new Client();
  await sa.login('admin@clinica.test', 'SuperAdmin#2026!');
  r = await sa.req('GET', `/users/${superId}`);
  ok(r.status === 200, 'super admin ve super admin');
  r = await sa.req('GET', '/roles');
  ok(r.status === 200 && r.data.roles.length === 4 && r.data.roles[0].all, 'roles desde matrix.json');

  // Cambio de contraseña propio
  const nu = new Client();
  r = await nu.login('nuevo@clinica.test', 'NuevaClaveSegura#1');
  ok(r.status === 200 && !r.data.user.mustChangePassword, 'login con clave restablecida');
  r = await nu.req('POST', '/auth/change-password', { currentPassword: 'mala-actual-xx', newPassword: 'OtraClaveSegura#3' });
  ok(r.status === 400, 'cambio con clave actual errónea');
  r = await nu.req('POST', '/auth/change-password', { currentPassword: 'NuevaClaveSegura#1', newPassword: 'OtraClaveSegura#3' });
  ok(r.status === 200, 'cambio de contraseña');
  r = await nu.req('GET', '/auth/me');
  ok(r.status === 401, 'sesión invalidada tras cambio');

  // Logout
  r = await sa.req('POST', '/auth/logout');
  ok(r.status === 200, 'logout');
  r = await sa.req('GET', '/auth/me');
  ok(r.status === 401, 'sin sesión tras logout');

  // Auditoría
  r = await ger.req('GET', '/audit-logs?limit=200');
  const actions = new Set(r.data.logs.map((l) => l.action));
  for (const a of ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'ROLE_CHANGED', 'USER_CREATED', 'ACCOUNT_UNLOCKED', 'PASSWORD_RESET_ISSUED', 'PASSWORD_RESET_COMPLETED', 'CATEGORIA_CREATED', 'SERVICIO_UPDATED', 'SERVICIO_STATUS_CHANGED', 'CONVENIO_CREATED', 'REFRESH_TOKEN_REUSE', 'PASSWORD_CHANGED', 'LOGOUT']) {
    ok(actions.has(a), `auditoría registra ${a}`);
  }
  r = await ger.req('GET', '/audit-logs?action=ROLE_CHANGED');
  ok(r.data.logs[0]?.metadata?.from === 'Colaborador' && r.data.logs[0]?.metadata?.to === 'Asistente', 'ROLE_CHANGED con from/to');
} catch (err) {
  console.error(err);
  fails++;
} finally {
  http.close();
  await db.close();
  await server.stop();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
}
