import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { db } from '../db.js';
import { ALL_PERMISSIONS, ROLES, permissionsFor } from '../lib/permissions.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';

// GET /api/roles — matriz de permisos (solo lectura), leída de matrix.json.
export const rolesRouter = Router();
rolesRouter.get('/', requirePermission('MANAGE_USERS'), (_req, res) => {
  const raw = JSON.parse(readFileSync(new URL('../../matrix.json', import.meta.url), 'utf8'));
  res.json({
    permissions: ALL_PERMISSIONS,
    roles: ROLES.map((name) => ({ name, all: raw[name].includes('ALL'), permissions: permissionsFor(name) })),
  });
});

// GET /api/audit-logs — RLS limita a la organización y a administradores.
export const auditRouter = Router();
const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
  action: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,63}$/)
    .optional(),
});

auditRouter.get(
  '/',
  requirePermission('VIEW_AUDIT_LOGS'),
  txRoute(async (req) => {
    const q = parse(auditQuery, req.query);
    const { rows } = await db.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.ip, a.metadata, a.created_at,
              u.email AS actor_email, u.full_name AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ($1::bigint IS NULL OR a.id < $1) AND ($2::text IS NULL OR a.action = $2)
       ORDER BY a.id DESC
       LIMIT $3`,
      [q.before ?? null, q.action ?? null, q.limit],
    );
    return {
      logs: rows.map((r) => ({
        id: Number(r.id),
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        ip: r.ip,
        metadata: r.metadata,
        createdAt: r.created_at,
        actor: r.actor_email ? { email: r.actor_email, fullName: r.actor_name } : null,
      })),
      nextBefore: rows.length === q.limit ? Number(rows.at(-1).id) : null,
    };
  }),
);
