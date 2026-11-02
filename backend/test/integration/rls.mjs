// Prueba de RLS, guardas y funciones de auth sobre PostgreSQL en memoria (PGlite).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MIG = new URL('../../migrations/', import.meta.url);
const db = new PGlite();
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const q = (s, p) => db.query(s, p);
async function expectErr(fn, m) { try { await fn(); ok(false, `${m} (no error)`); } catch (e) { ok(true, `${m} -> ${e.message}`); } }

await db.exec('CREATE ROLE crm_app NOLOGIN NOSUPERUSER NOBYPASSRLS');
for (const f of readdirSync(fileURLToPath(MIG)).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(path.join(fileURLToPath(MIG), f), 'utf8'));
  console.log('applied', f);
}

const org = async (slug) => (await q('INSERT INTO organizations (slug,name) VALUES ($1,$1) RETURNING id', [slug])).rows[0].id;
const A = await org('org-a'), B = await org('org-b');
const user = async (o, email, role) =>
  (await q('INSERT INTO users (organization_id,email,full_name,role,cargo,password_hash) VALUES ($1,$2,$2,$3,$4,$5) RETURNING id', [o, email, role, role === 'Colaborador' ? 'Odontólogo' : null, 'x'])).rows[0].id;
const saA = await user(A, 'sa@a.co', 'Super Admin');
const gA = await user(A, 'g@a.co', 'Gerente');
const cA = await user(A, 'c@a.co', 'Colaborador');
const gB = await user(B, 'g@b.co', 'Gerente');
await q("INSERT INTO categorias (organization_id,nombre) VALUES ($1,'Cat B')", [B]);

async function as(uid, fn) {
  await db.exec('BEGIN');
  await db.exec('SET LOCAL ROLE crm_app');
  if (uid) await q("SELECT set_config('app.current_user_id',$1,true)", [uid]);
  try { return await fn(); } finally { await db.exec('ROLLBACK'); }
}

await as(null, async () => {
  ok((await q('SELECT * FROM users')).rows.length === 0, 'sin identidad: users vacío');
  ok((await q('SELECT * FROM auth_find_user_for_login($1)', ['G@A.CO'])).rows.length === 1, 'login lookup por definer');
});
await as(cA, async () => {
  ok((await q('SELECT * FROM users')).rows.length === 3, 'colaborador ve solo su org (3)');
  ok((await q('SELECT * FROM categorias')).rows.length === 0, 'no ve categorías de otra org');
  await expectErr(() => q("INSERT INTO categorias (organization_id,nombre) VALUES ($1,'X')", [A]), 'colaborador no inserta categoría');
});
await as(cA, async () => { await expectErr(() => q("UPDATE users SET role='Gerente' WHERE id=$1", [cA]), 'colaborador no se autoasciende'); });
await as(cA, async () => {
  const r = await q("UPDATE users SET full_name='Nuevo' WHERE id=$1", [gA]);
  ok(r.affectedRows === 0, 'colaborador no edita a otros (0 filas)');
});
await as(gA, async () => {
  const c = (await q("INSERT INTO categorias (organization_id,nombre) VALUES ($1,'General') RETURNING id, created_by", [A])).rows[0];
  ok(c.created_by === gA, 'created_by estampado');
  const s = (await q('INSERT INTO servicios (organization_id,categoria_id,nombre,valor_publico,costo_clinica,puntos) VALUES ($1,$2,$3,100,50,5) RETURNING id', [A, c.id, 'Limpieza'])).rows[0];
  ok(!!s.id, 'gerente crea servicio');
  await q('INSERT INTO convenios (organization_id,nombre,entidad,porcentaje_descuento_categoria) VALUES ($1,$2,$3,$4::jsonb)', [A, 'Conv', 'Ent', JSON.stringify({ [c.id]: 10 })]);
  ok((await q("UPDATE users SET role='Asistente' WHERE id=$1", [cA])).affectedRows === 1, 'gerente cambia rol de colaborador');
  ok((await q('SELECT count(*)::int n FROM app_org_locked_users()')).rows[0].n === 0, 'locked users vacío');
  const exp = (await q("SELECT auth_create_reset_token($1,'h1','1 hour') e", [cA])).rows[0].e;
  ok(!!exp, 'gerente emite reset token');
  ok((await q('SELECT auth_revoke_user_tokens($1) n', [cA])).rows[0].n === 0, 'gerente revoca sesiones');
});
await as(gA, async () => { await expectErr(() => q("UPDATE users SET full_name='x' WHERE id=$1", [saA]), 'gerente no edita Super Admin'); });
await as(gA, async () => { await expectErr(() => q("SELECT auth_create_reset_token($1,'h2','1 hour')", [saA]), 'gerente no resetea Super Admin'); });
await as(gA, async () => { await expectErr(() => q("SELECT auth_unlock_user($1)", [gB]), 'gerente no desbloquea otra org'); });
await as(gA, async () => { await expectErr(() => q("INSERT INTO users (organization_id,email,full_name,role,password_hash) VALUES ($1,'n@a.co','N','Super Admin','x')", [A]), 'gerente no crea Super Admin'); });
await as(gA, async () => { await expectErr(() => q("INSERT INTO categorias (organization_id,nombre) VALUES ($1,'Otra')", [B]), 'gerente no inserta en otra org'); });
await as(saA, async () => {
  const c = (await q("INSERT INTO categorias (organization_id,nombre) VALUES ($1,'Zeta') RETURNING id", [A])).rows[0];
  await expectErr(() => q('DELETE FROM categorias WHERE id=$1', [c.id]), 'borrado físico bloqueado');
});

