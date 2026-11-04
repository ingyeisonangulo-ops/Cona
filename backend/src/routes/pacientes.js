import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { badRequest, requireFound } from '../lib/errors.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';
import { monthBounds, todayParts } from '../services/metrics.js';

export const pacientesRouter = Router();

export const MEDIOS_ORIGEN = ['Redes Sociales', 'Televisión', 'Referido', 'Otro'];

const fechaHoy = () => {
  const { anio, mes, dia } = todayParts();
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
};

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
  fechaNacimiento: z
    .iso.date('Ingrese la fecha de nacimiento')
    .refine((f) => f >= '1900-01-01' && f <= fechaHoy(), 'La fecha de nacimiento no es válida'),
});

// Editar: la fecha es opcional porque los pacientes antiguos pueden no tenerla.
const pacienteEdicionSchema = pacienteDatosSchema.partial({ fechaNacimiento: true });

const idParam = z.object({ id: z.uuid('Identificador inválido') });
const searchQuery = z.object({ q: z.string().trim().max(80).default('') });

export const mapPaciente = (r) => ({
  id: r.id,
  cedula: r.cedula,
  nombre: r.nombre,
  apellido: r.apellido,
  telefono: r.telefono,
  fechaRegistro: r.fecha_registro,
  fechaNacimiento: r.fecha_nacimiento,
  medioOrigen: r.medio_origen,
});

// Día en que el paciente usó el convenio Cumpleaños en el mes de `fecha` (null si
// no lo ha usado). Un servicio anulado no cuenta. `excluirId`: el servicio en edición.
export async function usoConvenioCumpleanos(pacienteId, fecha, excluirId = null) {
  const { desde, hasta } = monthBounds(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)));
  const { rows } = await db.query(
    `SELECT min(sr.fecha) AS fecha
     FROM servicios_realizados sr JOIN convenios c ON c.id = sr.convenio_id
     WHERE sr.paciente_id = $1 AND c.tipo = 'cumpleanos' AND sr.estado = 'registrado'
       AND sr.fecha >= $2::date AND sr.fecha < $3::date AND ($4::uuid IS NULL OR sr.id <> $4)`,
    [pacienteId, desde, hasta, excluirId],
  );
  return rows[0].fecha;
}

export async function findPacienteByCedula(cedula) {
  return (await db.query('SELECT * FROM pacientes WHERE cedula = $1', [cedula])).rows[0];
}

export async function insertPaciente(organizationId, cedula, datos) {
  const { rows } = await db.query(
    `INSERT INTO pacientes (organization_id, cedula, nombre, apellido, telefono, medio_origen, fecha_nacimiento)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [organizationId, cedula, datos.nombre, datos.apellido, datos.telefono, datos.medioOrigen, datos.fechaNacimiento],
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

// Estado del descuento en el año en curso: el mes de cumpleaños ya pasó, es este o aún no llega.
const estadoDescuento = (aplicado, mes, mesActual) => {
  if (aplicado) return 'Aplicado';
  if (mes < mesActual) return 'Vencido';
  return mes === mesActual ? 'Pendiente' : 'No aplica';
};

// Cumpleañeros de un mes (va antes de '/:id'). Sin datos de contacto.
pacientesRouter.get(
  '/cumpleanos',
  requirePermission('SEARCH_PATIENTS'),
  txRoute(async (req) => {
    const hoy = todayParts();
    const { mes } = parse(z.object({ mes: z.coerce.number().int().min(1).max(12).default(hoy.mes) }), req.query);
    const { desde, hasta } = monthBounds(hoy.anio, mes);
    const { rows } = await db.query(
      `SELECT p.id, p.nombre, p.apellido, extract(day FROM p.fecha_nacimiento)::int AS dia,
              $2::int - extract(year FROM p.fecha_nacimiento)::int AS anios,
              coalesce(f.felicitado, false) AS felicitado,
              EXISTS (SELECT 1 FROM servicios_realizados sr JOIN convenios c ON c.id = sr.convenio_id
                      WHERE sr.paciente_id = p.id AND c.tipo = 'cumpleanos' AND sr.estado = 'registrado'
                        AND sr.fecha >= $3::date AND sr.fecha < $4::date) AS descuento_aplicado
       FROM pacientes p
       LEFT JOIN felicitaciones_cumpleanos f ON f.paciente_id = p.id AND f.anio = $2
       WHERE extract(month FROM p.fecha_nacimiento) = $1
       ORDER BY dia, p.nombre, p.apellido`,
      [mes, hoy.anio, desde, hasta],
    );
    const sinFecha = (await db.query('SELECT count(*)::int AS n FROM pacientes WHERE fecha_nacimiento IS NULL')).rows[0].n;
    return {
      mes,
      anio: hoy.anio,
      cumpleaneros: rows.map((r) => ({
        id: r.id,
        nombre: `${r.nombre} ${r.apellido}`,
        dia: r.dia,
        anios: r.anios,
        felicitado: r.felicitado,
        descuento: estadoDescuento(r.descuento_aplicado, mes, hoy.mes),
      })),
      sinFecha,
    };
  }),
);

// Si el paciente ya usó el convenio Cumpleaños en el mes de la fecha indicada.
pacientesRouter.get(
  '/:id/cumpleanos-uso',
  requirePermission('REGISTER_SERVICES'),
  txRoute(async (req) => {
    const { id } = parse(idParam, req.params);
    const { fecha } = parse(z.object({ fecha: z.iso.date('Fecha inválida') }), req.query);
    requireFound((await db.query('SELECT id FROM pacientes WHERE id = $1', [id])).rows[0]);
    return { usadoEn: await usoConvenioCumpleanos(id, fecha) };
  }),
);

// Marca o desmarca la felicitación del año en curso.
pacientesRouter.patch(
  '/:id/felicitacion',
  requirePermission('SEARCH_PATIENTS'),
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const { felicitado } = parse(z.object({ felicitado: z.boolean() }), req.body ?? {});
      const paciente = requireFound((await db.query('SELECT id, fecha_nacimiento FROM pacientes WHERE id = $1', [id])).rows[0]);
      if (!paciente.fecha_nacimiento) throw badRequest('El paciente no tiene fecha de nacimiento');
      const { anio } = todayParts();
      await db.query(
        `INSERT INTO felicitaciones_cumpleanos (organization_id, paciente_id, anio, felicitado) VALUES ($1, $2, $3, $4)
         ON CONFLICT (paciente_id, anio) DO UPDATE SET felicitado = EXCLUDED.felicitado`,
        [req.user.organizationId, id, anio, felicitado],
      );
      res.locals.audit = { entityId: id, metadata: { anio, felicitado } };
      return { felicitado };
    },
    { audit: 'PACIENTE_FELICITADO', entityType: 'paciente' },
  ),
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
      const data = parse(pacienteEdicionSchema, req.body ?? {});
      const prev = requireFound((await db.query('SELECT * FROM pacientes WHERE id = $1', [id])).rows[0]);
      const { rows } = await db.query(
        `UPDATE pacientes SET nombre = $1, apellido = $2, telefono = $3, medio_origen = $4,
           fecha_nacimiento = coalesce($5, fecha_nacimiento)
         WHERE id = $6 RETURNING *`,
        [data.nombre, data.apellido, data.telefono, data.medioOrigen, data.fechaNacimiento ?? null, id],
      );
      res.locals.audit = { metadata: { before: mapPaciente(prev), after: data } };
      return { paciente: mapPaciente(rows[0]) };
    },
    { audit: 'PACIENTE_UPDATED', entityType: 'paciente' },
  ),
);
