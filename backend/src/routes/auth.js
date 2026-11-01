import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { badRequest, tooManyRequests, unauthorized } from '../lib/errors.js';
import { permissionsFor } from '../lib/permissions.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { authenticate } from '../middleware/authenticate.js';
import { audit } from '../services/audit.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../security/cookies.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../security/password.js';
import { hashToken, newOpaqueToken, signAccessToken } from '../security/tokens.js';

export const authRouter = Router();

const INVALID_CREDENTIALS = 'Email o contraseña incorrectos';
const LOCKED_MESSAGE = 'Demasiados intentos fallidos. Intente de nuevo en 15 minutos.';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(256),
});

const passwordField = z.string().superRefine((value, ctx) => {
  const msg = validatePasswordPolicy(value);
  if (msg) ctx.addIssue({ code: 'custom', message: msg });
});

const interval = (unit, n) => `${n} ${unit}`;

export function toProfile(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name ?? u.fullName,
    role: u.role,
    mustChangePassword: u.must_change_password ?? u.mustChangePassword,
    permissions: permissionsFor(u.role),
  };
}

// --------------------------------------------------------------------------
// POST /api/auth/login
// --------------------------------------------------------------------------
authRouter.post('/login', async (req, res) => {
  const { email, password } = parse(loginSchema, req.body ?? {});
  const ip = req.ip;

  const lock = await db.query('SELECT auth_throttle_check($1, $2) AS until', [email, ip]);
  if (lock.rows[0].until) {
    await audit(req, 'LOGIN_BLOCKED', { entityType: 'user', metadata: { email } });
    throw tooManyRequests(LOCKED_MESSAGE);
  }

  const { rows } = await db.query('SELECT * FROM auth_find_user_for_login($1)', [email]);
  const found = rows[0];
  // Siempre se ejecuta bcrypt (hash ficticio si no existe) para equilibrar tiempos.
  const passwordOk = await verifyPassword(password, found?.password_hash);

  if (!found || !passwordOk || !found.is_active) {
    const { lockout: l } = config;
    const fail = await db.query('SELECT * FROM auth_throttle_fail($1, $2, $3, $4, $5::interval, $6::interval)', [
      email,
      ip,
      l.maxAccount,
      l.maxIp,
      interval('minutes', l.windowMinutes),
      interval('minutes', l.durationMinutes),
    ]);
    const orgId = found?.organization_id ?? null;
    const reason = !found ? 'unknown_account' : !passwordOk ? 'bad_password' : 'inactive';
    await audit(req, 'LOGIN_FAILED', { organizationId: orgId, entityType: 'user', entityId: found?.id, metadata: { email, reason } });
    const { account_locked: accountLocked, ip_locked: ipLocked } = fail.rows[0];
    if (accountLocked) {
      await audit(req, 'ACCOUNT_LOCKED', { organizationId: orgId, entityType: 'user', entityId: found?.id, metadata: { email } });
    }
    if (ipLocked) {
      await audit(req, 'IP_LOCKED', { organizationId: orgId, metadata: { ip } });
    }
    throw unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  const refreshToken = newOpaqueToken();
  const user = await db.transaction(null, async () => {
    await db.query('SELECT auth_throttle_success($1)', [email]);
    await db.query('SELECT auth_mark_login($1)', [found.id]);
    await db.query('SELECT auth_issue_refresh_token($1, $2, $3::interval, $4::interval, $5, $6)', [
      found.id,
      hashToken(refreshToken),
      interval('days', config.refresh.ttlDays),
      interval('days', config.refresh.familyMaxDays),
      ip,
      req.get('user-agent') ?? null,
    ]);
    await audit(req, 'LOGIN_SUCCESS', { organizationId: found.organization_id, actorUserId: found.id, entityType: 'user', entityId: found.id });
    return (await db.query('SELECT * FROM auth_session_user($1)', [found.id])).rows[0];
  });

  setAuthCookies(res, signAccessToken(user), refreshToken);
  res.json({ user: toProfile(user) });
});

// --------------------------------------------------------------------------
// POST /api/auth/refresh — rotación con detección de reutilización
// --------------------------------------------------------------------------
authRouter.post('/refresh', async (req, res) => {
  const current = req.cookies?.[REFRESH_COOKIE];
  if (!current) throw unauthorized();

  const next = newOpaqueToken();
  const { rows } = await db.query('SELECT * FROM auth_rotate_refresh_token($1, $2, $3::interval, $4, $5)', [
    hashToken(current),
    hashToken(next),
    interval('days', config.refresh.ttlDays),
    req.ip,
    req.get('user-agent') ?? null,
  ]);
  const { status, user_id: userId } = rows[0];

  if (status !== 'ok') {
    if (status === 'reuse') {
      const u = (await db.query('SELECT * FROM auth_session_user($1)', [userId])).rows[0];
      await audit(req, 'REFRESH_TOKEN_REUSE', { organizationId: u?.organization_id, actorUserId: userId, entityType: 'user', entityId: userId });
    }
    clearAuthCookies(res);
    throw unauthorized('Sesión expirada', 'SESSION_EXPIRED');
  }

  const user = (await db.query('SELECT * FROM auth_session_user($1)', [userId])).rows[0];
  setAuthCookies(res, signAccessToken(user), next);
  res.json({ user: toProfile(user) });
});

// --------------------------------------------------------------------------
// POST /api/auth/logout — revoca la familia del refresh token actual
// --------------------------------------------------------------------------
authRouter.post('/logout', async (req, res) => {
  const current = req.cookies?.[REFRESH_COOKIE];
  if (current) {
    const { rows } = await db.query('SELECT auth_revoke_refresh_token($1) AS user_id', [hashToken(current)]);
    const userId = rows[0]?.user_id;
    if (userId) {
      const u = (await db.query('SELECT * FROM auth_session_user($1)', [userId])).rows[0];
      await audit(req, 'LOGOUT', { organizationId: u?.organization_id, actorUserId: userId, entityType: 'user', entityId: userId });
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// GET /api/auth/me
// --------------------------------------------------------------------------
authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: toProfile(req.user) });
});

// --------------------------------------------------------------------------
// POST /api/auth/change-password — invalida todas las sesiones
// --------------------------------------------------------------------------
const changePasswordSchema = z.object({
  currentPassword: z.string().max(256),
  newPassword: passwordField,
});

authRouter.post(
  '/change-password',
  authenticate,
  txRoute(
    async (req, res) => {
      const { currentPassword, newPassword } = parse(changePasswordSchema, req.body ?? {});
      if (currentPassword === newPassword) throw badRequest('La nueva contraseña debe ser distinta a la actual');

      const { rows } = await db.query('SELECT password_hash FROM auth_find_user_for_login($1)', [req.user.email]);
      if (!(await verifyPassword(currentPassword, rows[0]?.password_hash))) {
        throw badRequest('La contraseña actual no es correcta', 'INVALID_CURRENT_PASSWORD');
      }

      await db.query(
        `UPDATE users SET password_hash = $1, must_change_password = false, token_version = token_version + 1
         WHERE id = $2`,
        [await hashPassword(newPassword), req.user.id],
      );
      await db.query('SELECT auth_revoke_user_tokens($1)', [req.user.id]);
      res.locals.audit = { entityType: 'user', entityId: req.user.id };
      clearAuthCookies(res);
      return { ok: true, reauthenticate: true };
    },
    { audit: 'PASSWORD_CHANGED' },
  ),
);

// --------------------------------------------------------------------------
// POST /api/auth/logout-all — cierra todas las sesiones del usuario
// --------------------------------------------------------------------------
authRouter.post(
  '/logout-all',
  authenticate,
  txRoute(
    async (req, res) => {
      await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
      const { rows } = await db.query('SELECT auth_revoke_user_tokens($1) AS revoked', [req.user.id]);
      res.locals.audit = { entityType: 'user', entityId: req.user.id, metadata: { revoked: rows[0].revoked } };
      clearAuthCookies(res);
      return { ok: true };
    },
    { audit: 'SESSIONS_REVOKED' },
  ),
);

// --------------------------------------------------------------------------
// POST /api/auth/forgot-password — respuesta genérica; notifica a administradores
// --------------------------------------------------------------------------
const GENERIC_FORGOT =
  'Si el correo está registrado, un administrador de la clínica recibirá la solicitud y le entregará un enlace de restablecimiento.';

authRouter.post('/forgot-password', async (req, res) => {
  const email = z.string().trim().toLowerCase().max(254).catch('').parse(req.body?.email);
  const locked = (await db.query('SELECT auth_throttle_check($1, $2) AS until', [email, req.ip])).rows[0].until;
  if (email && !locked) {
    const found = (await db.query('SELECT id, organization_id, is_active FROM auth_find_user_for_login($1)', [email])).rows[0];
    if (found?.is_active) {
      await audit(req, 'PASSWORD_RESET_REQUESTED', { organizationId: found.organization_id, entityType: 'user', entityId: found.id, metadata: { email } });
    }
  }
  res.status(202).json({ message: GENERIC_FORGOT });
});

// --------------------------------------------------------------------------
// POST /api/auth/reset-password — consume el enlace de un solo uso
// --------------------------------------------------------------------------
const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordField });

authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = parse(resetSchema, req.body ?? {});
  const passwordHash = await hashPassword(password);
  const result = await db.transaction(null, async () => {
    const { rows } = await db.query('SELECT * FROM auth_consume_reset_token($1, $2)', [hashToken(token), passwordHash]);
    const u = rows[0];
    if (u) {
      await audit(req, 'PASSWORD_RESET_COMPLETED', { organizationId: u.organization_id, actorUserId: u.user_id, entityType: 'user', entityId: u.user_id });
    }
    return u;
  });
  if (!result) throw badRequest('El enlace no es válido o ya expiró', 'INVALID_RESET_TOKEN');
  clearAuthCookies(res);
  res.json({ ok: true });
});
