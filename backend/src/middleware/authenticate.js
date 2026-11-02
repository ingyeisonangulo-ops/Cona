import { db } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { permissionsFor } from '../lib/permissions.js';
import { ACCESS_COOKIE } from '../security/cookies.js';
import { verifyAccessToken } from '../security/tokens.js';

// Capa 1: autenticación. Valida el access token de la cookie y recarga el
// usuario desde la BD (estado, rol y versión de token vigentes).
export async function authenticate(req, _res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next(unauthorized());

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(unauthorized('Sesión expirada', 'TOKEN_EXPIRED'));
  }

  const { rows } = await db.query('SELECT * FROM auth_session_user($1)', [payload.sub]);
  const user = rows[0];
  if (!user || !user.is_active || user.token_version !== payload.tv) {
    return next(unauthorized('Sesión inválida', 'SESSION_REVOKED'));
  }

  req.user = {
    id: user.id,
    organizationId: user.organization_id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    cargo: user.cargo ?? null,
    mustChangePassword: user.must_change_password,
    permissions: permissionsFor(user.role),
  };
  next();
}
