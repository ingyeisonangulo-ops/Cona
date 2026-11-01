import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { hasPermission } from '../lib/permissions.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';
import { propuestaSemanal, todayParts } from '../services/metrics.js';
import { desempenoColaboradores, loadRecurrencia } from '../services/performance.js';

export const colaboradoresRouter = Router();
export const metasRouter = Router();
export const configuracionRouter = Router();
export const miProgresoRouter = Router();

export function periodoSchema() {
  const t = todayParts();
  return z.object({
    anio: z.coerce.number().int().min(2020).max(2100).default(t.anio),
    mes: z.coerce.number().int().min(1).max(12).default(t.mes),
  });
}

// Lista mínima (id y nombre) para selectores de registro, agenda y metas.
colaboradoresRouter.get(
  '/',
  requirePermission('REGISTER_SERVICES', 'MANAGE_APPOINTMENTS', 'MANAGE_COLLABORATORS'),
  txRoute(async () => {
    const { rows } = await db.query("SELECT id, full_name FROM users WHERE role = 'Colaborador' AND is_active ORDER BY full_name");
    return { colaboradores: rows.map((r) => ({ id: r.id, nombre: r.full_name })) };
  }),
);

// ---------------------------------------------------------------------------
// Metas mensuales
// ---------------------------------------------------------------------------
metasRouter.use(requirePermission('MANAGE_COLLABORATORS'));

