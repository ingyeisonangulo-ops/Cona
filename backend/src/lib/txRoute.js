import { db } from '../db.js';
import { audit } from '../services/audit.js';
import { badRequest } from './errors.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Envuelve un handler autenticado en una transacción con
 * app.current_user_id = req.user.id (RLS activo) y registra auditoría
 * automáticamente para toda escritura, dentro de la misma transacción: si la
 * operación se revierte, su registro de auditoría también.
 *
 * El handler devuelve el cuerpo JSON. Puede fijar res.locals.status y
 * res.locals.audit = { action, entityType, entityId, metadata }.
 */
export function txRoute(handler, { audit: action, entityType } = {}) {
  return async (req, res) => {
    const body = await db.transaction(req.user.id, async () => {
      const result = await handler(req, res);
      if (WRITE_METHODS.has(req.method) || action) {
        const a = res.locals.audit ?? {};
        await audit(req, a.action ?? action ?? `WRITE_${req.method}`, {
          entityType: a.entityType ?? entityType ?? null,
          entityId: a.entityId ?? req.params?.id ?? null,
          metadata: { path: req.baseUrl + req.route.path, ...(a.metadata ?? {}) },
        });
      }
      return result;
    });
    res.status(res.locals.status ?? 200).json(body ?? { ok: true });
  };
}

// Valida con un esquema zod y devuelve 400 con el primer mensaje.
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(result.error.issues[0]?.message ?? 'Datos inválidos', 'VALIDATION');
  }
  return result.data;
}
