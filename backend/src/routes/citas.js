import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { badRequest, forbidden, requireFound } from '../lib/errors.js';
import { hasPermission } from '../lib/permissions.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';

export const citasRouter = Router();
export const cierresRouter = Router();

// Horario de agenda: slots de 30 min de 07:00 a 18:30 (última cita).
export const AGENDA = { inicio: 7 * 60, fin: 19 * 60, slot: 30 };
export const SLOTS = Array.from({ length: (AGENDA.fin - AGENDA.inicio) / AGENDA.slot }, (_, i) => {
  const m = AGENDA.inicio + i * AGENDA.slot;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

const fechaField = z.iso.date('Fecha inválida');
const horaField = z.string().refine((h) => SLOTS.includes(h), 'Hora fuera del horario de agenda (07:00 a 18:30, cada 30 min)');
const idParam = z.object({ id: z.uuid('Identificador inválido') });

const slotSchema = z.object({
  fecha: fechaField,
  hora: horaField,
  servicioId: z.uuid().nullable().optional(),
  colaboradorId: z.uuid().nullable().optional(),
});

// Alerta visual: amarillo = faltan 2 días, naranja = mañana u hoy, rojo = vencida sin cumplir.
const ALERTA_SQL = `CASE
    WHEN c.estado IN ('Pendiente', 'Confirmado') AND (c.fecha + c.hora) < (now() AT TIME ZONE 'America/Bogota') THEN 'rojo'
    WHEN c.estado IN ('Pendiente', 'Confirmado') AND c.fecha - app_today() <= 1 THEN 'naranja'
    WHEN c.estado IN ('Pendiente', 'Confirmado') AND c.fecha - app_today() = 2 THEN 'amarillo'
  END`;

const CITA_SELECT = `SELECT c.*, to_char(c.hora, 'HH24:MI') AS hora_txt, ${ALERTA_SQL} AS alerta,
    p.cedula, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido, p.telefono,
    s.nombre AS servicio_nombre, u.full_name AS colaborador_nombre,
    EXISTS (SELECT 1 FROM cierres_ausencia ca WHERE ca.cita_id = c.id) AS cerrada
  FROM citas c
  JOIN pacientes p ON p.id = c.paciente_id
  LEFT JOIN servicios s ON s.id = c.servicio_id
  LEFT JOIN users u ON u.id = c.colaborador_id`;

const mapCita = (r) => ({
  id: r.id,
  fecha: r.fecha,
  hora: r.hora_txt,
  estado: r.estado,
  tipo: r.tipo,
  resultado: r.resultado,
  alerta: r.alerta,
  citaOrigenId: r.cita_origen_id,
  paciente: { id: r.paciente_id, cedula: r.cedula, nombre: `${r.paciente_nombre} ${r.paciente_apellido}`, telefono: r.telefono },
  servicioId: r.servicio_id,
  servicio: r.servicio_nombre,
  colaboradorId: r.colaborador_id,
  colaborador: r.colaborador_nombre,
  cierreRegistrado: r.cerrada,
});

const findCita = async (id) => (await db.query(`${CITA_SELECT} WHERE c.id = $1`, [id])).rows[0];

async function createCita(user, { pacienteId, fecha, hora, servicioId = null, colaboradorId = null, tipo = 'normal', origenId = null }) {
  const p = (await db.query('SELECT id FROM pacientes WHERE id = $1', [pacienteId])).rows[0];
  if (!p) throw badRequest('Paciente no encontrado', 'INVALID_PACIENTE');
  if (servicioId) {
    const s = (await db.query('SELECT status FROM servicios WHERE id = $1', [servicioId])).rows[0];
    if (!s || s.status !== 'active') throw badRequest('El servicio no existe o está inactivo', 'INVALID_SERVICIO');
  }
  const { rows } = await db.query(
    `INSERT INTO citas (organization_id, paciente_id, fecha, hora, servicio_id, colaborador_id, tipo, cita_origen_id, usuario_id)
     VALUES ($1, $2, $3, $4::time, $5, $6, $7, $8, $9) RETURNING id`,
    [user.organizationId, pacienteId, fecha, hora, servicioId, colaboradorId, tipo, origenId, user.id],
  );
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------
citasRouter.use(requirePermission('MANAGE_APPOINTMENTS'));

const listQuery = z.object({
  desde: fechaField,
  hasta: fechaField,
  estado: z.enum(['Pendiente', 'Confirmado', 'Aplazado', 'Cumplida', 'Ausente']).optional(),
});

citasRouter.get(
  '/',
  txRoute(async (req) => {
    const q = parse(listQuery, req.query);
    const { rows } = await db.query(
      `${CITA_SELECT}
       WHERE c.fecha >= $1 AND c.fecha <= $2 AND ($3::text IS NULL OR c.estado = $3)
       ORDER BY c.fecha, c.hora
       LIMIT 1000`,
      [q.desde, q.hasta, q.estado ?? null],
    );
    return { citas: rows.map(mapCita) };
  }),
);

// Citas con alerta (vencidas sin cumplir y próximas 2 días), para el panel de avisos.
citasRouter.get(
  '/alertas',
  txRoute(async () => {
    const { rows } = await db.query(
      `SELECT * FROM (${CITA_SELECT} WHERE c.estado IN ('Pendiente', 'Confirmado') AND c.fecha <= app_today() + 2) t
       WHERE t.alerta IS NOT NULL ORDER BY t.fecha, t.hora LIMIT 200`,
    );
    return { citas: rows.map(mapCita) };
  }),
);

citasRouter.get(
  '/disponibilidad',
  txRoute(async (req) => {
    const { fecha } = parse(z.object({ fecha: fechaField }), req.query);
    const { rows } = await db.query(
      `SELECT to_char(hora, 'HH24:MI') AS hora,
              (fecha + hora) < (now() AT TIME ZONE 'America/Bogota') AS pasada
       FROM citas WHERE fecha = $1 AND estado <> 'Aplazado'`,
      [fecha],
    );
    const ocupados = new Set(rows.map((r) => r.hora));
    const { rows: nowRows } = await db.query(
      "SELECT to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS hoy, to_char(now() AT TIME ZONE 'America/Bogota', 'HH24:MI') AS ahora",
    );
    const { hoy, ahora } = nowRows[0];
    return {
      fecha,
      slots: SLOTS.map((h) => ({
        hora: h,
        ocupado: ocupados.has(h),
        pasado: fecha < hoy || (fecha === hoy && h <= ahora),
      })),
    };
  }),
);

citasRouter.get(
  '/:id',
  txRoute(async (req) => ({ cita: mapCita(requireFound(await findCita(parse(idParam, req.params).id))) })),
);

citasRouter.post(
  '/',
  txRoute(
    async (req, res) => {
      const d = parse(slotSchema.extend({ pacienteId: z.uuid('Seleccione el paciente') }), req.body ?? {});
      const id = await createCita(req.user, d);
      res.locals.status = 201;
      res.locals.audit = { entityId: id, metadata: { fecha: d.fecha, hora: d.hora } };
      return { cita: mapCita(await findCita(id)) };
    },
    { audit: 'CITA_CREATED', entityType: 'cita' },
  ),
);

const estadoSchema = z.object({
  estado: z.enum(['Confirmado', 'Cumplida', 'Ausente']),
  resultado: z.string().trim().max(1000).optional(),
  // Cita de control opcional al finalizar la atención (solo con estado Cumplida).
  control: slotSchema.nullable().optional(),
});

citasRouter.patch(
  '/:id/estado',
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const d = parse(estadoSchema, req.body ?? {});
      const cita = requireFound(await findCita(id));
      if (d.control && d.estado !== 'Cumplida') throw badRequest('La cita de control solo se agenda al cumplir la cita');

      await db.query('UPDATE citas SET estado = $1, resultado = coalesce($2, resultado) WHERE id = $3', [d.estado, d.resultado ?? null, id]);

      let controlId = null;
      if (d.control) {
        controlId = await createCita(req.user, {
          ...d.control,
          pacienteId: cita.paciente_id,
          servicioId: d.control.servicioId ?? cita.servicio_id,
          colaboradorId: d.control.colaboradorId ?? cita.colaborador_id,
          tipo: 'control',
          origenId: id,
        });
      }
      res.locals.audit = { metadata: { from: cita.estado, to: d.estado, citaControlId: controlId } };
      return { cita: mapCita(await findCita(id)), control: controlId ? mapCita(await findCita(controlId)) : null };
    },
    { audit: 'CITA_STATUS_CHANGED', entityType: 'cita' },
  ),
);

// Aplazar: la cita queda "Aplazado" (libera el slot) y se crea la nueva.
citasRouter.post(
  '/:id/aplazar',
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const d = parse(slotSchema, req.body ?? {});
      const cita = requireFound(await findCita(id));
      if (!['Pendiente', 'Confirmado'].includes(cita.estado)) throw badRequest(`La cita ya fue cerrada (${cita.estado})`);
      await db.query("UPDATE citas SET estado = 'Aplazado' WHERE id = $1", [id]);
      const nuevaId = await createCita(req.user, {
        ...d,
        pacienteId: cita.paciente_id,
        servicioId: d.servicioId ?? cita.servicio_id,
        colaboradorId: d.colaboradorId ?? cita.colaborador_id,
        tipo: 'reagendada',
        origenId: id,
      });
      res.locals.audit = { metadata: { nuevaCitaId: nuevaId, fecha: d.fecha, hora: d.hora } };
      return { cita: mapCita(await findCita(id)), nueva: mapCita(await findCita(nuevaId)) };
    },
    { audit: 'CITA_APLAZADA', entityType: 'cita' },
  ),
);

