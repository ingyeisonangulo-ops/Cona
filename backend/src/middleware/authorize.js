import { forbidden, unauthorized } from '../lib/errors.js';
import { hasPermission } from '../lib/permissions.js';

// Capa 2: rol contra matrix.json. Basta con uno de los permisos indicados.
// (Capa 3, pertenencia: RLS + requireFound() → 404 en cada handler.)
export function requirePermission(...permissions) {
  if (permissions.length === 0) throw new Error('requirePermission necesita al menos un permiso');
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!permissions.some((p) => hasPermission(req.user.role, p))) return next(forbidden());
    next();
  };
}
