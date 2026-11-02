import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { badRequest, forbidden, requireFound } from '../lib/errors.js';
import { CARGOS_COLABORADOR } from '../lib/cargos.js';
import { ROLES, SUPER_ADMIN } from '../lib/permissions.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';
import { hashPassword, validatePasswordPolicy } from '../security/password.js';
import { hashToken, newOpaqueToken } from '../security/tokens.js';

export const usersRouter = Router();
usersRouter.use(requirePermission('MANAGE_USERS'));

const RESET_TTL_MINUTES = 60;

const idParam = z.object({ id: z.uuid('Identificador inválido') });
const roleField = z.enum(ROLES, { message: 'Rol inválido' });
const cargoField = z.enum(CARGOS_COLABORADOR, { message: 'Cargo inválido' });

// El Colaborador necesita cargo (Odontólogo, Higienista, Auxiliar o Especialista).
// La Asistente queda con cargo "Asistente" y Gerente/Super Admin sin cargo (lo
// normaliza la base de datos).
function resolveCargo(role, cargo) {
  if (role !== 'Colaborador') return null;
  if (!cargo) throw badRequest('Seleccione el cargo del colaborador', 'CARGO_REQUIRED');
  return cargo;
}
const passwordField = z.string().superRefine((v, ctx) => {
  const msg = validatePasswordPolicy(v);
  if (msg) ctx.addIssue({ code: 'custom', message: msg });
});

const createSchema = z.object({
  email: z.email('Email inválido').trim().toLowerCase().max(254),
  fullName: z.string().trim().min(2, 'Nombre muy corto').max(200),
  role: roleField,
  cargo: cargoField.optional(),
  password: passwordField,
});
const updateSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Nombre muy corto').max(200).optional(),
    role: roleField.optional(),
    cargo: cargoField.optional(),
  })
  .refine((v) => v.fullName !== undefined || v.role !== undefined || v.cargo !== undefined, 'Nada que actualizar');
const statusSchema = z.object({ status: z.enum(['active', 'inactive']) });

const USER_COLUMNS = `u.id, u.email, u.full_name, u.role, u.cargo, u.is_active, u.must_change_password,
  u.last_login_at, u.created_at, u.updated_at, l.locked_until`;

function toUser(r) {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    cargo: r.cargo,
    status: r.is_active ? 'active' : 'inactive',
    mustChangePassword: r.must_change_password,
    lockedUntil: r.locked_until,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function findUser(id) {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS} FROM users u
     LEFT JOIN app_org_locked_users() l ON l.user_id = u.id
     WHERE u.id = $1`,
    [id],
  );
  return rows[0];
}

// Capa 3: el registro debe existir en la organización (RLS) y un Gerente no
// puede gestionar a un Super Admin. En ambos casos: 404.
async function loadManageable(req) {
  const { id } = parse(idParam, req.params);
  const target = requireFound(await findUser(id));
  if (target.role === SUPER_ADMIN && req.user.role !== SUPER_ADMIN) requireFound(null);
  return target;
}

async function invalidateSessions(userId) {
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
  await db.query('SELECT auth_revoke_user_tokens($1)', [userId]);
}

usersRouter.get(
  '/',
  txRoute(async () => {
    const { rows } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users u
       LEFT JOIN app_org_locked_users() l ON l.user_id = u.id
       ORDER BY u.is_active DESC, u.full_name`,
    );
    return { users: rows.map(toUser) };
  }),
);

usersRouter.get(
  '/:id',
  txRoute(async (req) => ({ user: toUser(await loadManageable(req)) })),
);

