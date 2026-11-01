// Seed idempotente. Ejecutar como rol dueño (MIGRATION_DATABASE_URL).
// - Producción y dev: organización + Super Admin desde SEED_SUPERADMIN_*.
// - Solo dev: un usuario por rol para pruebas y un catálogo de ejemplo.
// Nunca sobrescribe contraseñas de usuarios existentes.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { ROLES, SUPER_ADMIN } from '../src/lib/permissions.js';
import { pgSslFromEnv } from './_env.js';
import { hashPassword, validatePasswordPolicy } from '../src/security/password.js';

const ORG_SLUG = 'nuevo-amanecer-pacifico';

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

async function ensureUser(client, orgId, { email, fullName, role, password }) {
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    console.log(`[seed] ${role.padEnd(12)} ${email} (ya existe, sin cambios)`);
    return false;
  }
  const { rows } = await client.query(
    `INSERT INTO users (organization_id, email, full_name, role, password_hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [orgId, email, fullName, role, await hashPassword(password)],
  );
  await client.query("SELECT app_audit_log('SEED_USER_CREATED', $1, NULL, 'user', $2, NULL, 'seed', $3)", [
    orgId,
    rows[0].id,
    JSON.stringify({ email, role }),
  ]);
  console.log(`[seed] ${role.padEnd(12)} ${email} (creado)`);
  return true;
}

async function seedDevCatalog(client, orgId) {
  const categorias = {
    'Odontología General': [
      ['Consulta de valoración', 60000, 15000, 10],
      ['Profilaxis y detartraje', 120000, 35000, 20],
      ['Resina dental', 150000, 45000, 25],
    ],
    Ortodoncia: [
      ['Instalación de brackets', 1800000, 600000, 150],
      ['Control de ortodoncia', 120000, 30000, 15],
    ],
    Estética: [['Blanqueamiento dental', 650000, 180000, 60]],
  };
  const ids = {};
  for (const [nombre, servicios] of Object.entries(categorias)) {
    const { rows } = await client.query(
      `INSERT INTO categorias (organization_id, nombre) VALUES ($1, $2)
       ON CONFLICT (organization_id, lower(nombre)) DO UPDATE SET nombre = categorias.nombre
       RETURNING id`,
      [orgId, nombre],
    );
    ids[nombre] = rows[0].id;
    for (const [sNombre, valor, costo, puntos] of servicios) {
      await client.query(
        `INSERT INTO servicios (organization_id, categoria_id, nombre, valor_publico, costo_clinica, puntos)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, lower(nombre)) DO NOTHING`,
        [orgId, rows[0].id, sNombre, valor, costo, puntos],
      );
    }
  }
  await client.query(
    `INSERT INTO convenios (organization_id, nombre, entidad, porcentaje_descuento_categoria)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (organization_id, lower(nombre)) DO NOTHING`,
    [orgId, 'Convenio Docentes', 'Secretaría de Educación (ejemplo)', JSON.stringify({ [ids['Odontología General']]: 10, [ids['Estética']]: 5 })],
  );
  console.log('[seed] catálogo de ejemplo (dev) verificado');
}

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const superEmail = requireEnv('SEED_SUPERADMIN_EMAIL').toLowerCase();
  const superPassword = requireEnv('SEED_SUPERADMIN_PASSWORD');
  const policyError = validatePasswordPolicy(superPassword);
  if (policyError) throw new Error(`SEED_SUPERADMIN_PASSWORD: ${policyError}`);

  let devPassword = process.env.SEED_DEV_PASSWORD?.trim();
  let generated = false;
  if (!isProd) {
    if (!devPassword) {
      devPassword = randomBytes(12).toString('base64url');
      generated = true;
    }
    const devError = validatePasswordPolicy(devPassword);
    if (devError) throw new Error(`SEED_DEV_PASSWORD: ${devError}`);
  }

  const client = new pg.Client({ connectionString: requireEnv('MIGRATION_DATABASE_URL'), ssl: pgSslFromEnv() });
  await client.connect();
  try {
    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO organizations (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`,
      [ORG_SLUG, process.env.SEED_ORG_NAME?.trim() || 'IPS Centro Odontológico Nuevo Amanecer del Pacífico SAS'],
    );
    const orgId = org.rows[0].id;

    await ensureUser(client, orgId, {
      email: superEmail,
      fullName: process.env.SEED_SUPERADMIN_NAME?.trim() || 'Super Administrador',
      role: SUPER_ADMIN,
      password: superPassword,
    });

    let createdDev = false;
    if (!isProd) {
      const domain = process.env.SEED_DEV_EMAIL_DOMAIN?.trim() || 'nuevoamanecer.test';
      for (const role of ROLES.filter((r) => r !== SUPER_ADMIN)) {
        const slug = role.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
        const created = await ensureUser(client, orgId, {
          email: `${slug}@${domain}`,
          fullName: `${role} de Pruebas`,
          role,
          password: devPassword,
        });
        createdDev ||= created;
      }
      await seedDevCatalog(client, orgId);
    }
    await client.query('COMMIT');

    if (generated && createdDev) {
      console.log(`[seed] contraseña generada para usuarios de prueba (solo se muestra ahora): ${devPassword}`);
    }
    console.log('[seed] completado');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[seed] ${err.message}`);
  process.exit(1);
});
