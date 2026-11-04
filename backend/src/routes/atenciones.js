import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { badRequest, requireFound } from '../lib/errors.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';
import { valorConDescuento } from '../services/metrics.js';
import { cedulaField, findPacienteByCedula, insertPaciente, mapPaciente, pacienteDatosSchema, usoConvenioCumpleanos } from './pacientes.js';
import { canSeeCost } from './catalog.js';

// Registro de servicios realizados (atenciones).
export const atencionesRouter = Router();
export const serviciosRealizadosRouter = Router();

const fechaField = z.iso.date('Fecha inválida');
const idParam = z.object({ id: z.uuid('Identificador inválido') });

// "Otros": valor manual explícito con justificación obligatoria.
const otrosSchema = z.object({
  valor: z.coerce.number().min(0, 'No puede ser negativo').max(999_999_999.99),
  motivo: z.string().trim().min(5, 'Explique el motivo del valor manual (mín. 5 caracteres)').max(300),
});

const itemSchema = z.object({
  servicioId: z.uuid('Seleccione un servicio'),
  colaboradorId: z.uuid('Seleccione el colaborador'),
  convenioId: z.uuid().nullable().optional(),
  otros: otrosSchema.nullable().optional(),
});

const atencionSchema = z.object({
  cedula: cedulaField,
  paciente: pacienteDatosSchema.optional(),
  fecha: fechaField.optional(),
  items: z.array(itemSchema).min(1, 'Agregue al menos un servicio').max(20),
});

/**
 * Calcula valores en el servidor (nunca se confía en el cliente):
 * valor_cobrado = valor público con descuento del convenio para la categoría,
 * salvo "Otros" (valor manual justificado). costo_aplicado y puntos se toman
 * del catálogo y quedan congelados.
 * El convenio Cumpleaños tiene un solo porcentaje para todas las categorías.
 */
async function computeItem(item) {
  const s = (await db.query('SELECT * FROM servicios WHERE id = $1', [item.servicioId])).rows[0];
  if (!s || s.status !== 'active') throw badRequest('El servicio no existe o está inactivo', 'INVALID_SERVICIO');

  let descuento = 0;
  if (item.convenioId) {
    const c = (await db.query('SELECT * FROM convenios WHERE id = $1', [item.convenioId])).rows[0];
    if (!c || c.status !== 'active') throw badRequest('El convenio no existe o está inactivo', 'INVALID_CONVENIO');
    const pcts = c.porcentaje_descuento_categoria ?? {};
    descuento = c.tipo === 'cumpleanos' ? Math.max(0, ...Object.values(pcts).map(Number)) : Number(pcts[s.categoria_id] ?? 0);
  }

  const valorLista = Number(s.valor_publico);
  const manual = Boolean(item.otros);
  return {
    servicioId: s.id,
    colaboradorId: item.colaboradorId,
    convenioId: item.convenioId ?? null,
    valorLista,
    descuentoPct: manual ? 0 : descuento,
    valorCobrado: manual ? Math.round(item.otros.valor * 100) / 100 : valorConDescuento(valorLista, descuento),
    costoAplicado: Number(s.costo_clinica),
    puntos: s.puntos,
    valorManual: manual,
    motivoValorManual: manual ? item.otros.motivo : null,
  };
}

// Convenio Cumpleaños: solo en el mes de cumpleaños y en un único día de ese mes
// (ese día se puede registrar más de una vez). Un servicio anulado libera el uso.
async function assertConvenioCumpleanos({ pacienteId, fechaNacimiento, fecha, excluirId }) {
  if (fechaNacimiento?.slice(5, 7) !== fecha.slice(5, 7)) {
    throw badRequest('El convenio Cumpleaños solo se puede aplicar en el mes de cumpleaños del paciente', 'CUMPLEANOS_FUERA_DE_MES');
  }
  const usadoEn = await usoConvenioCumpleanos(pacienteId, fecha, excluirId);
  if (usadoEn && usadoEn !== fecha) {
    throw badRequest(`El paciente ya usó el convenio Cumpleaños este mes (${usadoEn})`, 'CUMPLEANOS_YA_USADO');
  }
}

const convenioCumpleanosId = async () => (await db.query("SELECT id FROM convenios WHERE tipo = 'cumpleanos'")).rows[0]?.id;

const SR_SELECT = `SELECT sr.*, s.nombre AS servicio_nombre, u.full_name AS colaborador_nombre,
    cv.nombre AS convenio_nombre, p.cedula, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
    ur.full_name AS registrado_por
  FROM servicios_realizados sr
  JOIN servicios s ON s.id = sr.servicio_id
  JOIN users u ON u.id = sr.colaborador_id
  JOIN users ur ON ur.id = sr.usuario_registro_id
  JOIN pacientes p ON p.id = sr.paciente_id
  LEFT JOIN convenios cv ON cv.id = sr.convenio_id`;