metasRouter.get(
  '/',
  txRoute(async (req) => {
    const { anio, mes } = parse(periodoSchema(), req.query);
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, m.meta_puntos, m.meta_dinero, m.valor_punto_adicional, m.distribucion_semanal, m.updated_at
       FROM users u
       LEFT JOIN metas_colaborador m ON m.colaborador_id = u.id AND m.anio = $1 AND m.mes = $2
       WHERE u.role = 'Colaborador' AND (u.is_active OR m.id IS NOT NULL)
       ORDER BY u.full_name`,
      [anio, mes],
    );
    return {
      anio,
      mes,
      metas: rows.map((r) => ({
        colaboradorId: r.id,
        nombre: r.full_name,
        meta: r.meta_puntos
          ? {
              metaPuntos: r.meta_puntos,
              metaDinero: Number(r.meta_dinero),
              valorPuntoAdicional: Number(r.valor_punto_adicional),
              distribucionSemanal: r.distribucion_semanal,
              propuestaSemanal: propuestaSemanal(r.meta_puntos, anio, mes),
              updatedAt: r.updated_at,
            }
          : null,
      })),
    };
  }),
);

// Propuesta automática (sin guardar) para el formulario.
metasRouter.get(
  '/propuesta',
  txRoute(async (req) => {
    const q = parse(periodoSchema().extend({ metaPuntos: z.coerce.number().int().min(1).max(1_000_000) }), req.query);
    return { semanas: propuestaSemanal(q.metaPuntos, q.anio, q.mes) };
  }),
);

const metaSchema = z
  .object({
    colaboradorId: z.uuid('Seleccione el colaborador'),
    anio: z.coerce.number().int().min(2020).max(2100),
    mes: z.coerce.number().int().min(1).max(12),
    metaPuntos: z.coerce.number().int('Debe ser entero').min(1, 'La meta debe ser mayor que 0').max(1_000_000),
    metaDinero: z.coerce.number().min(0).max(999_999_999_999),
    valorPuntoAdicional: z.coerce.number().min(0).max(100_000_000),
    distribucionSemanal: z.array(z.coerce.number().int().min(0)).length(4).nullable().optional(),
  })
  .refine((d) => !d.distribucionSemanal || d.distribucionSemanal.reduce((a, b) => a + b, 0) === d.metaPuntos, {
    message: 'La distribución semanal debe sumar la meta mensual',
    path: ['distribucionSemanal'],
  });

metasRouter.put(
  '/',
  txRoute(
    async (req, res) => {
      const d = parse(metaSchema, req.body ?? {});
      const { rows } = await db.query(
        `INSERT INTO metas_colaborador (organization_id, colaborador_id, anio, mes, meta_puntos, meta_dinero, valor_punto_adicional, distribucion_semanal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (organization_id, colaborador_id, anio, mes) DO UPDATE SET
           meta_puntos = EXCLUDED.meta_puntos, meta_dinero = EXCLUDED.meta_dinero,
           valor_punto_adicional = EXCLUDED.valor_punto_adicional, distribucion_semanal = EXCLUDED.distribucion_semanal
         RETURNING id`,
        [
          req.user.organizationId,
          d.colaboradorId,
          d.anio,
          d.mes,
          d.metaPuntos,
          d.metaDinero,
          d.valorPuntoAdicional,
          d.distribucionSemanal ? JSON.stringify(d.distribucionSemanal) : null,
        ],
      );
      res.locals.audit = { entityId: rows[0].id, metadata: d };
      return { ok: true, id: rows[0].id };
    },
    { audit: 'META_ASSIGNED', entityType: 'meta_colaborador' },
  ),
);

// ---------------------------------------------------------------------------
// Configuración de recurrencia
// ---------------------------------------------------------------------------
configuracionRouter.use(requirePermission('MANAGE_COLLABORATORS'));

const mapConfig = (r) => ({ puntosNivel60: r?.puntos_nivel_60 ?? 0, puntosNivel80: r?.puntos_nivel_80 ?? 0, updatedAt: r?.updated_at ?? null });

configuracionRouter.get(
  '/recurrencia',
  txRoute(async () => ({ configuracion: mapConfig((await db.query('SELECT * FROM configuracion_recurrencia')).rows[0]) })),
);

configuracionRouter.put(
  '/recurrencia',
  txRoute(
    async (req, res) => {
      const d = parse(
        z
          .object({ puntosNivel60: z.coerce.number().int().min(0).max(100_000), puntosNivel80: z.coerce.number().int().min(0).max(100_000) })
          .refine((v) => v.puntosNivel80 >= v.puntosNivel60, { message: 'Los puntos del nivel 80% deben ser mayores o iguales a los del 60%' }),
        req.body ?? {},
      );
      const { rows } = await db.query(
        `INSERT INTO configuracion_recurrencia (organization_id, puntos_nivel_60, puntos_nivel_80) VALUES ($1, $2, $3)
         ON CONFLICT (organization_id) DO UPDATE SET puntos_nivel_60 = EXCLUDED.puntos_nivel_60, puntos_nivel_80 = EXCLUDED.puntos_nivel_80
         RETURNING *`,
        [req.user.organizationId, d.puntosNivel60, d.puntosNivel80],
      );
      res.locals.audit = { entityId: req.user.organizationId, metadata: d };
      return { configuracion: mapConfig(rows[0]) };
    },
    { audit: 'RECURRENCIA_CONFIGURED', entityType: 'configuracion_recurrencia' },
  ),
);

// ---------------------------------------------------------------------------
// Vista del Colaborador — ULTRA RESTRINGIDA
// Solo puntos, metas en puntos y cantidades. Nunca dinero, comisiones,
// datos de pacientes ni ocupación general de la agenda. La respuesta se arma
// por lista blanca de campos.
// ---------------------------------------------------------------------------
miProgresoRouter.get(
  '/',
  requirePermission('VIEW_PERSONAL_PROGRESS'),
  txRoute(async (req) => {
    const { anio, mes } = parse(periodoSchema(), req.query);
    const recurrencia = await loadRecurrencia(anio, mes);
    const [d] = await desempenoColaboradores({ anio, mes, colaboradorId: req.user.id, recurrencia });
    if (!d) throw badRequest('Usuario no encontrado');

    const out = {
      anio,
      mes,
      puntos: {
        servicios: d.puntosServicios,
        bonoRecurrencia: d.bonoRecurrencia,
        total: d.puntosTotales,
      },
      meta: d.meta ? { puntos: d.meta.puntos } : null,
      faltantes: d.faltantes,
      porcentaje: d.cumplimientoPuntos,
      cumpleMeta: d.cumpleMeta,
      serviciosRealizados: d.servicios,
      semanas: d.semanas.map((w) => ({ semana: w.semana, puntos: w.puntos, propuesta: w.propuestaPuntos })),
    };

    if (hasPermission(req.user.role, 'VIEW_MONTHLY_APPOINTMENTS_COUNT')) {
      // RF-32: solo cantidades por día de SUS citas.
      const { rows } = await db.query(
        `SELECT fecha,
                count(*) FILTER (WHERE estado = 'Cumplida')::int AS cumplidas,
                count(*) FILTER (WHERE estado = 'Ausente'
                  OR (estado IN ('Pendiente', 'Confirmado') AND (fecha + hora) < (now() AT TIME ZONE 'America/Bogota')))::int AS no_cumplidas,
                count(*) FILTER (WHERE estado IN ('Pendiente', 'Confirmado')
                  AND (fecha + hora) >= (now() AT TIME ZONE 'America/Bogota'))::int AS programadas
         FROM citas
         WHERE colaborador_id = $1 AND estado <> 'Aplazado'
           AND fecha >= make_date($2, $3, 1) AND fecha < (make_date($2, $3, 1) + interval '1 month')::date
         GROUP BY fecha ORDER BY fecha`,
        [req.user.id, anio, mes],
      );
      out.citasPorDia = rows.map((r) => ({ fecha: r.fecha, cumplidas: r.cumplidas, noCumplidas: r.no_cumplidas, programadas: r.programadas }));
    }
    if (hasPermission(req.user.role, 'VIEW_RECURRENCE_RATE')) {
      out.recurrencia = { tasa: recurrencia.tasa, nivel: recurrencia.nivel };
    }
    return out;
  }),
);