// Auditoría
await as(gA, async () => {
  await q("SELECT app_audit_log('TEST_ACTION',$1,NULL,NULL,NULL,NULL,NULL,'{}')", [B]);
  const r = (await q("SELECT organization_id, actor_user_id FROM audit_logs WHERE action='TEST_ACTION'")).rows[0];
  ok(r && r.organization_id === A && r.actor_user_id === gA, 'audit fuerza org/actor de la sesión');
});
await as(gA, async () => { await expectErr(() => q("INSERT INTO audit_logs (action) VALUES ('X_X_X')"), 'insert directo en audit_logs denegado'); });
await as(gA, async () => { await expectErr(() => q("UPDATE audit_logs SET action='HACK'"), 'update audit_logs denegado'); });
await as(cA, async () => { ok((await q('SELECT * FROM audit_logs')).rows.length === 0, 'colaborador no lee auditoría'); });
await q("SELECT app_audit_log('OWNER_ROW',$1,NULL,NULL,NULL,NULL,NULL,'{}')", [A]);
await expectErr(() => q("DELETE FROM audit_logs"), 'ni el dueño borra audit_logs');

// Throttle y refresh
await as(null, async () => {
  let last;
  for (let i = 0; i < 5; i++) last = (await q("SELECT * FROM auth_throttle_fail('X@a.co','1.1.1.1',5,100,'15 minutes','15 minutes')")).rows[0];
  ok(last.account_locked === true && last.ip_locked === false, '5 fallos bloquean la cuenta');
  ok(!!(await q("SELECT auth_throttle_check('x@a.co','9.9.9.9') u")).rows[0].u, 'check reporta bloqueo');
  await expectErr(() => q('SELECT * FROM auth_throttle'), 'auth_throttle sin acceso directo');
});
await as(null, async () => {
  await q("SELECT auth_issue_refresh_token($1,'t1','7 days','30 days','ip','ua')", [gA]);
  const r1 = (await q("SELECT * FROM auth_rotate_refresh_token('t1','t2','7 days','ip','ua')")).rows[0];
  ok(r1.status === 'ok' && r1.user_id === gA, 'rotación ok');
  const r2 = (await q("SELECT * FROM auth_rotate_refresh_token('t1','t3','7 days','ip','ua')")).rows[0];
  ok(r2.status === 'reuse', 'reutilización detectada');
  const r3 = (await q("SELECT * FROM auth_rotate_refresh_token('t2','t4','7 days','ip','ua')")).rows[0];
  ok(r3.status === 'reuse', 'familia revocada tras reutilización');
  const s = (await q('SELECT * FROM auth_session_user($1)', [gA])).rows[0];
  ok(s.role === 'Gerente', 'session user');
});
// Reset completo
await as(gA, async () => {
  await q("SELECT auth_create_reset_token($1,'rh','1 hour')", [cA]);
  await q("SELECT set_config('app.current_user_id','',true)");
  const u = (await q("SELECT * FROM auth_consume_reset_token('rh','newhash')")).rows[0];
  ok(u && u.user_id === cA, 'reset consumido');
  const again = (await q("SELECT * FROM auth_consume_reset_token('rh','x')")).rows;
  ok(again.length === 0, 'reset es de un solo uso');
});

console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