// ---------------------------------------------------------------------------
// Cierres de inasistencia
// ---------------------------------------------------------------------------
cierresRouter.use(requirePermission('CLOSE_ABSENCES'));

export const MOTIVOS_AUSENCIA = ['Imprevisto', 'Falta de dinero', 'Tiempo', 'No recordaba', 'Otros'];
export const CANALES_CONTACTO = ['Llamada', 'WhatsApp', 'SMS', 'Correo electrónico', 'Presencial'];

cierresRouter.get(
  '/pendientes',
  txRoute(async () => {
    const { rows } = await db.query(
      `${CITA_SELECT}
       WHERE c.estado = 'Ausente' AND NOT EXISTS (SELECT 1 FROM cierres_ausencia ca WHERE ca.cita_id = c.id)
       ORDER BY c.fecha DESC, c.hora DESC LIMIT 300`,
    );
    return { citas: rows.map(mapCita) };
  }),
);

cierresRouter.get(
  '/',
  txRoute(async () => {
    const { rows } = await db.query(
      `SELECT ca.*, c.fecha AS cita_fecha, to_char(c.hora, 'HH24:MI') AS cita_hora,
              p.nombre || ' ' || p.apellido AS paciente, u.full_name AS usuario,
              n.fecha AS nueva_fecha, to_char(n.hora, 'HH24:MI') AS nueva_hora
       FROM cierres_ausencia ca
       JOIN citas c ON c.id = ca.cita_id
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN users u ON u.id = ca.usuario_id
       LEFT JOIN citas n ON n.id = ca.cita_reagendada_id
       ORDER BY ca.fecha DESC LIMIT 300`,
    );
    return {
      cierres: rows.map((r) => ({
        id: r.id,
        citaId: r.cita_id,
        citaFecha: r.cita_fecha,
        citaHora: r.cita_hora,
        paciente: r.paciente,
        motivo: r.motivo,
        observacion: r.observacion,
        canalContacto: r.canal_contacto,
        fecha: r.fecha,
        usuario: r.usuario,
        reagendo: r.reagendo,
        nuevaCita: r.reagendo ? { fecha: r.nueva_fecha, hora: r.nueva_hora } : null,
      })),
    };
  }),
);

