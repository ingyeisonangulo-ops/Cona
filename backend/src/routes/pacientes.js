import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireFound } from '../lib/errors.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';

export const pacientesRouter = Router();

export const MEDIOS_ORIGEN = ['Redes Sociales', 'Televisión', 'Referido', 'Otro'];

export const cedulaField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[.\s-]/g, ''))
  .pipe(z.string().regex(/^[0-9A-Z]{4,15}$/, 'Cédula inválida (4 a 15 caracteres alfanuméricos)'));

export const pacienteDatosSchema = z.object({
  nombre: z.string().trim().min(2, 'Nombre muy corto').max(80),
  apellido: z.string().trim().min(2, 'Apellido muy corto').max(80),
  telefono: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/, 'Teléfono inválido'),
  medioOrigen: z.enum(MEDIOS_ORIGEN, { message: 'Seleccione el medio de origen' }),
});

const idParam = z.object({ id: z.uuid('Identificador inválido') });
const searchQuery = z.object({ q: z.string().trim().max(80).default('') });

export const mapPaciente = (r) => ({
  id: r.id,
  cedula: r.cedula,
  nombre: r.nombre,
  apellido: r.apellido,
  telefono: r.telefono,
  fechaRegistro: r.fecha_registro,
  medioOrigen: r.medio_origen,
});

export async function findPacienteByCedula(cedula) {
  return (await db.query('SELECT * FROM pacientes WHERE cedula = $1', [cedula])).rows[0];
}

export async function insertPaciente(organizationId, cedula, datos) {
  const { rows } = await db.query(
    `INSERT INTO pacientes (organization_id, cedula, nombre, apellido, telefono, medio_origen)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [organizationId, cedula, datos.nombre, datos.apellido, datos.telefono, datos.medioOrigen],
  );
  return rows[0];
}

// RF-08: consulta por cédula única (primera casilla del formulario).
pacientesRouter.get(
  '/cedula/:cedula',
  requirePermission('SEARCH_PATIENTS', 'REGISTER_SERVICES', 'MANAGE_APPOINTMENTS'),
  txRoute(async (req) => {
    const { cedula } = parse(z.object({ cedula: cedulaField }), req.params);
    const p = await findPacienteByCedula(cedula);
    return { existe: Boolean(p), paciente: p ? mapPaciente(p) : null };
  }),
);

pacientesRouter.get(
  '/',
  requirePermission('SEARCH_PATIENTS'),
  txRoute(async (req) => {
    const { q } = parse(searchQuery, req.query);
    const term = q.replace(/[.\s-]/g, '').toUpperCase();
    const { rows } = await db.query(
      `SELECT * FROM pacientes
       WHERE $1 = '' OR cedula LIKE $2 || '%' OR (nombre || ' ' || apellido) ILIKE '%' || $1 || '%'
       ORDER BY apellido, nombre
       LIMIT 50`,
      [q, term],
    );
    return { pacientes: rows.map(mapPaciente) };
  }),
);

pacientesRouter.get(
  '/:id',
  requirePermission('SEARCH_PATIENTS'),
  txRoute(async (req) => {
    const { id } = parse(idParam, req.params);
    return { paciente: mapPaciente(requireFound((await db.query('SELECT * FROM pacientes WHERE id = $1', [id])).rows[0])) };
  }),
);

pacientesRouter.get(
  '/:id/historial',
  requirePermission('VIEW_PATIENT_HISTORY'),
  txRoute(async (req) => {
    const { id } = parse(idParam, req.params);
    const p = requireFound((await db.query('SELECT * FROM pacientes WHERE id = $1', [id])).rows[0]);
    const servicios = await db.query(
      `SELECT sr.id, sr.fecha, sr.valor_cobrado, sr.estado, sr.puntos, s.nombre AS servicio,
              u.full_name AS colaborador, cv.nombre AS convenio
       FROM servicios_realizados sr
       JOIN servicios s ON s.id = sr.servicio_id
       JOIN users u ON u.id = sr.colaborador_id
       LEFT JOIN convenios cv ON cv.id = sr.convenio_id
       WHERE sr.paciente_id = $1
       ORDER BY sr.fecha DESC, sr.created_at DESC`,
      [id],
    );
    const citas = await db.query(
      `SELECT c.id, c.fecha, to_char(c.hora, 'HH24:MI') AS hora, c.estado, c.tipo, c.resultado, s.nombre AS servicio
       FROM citas c LEFT JOIN servicios s ON s.id = c.servicio_id
       WHERE c.paciente_id = $1
       ORDER BY c.fecha DESC, c.hora DESC`,
      [id],
    );
    return {
      paciente: mapPaciente(p),
      servicios: servicios.rows.map((r) => ({
        id: r.id,
        fecha: r.fecha,
        servicio: r.servicio,
        colaborador: r.colaborador,
        convenio: r.convenio,
        valorCobrado: Number(r.valor_cobrado),
        estado: r.estado,
      })),
      citas: citas.rows,
    };
  }),
);

pacientesRouter.post(
  '/',
  requirePermission('REGISTER_SERVICES', 'MANAGE_APPOINTMENTS'),
  txRoute(
    async (req, res) => {
      const data = parse(pacienteDatosSchema.extend({ cedula: cedulaField }), req.body ?? {});
      const p = await insertPaciente(req.user.organizationId, data.cedula, data);
      res.locals.status = 201;
      res.locals.audit = { entityId: p.id, metadata: { cedula: p.cedula } };
      return { paciente: mapPaciente(p) };
    },
    { audit: 'PACIENTE_CREATED', entityType: 'paciente' },
  ),
);

// La cédula es inmutable (también en BD). Edición de datos de contacto.
pacientesRouter.put(
  '/:id',
  requirePermission('REGISTER_SERVICES'),
  requirePermission('SEARCH_PATIENTS'),
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const data = parse(pacienteDatosSchema, req.body ?? {});
      const prev = requireFound((await db.query('SELECT * FROM pacientes WHERE id = $1', [id])).rows[0]);
      const { rows } = await db.query(
        'UPDATE pacientes SET nombre = $1, apellido = $2, telefono = $3, medio_origen = $4 WHERE id = $5 RETURNING *',
        [data.nombre, data.apellido, data.telefono, data.medioOrigen, id],
      );
      res.locals.audit = { metadata: { before: mapPaciente(prev), after: data } };
      return { paciente: mapPaciente(rows[0]) };
    },
    { audit: 'PACIENTE_UPDATED', entityType: 'paciente' },
  ),
);
