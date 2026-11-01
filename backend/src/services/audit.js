import { db } from '../db.js';

/**
 * Escribe en audit_logs vía app_audit_log(). Dentro de una transacción con
 * identidad, la organización y el actor los fija la base de datos; fuera de
 * ella (login, refresh) se toman de los parámetros. Nunca incluir contraseñas
 * ni tokens en metadata.
 */
export async function audit(req, action, opts = {}) {
  const { organizationId = null, actorUserId = null, entityType = null, entityId = null, metadata = {} } = opts;
  await db.query('SELECT app_audit_log($1, $2, $3, $4, $5, $6, $7, $8)', [
    action,
    organizationId,
    actorUserId,
    entityType,
    entityId == null ? null : String(entityId),
    req.ip ?? null,
    req.get?.('user-agent') ?? null,
    JSON.stringify(metadata),
  ]);
}