const cierreSchema = z
  .object({
    citaId: z.uuid('Cita inválida'),
    motivo: z.enum(MOTIVOS_AUSENCIA, { message: 'Seleccione el motivo' }),
    observacion: z.string().trim().max(1000).optional(),
    canalContacto: z.enum(CANALES_CONTACTO, { message: 'Seleccione el canal de contacto' }),
    reagendar: slotSchema.nullable().optional(),
  })
  .refine((d) => d.motivo !== 'Otros' || (d.observacion?.length ?? 0) >= 3, {
    message: 'Describa el motivo en la observación',
    path: ['observacion'],
  });

cierresRouter.post(
  '/',
  txRoute(
    async (req, res) => {
      const d = parse(cierreSchema, req.body ?? {});
      const cita = requireFound(await findCita(d.citaId));
      if (cita.estado !== 'Ausente') throw badRequest('Solo se cierran citas marcadas como Ausente');

      let nuevaId = null;
      if (d.reagendar) {
        if (!hasPermission(req.user.role, 'MANAGE_APPOINTMENTS')) throw forbidden();
        nuevaId = await createCita(req.user, {
          ...d.reagendar,
          pacienteId: cita.paciente_id,
          servicioId: d.reagendar.servicioId ?? cita.servicio_id,
          colaboradorId: d.reagendar.colaboradorId ?? cita.colaborador_id,
          tipo: 'reagendada',
          origenId: cita.id,
        });
      }
      const { rows } = await db.query(
        `INSERT INTO cierres_ausencia (organization_id, cita_id, motivo, observacion, canal_contacto, usuario_id, reagendo, cita_reagendada_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.user.organizationId, cita.id, d.motivo, d.observacion || null, d.canalContacto, req.user.id, Boolean(nuevaId), nuevaId],
      );
      res.locals.status = 201;
      res.locals.audit = { entityId: rows[0].id, metadata: { citaId: cita.id, motivo: d.motivo, reagendo: Boolean(nuevaId) } };
      return { id: rows[0].id, nuevaCita: nuevaId ? mapCita(await findCita(nuevaId)) : null };
    },
    { audit: 'AUSENCIA_CERRADA', entityType: 'cierre_ausencia' },
  ),
);
