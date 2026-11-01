import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ALL_PERMISSIONS, ROLES, hasPermission, permissionsFor } from '../src/lib/permissions.js';
import { validatePasswordPolicy, verifyPassword, hashPassword, BCRYPT_COST } from '../src/security/password.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('los roles del CHECK de users coinciden con matrix.json', () => {
  const sql = read('../migrations/001_core_schema.sql');
  const check = sql.match(/role\s+text NOT NULL CHECK \(role IN \(([^)]+)\)\)/);
  assert.ok(check, 'no se encontró el CHECK de roles');
  const dbRoles = check[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual([...dbRoles].sort(), [...ROLES].sort());
});

test('todo permiso usado en las rutas existe en matrix.json', () => {
  const dir = new URL('../src/routes/', import.meta.url);
  const used = new Set();
  for (const f of readdirSync(dir)) {
    for (const m of read(`../src/routes/${f}`).matchAll(/requirePermission\(([^)]*)\)/g)) {
      for (const p of m[1].matchAll(/'([A-Z_]+)'/g)) used.add(p[1]);
    }
  }
  assert.ok(used.size > 0);
  for (const p of used) assert.ok(ALL_PERMISSIONS.includes(p), `permiso desconocido: ${p}`);
});

test('matriz: Super Admin tiene todo, Colaborador no gestiona servicios', () => {
  for (const p of ALL_PERMISSIONS) assert.equal(hasPermission('Super Admin', p), true);
  assert.equal(hasPermission('Gerente', 'MANAGE_SERVICES'), true);
  assert.equal(hasPermission('Asistente', 'MANAGE_SERVICES'), false);
  assert.equal(hasPermission('Colaborador', 'MANAGE_USERS'), false);
  assert.equal(hasPermission('Colaborador', 'VIEW_ROLE_SERVICES'), true);
  assert.equal(hasPermission('Desconocido', 'VIEW_ROLE_SERVICES'), false);
  assert.deepEqual(permissionsFor('Desconocido'), []);
  assert.equal(hasPermission('Asistente', 'ALL'), false);
});

test('política de contraseñas', () => {
  assert.ok(validatePasswordPolicy('corta'));
  assert.ok(validatePasswordPolicy('a'.repeat(11)));
  assert.equal(validatePasswordPolicy('a'.repeat(12)), null);
  assert.ok(validatePasswordPolicy('ñ'.repeat(40)), 'más de 72 bytes');
  assert.ok(validatePasswordPolicy(' contraseña-con-espacio'));
  assert.ok(validatePasswordPolicy(undefined));
});

test('bcrypt cost 12 y verificación', async () => {
  assert.ok(BCRYPT_COST >= 12);
  const hash = await hashPassword('ClaveSegura#2026');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyPassword('ClaveSegura#2026', hash), true);
  assert.equal(await verifyPassword('otra-clave-xyz', hash), false);
  assert.equal(await verifyPassword('ClaveSegura#2026', undefined), false);
});
