#!/usr/bin/env node
// Auditoría de seguridad automatizada.
//
//   node scripts/audit-security.js            (desde backend/)
//   npm run audit:security                    (desde la raíz)
//   node scripts/audit-security.js --skip-build   (no recompila el frontend)
//
// Levanta PostgreSQL en memoria (PGlite) con las migraciones y el seed reales,
// conecta la API real con el rol crm_app y verifica:
//   1. Endpoints sin sesión y con rol inferior → 401 / 403 / 404 sin fugas.
//   2. Bloqueo al 6.º intento tras 5 fallos y reinicio del contador tras éxito.
//   3. Respuesta genérica idéntica para clave errada, cuenta inactiva,
//      cuenta bloqueada y email inexistente.
//   4. RLS en PostgreSQL: aislamiento entre organizaciones y por rol.
//   5. Bundle de producción sin variables de entorno ni secretos.
// Sale con código 1 si alguna verificación falla.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { BACKEND, EMAILS, PASSWORDS, startHarness } from './lib/harness.js';

const FRONTEND = path.resolve(BACKEND, '..', 'frontend');
const GENERIC = 'Email o contraseña incorrectos';
const skipBuild = process.argv.includes('--skip-build');
const section = (title) => console.log(`\n▶ ${title}`);
const BAD_UUID = '00000000-0000-4000-8000-000000000000';

console.log('AUDITORÍA DE SEGURIDAD — CRM Nuevo Amanecer del Pacífico');
console.log('Preparando base de datos en memoria, migraciones y seed…');

// IP con umbral alto para aislar la prueba de bloqueo POR CUENTA (todas las
// peticiones salen de 127.0.0.1). El bloqueo por IP se prueba en test:integration.
const h = await startHarness({ quiet: true, port: 54339, env: { LOCKOUT_MAX_ATTEMPTS_IP: '100' } });
const { Client, asOwner, check } = h;
console.log(`API conectada a PostgreSQL con el rol "${h.appRole}"`);