const mapSR = (r) => ({
  id: r.id,
  fecha: r.fecha,
  paciente: { id: r.paciente_id, cedula: r.cedula, nombre: `${r.paciente_nombre} ${r.paciente_apellido}` },
  servicioId: r.servicio_id,
  servicio: r.servicio_nombre,
  colaboradorId: r.colaborador_id,
  colaborador: r.colaborador_nombre,
  convenioId: r.convenio_id,
  convenio: r.convenio_nombre,
  valorLista: Number(r.valor_lista),
  descuentoPct: Number(r.descuento_pct),
  valorCobrado: Number(r.valor_cobrado),
  costoAplicado: Number(r.costo_aplicado),
  puntos: r.puntos,
  valorManual: r.valor_manual,
  motivoValorManual: r.motivo_valor_manual,
  estado: r.estado,
  motivoAnulacion: r.motivo_anulacion,
  registradoPor: r.registrado_por,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
// Respuesta según el rol: sin costo para la clínica si no administra el catálogo.
const srFor = (user) => (r) => {
  const s = mapSR(r);
  if (!canSeeCost(user)) delete s.costoAplicado;
  return s;
};

const findSR = async (id) => (await db.query(`${SR_SELECT} WHERE sr.id = $1`, [id])).rows[0];

// POST /api/atenciones — RF-08: cédula primero. Si existe, los datos
// personales enviados se ignoran (no se modifican desde este formulario).
atencionesRouter.post(
  '/',
  requirePermission('REGISTER_SERVICES'),
  txRoute(
    async (req, res) => {
      const data = parse(atencionSchema, req.body ?? {});
      let paciente = await findPacienteByCedula(data.cedula);
      const nuevo = !paciente;
      if (nuevo) {
        if (!data.paciente) throw badRequest('Complete los datos del paciente nuevo', 'PATIENT_DATA_REQUIRED');
        paciente = await insertPaciente(req.user.organizationId, data.cedula, data.paciente);
      }

      const fecha = data.fecha ?? (await db.query('SELECT app_today()::text AS d')).rows[0].d;
      // El convenio Cumpleaños cubre toda la cuenta: si un servicio lo lleva, se
      // aplica a todos los de la atención (salvo los de valor manual).
      const cumpleanosId = await convenioCumpleanosId();
      const conCumpleanos = data.items.some((i) => i.convenioId && i.convenioId === cumpleanosId);
      if (conCumpleanos) await assertConvenioCumpleanos({ pacienteId: paciente.id, fechaNacimiento: paciente.fecha_nacimiento, fecha });
      const items = conCumpleanos ? data.items.map((i) => (i.otros ? i : { ...i, convenioId: cumpleanosId })) : data.items;

      const ids = [];
      for (const item of items) {
        const v = await computeItem(item);
        const { rows } = await db.query(
          `INSERT INTO servicios_realizados (organization_id, paciente_id, servicio_id, colaborador_id, fecha, convenio_id,
             valor_lista, descuento_pct, valor_cobrado, costo_aplicado, puntos, valor_manual, motivo_valor_manual, usuario_registro_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [
            req.user.organizationId,
            paciente.id,
            v.servicioId,
            v.colaboradorId,
            fecha,
            v.convenioId,
            v.valorLista,
            v.descuentoPct,
            v.valorCobrado,
            v.costoAplicado,
            v.puntos,
            v.valorManual,
            v.motivoValorManual,
            req.user.id,
          ],
        );
        ids.push(rows[0].id);
      }

      res.locals.status = 201;
      res.locals.audit = {
        entityId: paciente.id,
        metadata: { pacienteNuevo: nuevo, serviciosRealizados: ids, valoresManuales: data.items.filter((i) => i.otros).length },
      };
      const registrados = await db.query(`${SR_SELECT} WHERE sr.id = ANY($1::uuid[])`, [ids]);
      return { pacienteNuevo: nuevo, paciente: mapPaciente(paciente), servicios: registrados.rows.map(srFor(req.user)) };
    },
    { audit: 'ATENCION_REGISTERED', entityType: 'paciente' },
  ),
);

// ---------------------------------------------------------------------------
// /api/servicios-realizados
// ---------------------------------------------------------------------------
const listQuery = z.object({
  desde: fechaField.optional(),
  hasta: fechaField.optional(),
  colaboradorId: z.uuid().optional(),
  estado: z.enum(['registrado', 'anulado', 'all']).default('registrado'),
});

serviciosRealizadosRouter.get(
  '/',
  requirePermission('REGISTER_SERVICES'),
  txRoute(async (req) => {
    const q = parse(listQuery, req.query);
    const { rows } = await db.query(
      `${SR_SELECT}
       WHERE ($1::date IS NULL OR sr.fecha >= $1) AND ($2::date IS NULL OR sr.fecha <= $2)
         AND ($3::uuid IS NULL OR sr.colaborador_id = $3) AND ($4 = 'all' OR sr.estado = $4)
       ORDER BY sr.fecha DESC, sr.created_at DESC
       LIMIT 300`,
      [q.desde ?? null, q.hasta ?? null, q.colaboradorId ?? null, q.estado],
    );
    return { servicios: rows.map(srFor(req.user)) };
  }),
);

serviciosRealizadosRouter.get(
  '/:id/historial',
  requirePermission('REGISTER_SERVICES'),
  txRoute(async (req) => {
    const { id } = parse(idParam, req.params);
    requireFound(await findSR(id));
    const { rows } = await db.query(
      `SELECT h.id, h.operacion, h.datos, h.created_at, u.full_name AS usuario
       FROM servicios_realizados_historial h LEFT JOIN users u ON u.id = h.usuario_id
       WHERE h.servicio_realizado_id = $1 ORDER BY h.id`,
      [id],
    );
    return {
      historial: rows.map((h) => ({
        id: Number(h.id),
        operacion: h.operacion,
        usuario: h.usuario,
        fecha: h.created_at,
        valorCobrado: Number(h.datos.valor_cobrado),
        servicioId: h.datos.servicio_id,
        colaboradorId: h.datos.colaborador_id,
        convenioId: h.datos.convenio_id,
        fechaServicio: h.datos.fecha,
        estado: h.datos.estado,
        valorManual: h.datos.valor_manual,
      })),
    };
  }),
);

const editSchema = itemSchema.extend({ fecha: fechaField });

serviciosRealizadosRouter.put(
  '/:id',
  requirePermission('REGISTER_SERVICES'),
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const data = parse(editSchema, req.body ?? {});
      const prev = mapSR(requireFound(await findSR(id)));
      if (prev.estado === 'anulado') throw badRequest('Un servicio anulado no se puede modificar');
      if (data.convenioId && data.convenioId === (await convenioCumpleanosId())) {
        const { fecha_nacimiento: fechaNacimiento } = (await db.query('SELECT fecha_nacimiento FROM pacientes WHERE id = $1', [prev.paciente.id])).rows[0];
        await assertConvenioCumpleanos({ pacienteId: prev.paciente.id, fechaNacimiento, fecha: data.fecha, excluirId: id });
      }
      const v = await computeItem(data);
      await db.query(
        `UPDATE servicios_realizados SET servicio_id = $1, colaborador_id = $2, convenio_id = $3, fecha = $4,
           valor_lista = $5, descuento_pct = $6, valor_cobrado = $7, costo_aplicado = $8, puntos = $9,
           valor_manual = $10, motivo_valor_manual = $11
         WHERE id = $12`,
        [v.servicioId, v.colaboradorId, v.convenioId, data.fecha, v.valorLista, v.descuentoPct, v.valorCobrado, v.costoAplicado, v.puntos, v.valorManual, v.motivoValorManual, id],
      );
      const { servicioId, colaboradorId, convenioId, fecha, valorCobrado } = prev;
      res.locals.audit = { metadata: { before: { servicioId, colaboradorId, convenioId, fecha, valorCobrado }, after: { ...data, valorCobrado: v.valorCobrado } } };
      return { servicio: srFor(req.user)(await findSR(id)) };
    },
    { audit: 'SERVICIO_REALIZADO_UPDATED', entityType: 'servicio_realizado' },
  ),
);

// Anulación lógica (no hay borrado): solo administradores del catálogo.
serviciosRealizadosRouter.patch(
  '/:id/anular',
  requirePermission('MANAGE_SERVICES'),
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const { motivo } = parse(z.object({ motivo: z.string().trim().min(5, 'Indique el motivo (mín. 5 caracteres)').max(300) }), req.body ?? {});
      const prev = requireFound(await findSR(id));
      if (prev.estado === 'anulado') throw badRequest('El servicio ya está anulado');
      await db.query("UPDATE servicios_realizados SET estado = 'anulado', motivo_anulacion = $1 WHERE id = $2", [motivo, id]);
      res.locals.audit = { metadata: { motivo, valorCobrado: Number(prev.valor_cobrado) } };
      return { servicio: srFor(req.user)(await findSR(id)) };
    },
    { audit: 'SERVICIO_REALIZADO_ANULADO', entityType: 'servicio_realizado' },
  ),
);