usersRouter.post(
  '/',
  txRoute(
    async (req, res) => {
      const data = parse(createSchema, req.body ?? {});
      if (data.role === SUPER_ADMIN && req.user.role !== SUPER_ADMIN) throw forbidden('Solo un Super Admin puede crear otro Super Admin');
      const cargo = resolveCargo(data.role, data.cargo);
      const { rows } = await db.query(
        `INSERT INTO users (organization_id, email, full_name, role, cargo, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
        [req.user.organizationId, data.email, data.fullName, data.role, cargo, await hashPassword(data.password)],
      );
      const id = rows[0].id;
      res.locals.status = 201;
      res.locals.audit = { entityId: id, metadata: { email: data.email, role: data.role, cargo } };
      return { user: toUser(await findUser(id)) };
    },
    { audit: 'USER_CREATED', entityType: 'user' },
  ),
);

usersRouter.patch(
  '/:id',
  txRoute(
    async (req, res) => {
      const target = await loadManageable(req);
      const data = parse(updateSchema, req.body ?? {});
      const roleChanged = data.role !== undefined && data.role !== target.role;

      if (roleChanged) {
        if (target.id === req.user.id) throw badRequest('No puede cambiar su propio rol');
        if (data.role === SUPER_ADMIN && req.user.role !== SUPER_ADMIN) throw forbidden('Solo un Super Admin puede asignar ese rol');
      }

      const role = data.role ?? target.role;
      const cargo = resolveCargo(role, data.cargo ?? (role === target.role ? target.cargo : undefined));
      const cargoChanged = cargo !== target.cargo && role === 'Colaborador';

      await db.query('UPDATE users SET full_name = coalesce($1, full_name), role = $2, cargo = $3 WHERE id = $4', [
        data.fullName ?? null,
        role,
        cargo,
        target.id,
      ]);
      if (roleChanged) await invalidateSessions(target.id);

      res.locals.audit = roleChanged
        ? { action: 'ROLE_CHANGED', metadata: { from: target.role, to: role, cargo } }
        : { metadata: { fields: Object.keys(data), ...(cargoChanged && { cargo: { from: target.cargo, to: cargo } }) } };
      return { user: toUser(await findUser(target.id)) };
    },
    { audit: 'USER_UPDATED', entityType: 'user' },
  ),
);

usersRouter.patch(
  '/:id/status',
  txRoute(
    async (req, res) => {
      const target = await loadManageable(req);
      const { status } = parse(statusSchema, req.body ?? {});
      if (target.id === req.user.id) throw badRequest('No puede cambiar el estado de su propia cuenta');

      await db.query('UPDATE users SET is_active = $1 WHERE id = $2', [status === 'active', target.id]);
      if (status === 'inactive') await invalidateSessions(target.id);

      res.locals.audit = { action: status === 'active' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED' };
      return { user: toUser(await findUser(target.id)) };
    },
    { entityType: 'user' },
  ),
);

usersRouter.post(
  '/:id/unlock',
  txRoute(
    async (req, res) => {
      const target = await loadManageable(req);
      const { rows } = await db.query('SELECT auth_unlock_user($1) AS unlocked', [target.id]);
      res.locals.audit = { metadata: { wasLocked: rows[0].unlocked } };
      return { user: toUser(await findUser(target.id)) };
    },
    { audit: 'ACCOUNT_UNLOCKED', entityType: 'user' },
  ),
);

// Genera un enlace de un solo uso (60 min) que el administrador entrega al
// usuario, e invalida de inmediato sus sesiones activas.
usersRouter.post(
  '/:id/reset-password',
  txRoute(
    async (req) => {
      const target = await loadManageable(req);
      if (!target.is_active) throw badRequest('La cuenta está desactivada');
      const token = newOpaqueToken();
      const { rows } = await db.query('SELECT auth_create_reset_token($1, $2, $3::interval) AS expires_at', [
        target.id,
        hashToken(token),
        `${RESET_TTL_MINUTES} minutes`,
      ]);
      await invalidateSessions(target.id);
      // El token va en el fragmento (#): no viaja al servidor ni queda en logs.
      return { resetUrl: `${config.appOrigin}/restablecer#token=${token}`, expiresAt: rows[0].expires_at };
    },
    { audit: 'PASSWORD_RESET_ISSUED', entityType: 'user' },
  ),
);