// Respuesta "segura": sin datos de negocio, sin trazas, solo { error }.
function safeDenial(r, statuses) {
  const keys = r.data && typeof r.data === 'object' ? Object.keys(r.data) : [];
  return statuses.includes(r.status) && keys.length === 1 && keys[0] === 'error' && !/stack|at \w+ \(|SELECT |postgres/i.test(r.text);
}

let crashed = false;
try {
  // ======================================================================
  section('1. Control de acceso: sin sesión, rol inferior y pertenencia');
  // ======================================================================
  const anon = new Client();
  const protegidos = [
    ['GET', '/auth/me'],
    ['GET', '/tablero'],
    ['GET', '/pacientes?q=a'],
    ['GET', `/pacientes/${BAD_UUID}/historial`],
    ['GET', '/pacientes/cedula/123456'],
    ['GET', '/users'],
    ['GET', '/audit-logs'],
    ['GET', '/citas/alertas'],
    ['GET', '/servicios-realizados'],
    ['GET', '/mi-progreso'],
    ['GET', '/metas'],
    ['POST', '/atenciones'],
    ['POST', '/categorias'],
    ['PATCH', `/users/${BAD_UUID}/status`],
  ];
  for (const [m, p] of protegidos) {
    const r = await anon.req(m, p, m === 'GET' ? undefined : {});
    check(safeDenial(r, [401]), `Sin sesión ${m} ${p} → ${r.status}`);
  }
  const forged = new Client();
  forged.jar['na_at'] = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma-falsa';
  check(safeDenial(await forged.req('GET', '/users'), [401]), 'Token falsificado → 401');

  const col = await Client.as(EMAILS.colaborador);
  const asi = await Client.as(EMAILS.asistente);
  const ger = await Client.as(EMAILS.gerente);
  const sa = await Client.as(EMAILS.superAdmin, PASSWORDS.superAdmin);

  const colaboradorDenegado = [
    ['GET', '/tablero', 'Tablero gerencial'],
    ['GET', '/pacientes?q=a', 'Búsqueda de pacientes'],
    ['GET', '/pacientes/cedula/1061234567', 'Datos de paciente por cédula'],
    ['GET', `/pacientes/${BAD_UUID}/historial`, 'Historial de paciente'],
    ['POST', '/pacientes', 'Crear paciente'],
    ['GET', '/citas/alertas', 'Agenda general'],
    ['GET', `/citas/disponibilidad?fecha=2030-01-02`, 'Ocupación de agenda'],
    ['GET', '/servicios-realizados', 'Servicios realizados (dinero)'],
    ['GET', '/convenios', 'Convenios'],
    ['GET', '/metas', 'Metas (dinero)'],
    ['GET', '/users', 'Usuarios'],
    ['GET', '/audit-logs', 'Auditoría'],
    ['POST', '/atenciones', 'Registrar servicios'],
    ['POST', '/categorias', 'Crear categoría'],
  ];
  for (const [m, p, label] of colaboradorDenegado) {
    const r = await col.req(m, p, m === 'GET' ? undefined : {});
    check(safeDenial(r, [403, 404]), `Colaborador → ${label} (${r.status})`);
  }
  const prog = await col.req('GET', '/mi-progreso');
  check(
    prog.status === 200 && !/"(dinero|valor\w*|costo\w*|comision\w*|margen|utilidad|ingreso\w*|cedula|telefono|apellido|paciente\w*)"/i.test(prog.text),
    'Colaborador → Mi progreso sin dinero ni datos de pacientes',
  );
  const catalogo = await col.req('GET', '/servicios');
  check(catalogo.status === 200 && !/valorPublico|costoClinica/.test(catalogo.text), 'Colaborador → catálogo sin cifras en dinero');

  const asistenteDenegado = [
    ['GET', '/tablero', 'Tablero gerencial'],
    ['GET', '/users', 'Usuarios'],
    ['GET', '/roles', 'Roles'],
    ['GET', '/audit-logs', 'Auditoría'],
    ['GET', '/metas', 'Metas'],
    ['PUT', '/configuracion/recurrencia', 'Configurar recurrencia'],
    ['POST', '/categorias', 'Crear categoría'],
    ['PATCH', `/servicios-realizados/${BAD_UUID}/anular`, 'Anular servicio realizado'],
  ];
  for (const [m, p, label] of asistenteDenegado) {
    const r = await asi.req(m, p, m === 'GET' ? undefined : {});
    check(safeDenial(r, [403]), `Asistente → ${label} (${r.status})`);
  }
  // Rutas de borrado forzadas: no existen (borrado lógico) → 404, o 403 si el
  // router completo exige un permiso que el rol no tiene. Nunca 2xx.
  const servicioId = (await asi.req('GET', '/servicios')).data.servicios[0].id;
  for (const p of [`/servicios/${servicioId}`, `/categorias/${BAD_UUID}`, `/pacientes/${BAD_UUID}`, `/users/${BAD_UUID}`, `/audit-logs/1`, `/citas/${BAD_UUID}`]) {
    const r = await asi.req('DELETE', p);
    check(safeDenial(r, [403, 404]), `Asistente DELETE ${p} → ${r.status}`);
  }
  check((await asi.req('GET', '/servicios?status=all')).data.servicios.some((s) => s.id === servicioId), 'El servicio sigue existiendo tras el intento de borrado');
  // Capa 3: pertenencia → 404.
  const superId = (await sa.req('GET', '/auth/me')).data.user.id;
  check(safeDenial(await ger.req('GET', `/users/${superId}`), [404]), 'Gerente → detalle de Super Admin → 404');
  check(safeDenial(await ger.req('PATCH', `/users/${superId}/status`, { status: 'inactive' }), [404]), 'Gerente → desactivar Super Admin → 404');
  check(safeDenial(await asi.req('GET', `/citas/${BAD_UUID}`), [404]), 'Cita inexistente → 404');

  // CSRF y cabeceras
  const sinOrigen = await ger.req('POST', '/categorias', { nombre: 'Prueba CSRF' }, { origin: 'https://evil.example' });
  check(safeDenial(sinOrigen, [403]), 'Origen ajeno en POST → 403');
  const head = await fetch(`${h.base}/health`);
  check(!head.headers.get('x-powered-by'), 'Sin cabecera X-Powered-By');
  check((head.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), 'CSP restrictiva');
  check(head.headers.get('cache-control') === 'no-store', 'API con Cache-Control: no-store');
  const loginCookies = (await new Client().login(EMAILS.gerente, PASSWORDS.dev)).cookies;
  check(loginCookies.length >= 2 && loginCookies.every((c) => /HttpOnly/i.test(c) && /SameSite=Strict/i.test(c)), 'Cookies HttpOnly + SameSite=Strict');

  // ======================================================================
  section('2. Bloqueo por intentos fallidos (máx. 5, bloqueo de 15 min)');
  // ======================================================================
  const target = EMAILS.asistente;
  const atk = new Client();
  for (let i = 1; i <= 5; i++) {
    const r = await atk.login(target, `clave-incorrecta-${i}`);
    check(r.status === 401 && r.data?.error?.message === GENERIC, `Intento fallido ${i} → 401 genérico`);
  }
  let r = await atk.login(target, PASSWORDS.dev);
  check(r.status === 401 && r.data?.error?.message === GENERIC, '6.º intento (con la clave CORRECTA) → bloqueado');
  r = await sa.req('GET', `/audit-logs?action=ACCOUNT_LOCKED`);
  check(r.data.logs.some((l) => l.metadata?.email === target), 'Bloqueo registrado en auditoría (ACCOUNT_LOCKED)');
  // Simula el paso de 15 minutos.
  await asOwner((pg) => pg.query("UPDATE auth_throttle SET locked_until = now() - interval '1 second' WHERE kind = 'account' AND key = $1", [target]));
  r = await atk.login(target, PASSWORDS.dev);
  check(r.status === 200, 'Tras expirar el bloqueo, el login correcto funciona');
  for (let i = 1; i <= 4; i++) await atk.login(target, `otra-incorrecta-${i}`);
  r = await atk.login(target, PASSWORDS.dev);
  check(r.status === 200, '4 fallos + éxito: el contador se reinicia');
  for (let i = 1; i <= 4; i++) await atk.login(target, `de-nuevo-incorrecta-${i}`);
  r = await atk.login(target, PASSWORDS.dev);
  check(r.status === 200, 'Otros 4 fallos tras el reinicio no bloquean (contador en 0)');

  // ======================================================================
  section('3. Respuesta genérica idéntica (sin enumeración de cuentas)');
  // ======================================================================
  const inactivo = (await sa.req('POST', '/users', { email: 'inactivo@clinica.test', fullName: 'Cuenta Inactiva', role: 'Asistente', password: 'ClaveInactiva#2026' })).data.user;
  await sa.req('PATCH', `/users/${inactivo.id}/status`, { status: 'inactive' });
  const bloqueado = (await sa.req('POST', '/users', { email: 'bloqueado@clinica.test', fullName: 'Cuenta Bloqueada', role: 'Asistente', password: 'ClaveBloqueada#2026' })).data.user;
  for (let i = 0; i < 5; i++) await new Client().login(bloqueado.email, `x-incorrecta-${i}`);

  const casos = [
    ['Contraseña errada', EMAILS.gerente, 'clave-que-no-es'],
    ['Email inexistente', 'nadie@clinica.test', 'ClaveCualquiera#1'],
    ['Cuenta inactiva (clave correcta)', inactivo.email, 'ClaveInactiva#2026'],
    ['Cuenta bloqueada (clave correcta)', bloqueado.email, 'ClaveBloqueada#2026'],
  ];
  const respuestas = [];
  for (const [label, email, password] of casos) {
    const t0 = performance.now();
    const res = await new Client().login(email, password);
    const ms = performance.now() - t0;
    respuestas.push({ label, status: res.status, body: res.text, ms });
    check(res.status === 401 && res.data?.error?.message === GENERIC, `${label} → 401 "${GENERIC}" (${Math.round(ms)} ms)`);
  }
  check(new Set(respuestas.map((x) => `${x.status}|${x.body}`)).size === 1, 'Los 4 casos devuelven exactamente el mismo cuerpo y estado');
  const tiempos = respuestas.map((x) => x.ms);
  check(Math.max(...tiempos) / Math.min(...tiempos) < 3, `Tiempos equilibrados (bcrypt siempre se ejecuta): ${tiempos.map((t) => Math.round(t)).join(' / ')} ms`);
  const forgot = await Promise.all(['nadie@clinica.test', EMAILS.gerente].map((e) => new Client().req('POST', '/auth/forgot-password', { email: e })));
  check(forgot[0].text === forgot[1].text && forgot[0].status === forgot[1].status, 'Recuperación de contraseña: respuesta idéntica exista o no la cuenta');

  // ======================================================================
  section('4. RLS en PostgreSQL (aislamiento de consultas)');
  // ======================================================================
  const otra = await asOwner(async (pg) => {
    const org = (await pg.query("INSERT INTO organizations (slug, name) VALUES ('clinica-ajena', 'Clínica Ajena') RETURNING id")).rows[0].id;
    const hash = await bcrypt.hash('GerenteAjeno#2026', 12);
    const gerente = (await pg.query("INSERT INTO users (organization_id, email, full_name, role, password_hash) VALUES ($1, 'gerente@ajena.test', 'Gerente Ajeno', 'Gerente', $2) RETURNING id", [org, hash])).rows[0].id;
    const paciente = (await pg.query("INSERT INTO pacientes (organization_id, cedula, nombre, apellido, telefono, medio_origen) VALUES ($1, '99887766', 'Paciente', 'Ajeno', '3110000000', 'Otro') RETURNING id", [org])).rows[0].id;
    const cat = (await pg.query("INSERT INTO categorias (organization_id, nombre) VALUES ($1, 'Categoría Ajena') RETURNING id", [org])).rows[0].id;
    return { org, gerente, paciente, cat };
  });
  const asiA = await Client.as(EMAILS.asistente);
  const pacA = (await asiA.req('POST', '/pacientes', { cedula: '11223344', nombre: 'Paciente', apellido: 'Propio', telefono: '3001112233', medioOrigen: 'Referido' })).data.paciente;

  // Nivel API: otra organización no ve nada de la primera y viceversa.
  const gerB = await Client.as('gerente@ajena.test', 'GerenteAjeno#2026');
  check(safeDenial(await gerB.req('GET', `/pacientes/${pacA.id}`), [404]), 'API: gerente de otra organización → paciente ajeno → 404');
  r = await gerB.req('GET', '/pacientes?q=');
  check(r.status === 200 && r.data.pacientes.every((p) => p.id !== pacA.id), 'API: búsqueda no cruza organizaciones');
  r = await gerB.req('GET', '/users');
  check(r.data.users.length === 1, 'API: listado de usuarios solo de su organización');
  check(safeDenial(await asiA.req('GET', `/pacientes/${otra.paciente}`), [404]), 'API: asistente → paciente de otra organización → 404');
  r = await ger.req('GET', '/audit-logs?limit=200');
  check(r.data.logs.every((l) => l.actor?.email !== 'gerente@ajena.test'), 'API: auditoría filtrada por organización');

  // Nivel SQL: consultas directas como crm_app.
  const ids = await asOwner(async (pg) => ({
    gerA: (await pg.query('SELECT id FROM users WHERE email = $1', [EMAILS.gerente])).rows[0].id,
    colA: (await pg.query('SELECT id FROM users WHERE email = $1', [EMAILS.colaborador])).rows[0].id,
  }));
  async function asApp(userId, fn) {
    await h.pg.exec('BEGIN');
    try {
      if (userId) await h.pg.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      return await fn(h.pg);
    } finally {
      await h.pg.exec('ROLLBACK');
    }
  }
  const sqlError = async (fn) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e.message;
    }
  };

  const role = await asApp(null, (pg) => pg.query('SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'));
  check(!role.rows[0].rolsuper && !role.rows[0].rolbypassrls, `SQL: rol "${role.rows[0].u}" sin SUPERUSER ni BYPASSRLS`);
  const sinRls = await asOwner((pg) =>
    pg.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
                AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`),
  );
  check(sinRls.rows.length === 0, `SQL: RLS habilitado y forzado en todas las tablas${sinRls.rows.length ? ` (faltan: ${sinRls.rows.map((x) => x.relname).join(', ')})` : ''}`);

  const tablas = ['users', 'pacientes', 'citas', 'servicios_realizados', 'categorias', 'servicios', 'convenios', 'audit_logs', 'metas_colaborador', 'cierres_ausencia'];
  const sinIdentidad = await asApp(null, async (pg) => {
    const out = {};
    for (const t of tablas) out[t] = (await pg.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    return out;
  });
  check(Object.values(sinIdentidad).every((n) => n === 0), 'SQL: sin app.current_user_id no se ve ninguna fila');

  await asApp(ids.gerA, async (pg) => {
    const p = await pg.query('SELECT organization_id FROM pacientes');
    const u = await pg.query('SELECT DISTINCT organization_id FROM users');
    check(p.rows.length > 0 && p.rows.every((x) => x.organization_id !== otra.org) && u.rows.length === 1, 'SQL: gerente solo ve filas de su organización');
    const direct = await pg.query('SELECT * FROM pacientes WHERE id = $1', [otra.paciente]);
    check(direct.rows.length === 0, 'SQL: SELECT por id de otra organización → 0 filas');
  });
  check(Boolean(await asApp(ids.gerA, (pg) => sqlError(() => pg.query("INSERT INTO categorias (organization_id, nombre) VALUES ($1, 'Inyectada')", [otra.org])))), 'SQL: INSERT en otra organización rechazado');
  await asApp(ids.gerA, async (pg) => {
    const upd = await pg.query("UPDATE pacientes SET nombre = 'Hackeado' WHERE id = $1", [otra.paciente]);
    check(upd.affectedRows === 0, 'SQL: UPDATE sobre otra organización afecta 0 filas');
  });
  await asApp(ids.colA, async (pg) => {
    const p = await pg.query('SELECT count(*)::int AS n FROM pacientes');
    const sr = await pg.query('SELECT DISTINCT colaborador_id FROM servicios_realizados');
    const ca = await pg.query('SELECT count(*)::int AS n FROM cierres_ausencia');
    check(p.rows[0].n === 0 && ca.rows[0].n === 0, 'SQL: Colaborador no lee pacientes ni cierres de inasistencia');
    check(sr.rows.every((x) => x.colaborador_id === ids.colA), 'SQL: Colaborador solo ve sus propios servicios realizados');
  });
  check(Boolean(await asApp(ids.gerA, (pg) => sqlError(() => pg.query("UPDATE audit_logs SET action = 'BORRADO'")))), 'SQL: audit_logs no admite UPDATE');
  check(Boolean(await asApp(ids.gerA, (pg) => sqlError(() => pg.query('DELETE FROM servicios_realizados_historial')))), 'SQL: historial de servicios no admite DELETE');
  check(Boolean(await asApp(ids.gerA, (pg) => sqlError(() => pg.query('SELECT * FROM auth_throttle')))), 'SQL: tabla de bloqueos inaccesible para la app');
  check(Boolean(await asOwner((pg) => sqlError(() => pg.query('DELETE FROM audit_logs')))), 'SQL: ni el dueño puede borrar audit_logs');
} catch (err) {
  console.error('\nError inesperado durante la auditoría:', err);
  crashed = true;
} finally {
  await h.close();
}

// ========================================================================
section('5. Bundle de producción sin variables de entorno ni secretos');
// ========================================================================
try {
  if (!skipBuild) {
    console.log('  Compilando frontend (vite build)…');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: FRONTEND, stdio: 'pipe', shell: process.platform === 'win32' });
  }
  const dist = path.join(FRONTEND, 'dist');
  h.check(existsSync(path.join(dist, 'index.html')), 'Existe frontend/dist (build de producción)');

  const files = [];
  const walk = (d) => readdirSync(d).forEach((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : files.push(path.join(d, f))));
  walk(dist);
  const textFiles = files.filter((f) => /\.(js|css|html|json|webmanifest|txt|map)$/.test(f));
  const bundle = textFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

  h.check(!files.some((f) => f.endsWith('.map')) && !/sourceMappingURL=/.test(bundle), 'Sin source maps publicados');

  const envKeys = readFileSync(path.join(BACKEND, '.env.example'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z][A-Z0-9_]+)=/)?.[1])
    .filter(Boolean);
  const leakedKeys = envKeys.filter((k) => bundle.includes(k));
  h.check(leakedKeys.length === 0, `Ningún nombre de variable de entorno del backend en el bundle${leakedKeys.length ? ` (${leakedKeys.join(', ')})` : ''}`);

  const patterns = [
    [/postgres(?:ql)?:\/\/[^\s"'`]+/i, 'Cadenas de conexión a PostgreSQL'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'Llaves privadas'],
    [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT embebidos'],
    [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/, 'API keys tipo sk_/pk_'],
    [/AKIA[0-9A-Z]{16}/, 'Llaves de AWS'],
    [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/, 'Hashes bcrypt'],
    [/process\.env\.[A-Z_]+/, 'Referencias a process.env'],
    [/(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i, 'Credenciales literales'],
    [/import\.meta\.env\.VITE_[A-Z_]+/, 'Variables VITE_ sin resolver'],
  ];
  for (const [re, label] of patterns) {
    const m = bundle.match(re);
    h.check(!m, `Sin ${label}${m ? ` (encontrado: ${m[0].slice(0, 40)}…)` : ''}`);
  }
  const testSecrets = ['x'.repeat(48), PASSWORDS.superAdmin, PASSWORDS.dev, 'app-password-1234567890'];
  h.check(!testSecrets.some((s) => bundle.includes(s)), 'Ningún secreto de esta ejecución aparece en el bundle');

  // Si existe un backend/.env real, ninguno de sus valores debe estar en el bundle.
  const envFile = path.join(BACKEND, '.env');
  if (existsSync(envFile)) {
    // Solo variables secretas: valores públicos (nombre de la IPS, NODE_ENV) pueden
    // aparecer legítimamente en la interfaz. Se reporta el NOMBRE, nunca el valor.
    const secretos = readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=(.+)$/))
      .filter((m) => m && /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/.test(m[1]))
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')])
      .filter(([, v]) => v.length >= 6);
    const leaked = secretos.filter(([, v]) => bundle.includes(v)).map(([k]) => k);
    h.check(leaked.length === 0, `Ningún secreto de backend/.env en el bundle (${secretos.length} revisados)${leaked.length ? `: ${leaked.join(', ')}` : ''}`);
  } else {
    console.log('  (backend/.env no existe: se omite la comparación con valores reales)');
  }
  console.log(`  ${textFiles.length} archivos de texto escaneados en frontend/dist`);
} catch (err) {
  console.error('\nError al escanear el bundle:', err.message);
  crashed = true;
}

const { fails, passes } = h.results();
console.log('\n────────────────────────────────────────────');
console.log(`Resultado: ${passes} OK · ${fails} FALLA${crashed ? ' · ERROR DE EJECUCIÓN' : ''}`);
console.log(fails || crashed ? 'AUDITORÍA NO SUPERADA' : 'AUDITORÍA SUPERADA');
process.exit(fails || crashed ? 1 : 0);
