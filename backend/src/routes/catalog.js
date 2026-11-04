import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { badRequest, requireFound } from '../lib/errors.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';
import { hasPermission } from '../lib/permissions.js';
import { CARGOS } from '../lib/cargos.js';

// Lectura: cualquier rol con acceso a servicios. Escritura: MANAGE_SERVICES
// (Super Admin y Gerente según matrix.json; RLS lo refuerza con app_is_admin()).
const canRead = requirePermission('MANAGE_SERVICES', 'REGISTER_SERVICES', 'VIEW_ROLE_SERVICES');
const canWrite = requirePermission('MANAGE_SERVICES');
// Convenios y cifras en dinero: solo personal administrativo/operativo. El rol
// Colaborador ve el catálogo sin valores monetarios.
const canReadConvenios = requirePermission('MANAGE_SERVICES', 'REGISTER_SERVICES');
const canSeeMoney = (user) => hasPermission(user.role, 'MANAGE_SERVICES') || hasPermission(user.role, 'REGISTER_SERVICES');
// El costo para la clínica solo lo ve quien administra el catálogo (Super Admin y
// Gerente). La Asistente ve el valor al público, no el costo ni el margen.
export const canSeeCost = (user) => hasPermission(user.role, 'MANAGE_SERVICES');
function servicioFor(user, s) {
  if (canSeeCost(user)) return s;
  const { valorPublico, costoClinica: _c, ...rest } = s;
  return canSeeMoney(user) ? { ...rest, valorPublico } : rest;
}

const idParam = z.object({ id: z.uuid('Identificador inválido') });
const statusSchema = z.object({ status: z.enum(['active', 'inactive']) });
const listQuery = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  q: z.string().trim().max(100).optional(),
});
const name = (max) => z.string().trim().min(2, 'Mínimo 2 caracteres').max(max);
const money = z.coerce.number().min(0, 'No puede ser negativo').max(999_999_999_999.99).multipleOf(0.01, 'Máximo 2 decimales');

const toNumber = (v) => (v == null ? null : Number(v));

// ===========================================================================
// Categorías
// ===========================================================================
export const categoriasRouter = Router();
const categoriaSchema = z.object({ nombre: name(120) });

const mapCategoria = (r) => ({
  id: r.id,
  nombre: r.nombre,
  status: r.status,
  serviciosCount: r.servicios_count == null ? undefined : Number(r.servicios_count),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function findCategoria(id) {
  const { rows } = await db.query(
    `SELECT c.*, (SELECT count(*) FROM servicios s WHERE s.categoria_id = c.id) AS servicios_count
     FROM categorias c WHERE c.id = $1`,
    [id],
  );
  return rows[0];
}

categoriasRouter.get(
  '/',
  canRead,
  txRoute(async (req) => {
    const { status, q } = parse(listQuery, req.query);
    const { rows } = await db.query(
      `SELECT c.*, (SELECT count(*) FROM servicios s WHERE s.categoria_id = c.id) AS servicios_count
       FROM categorias c
       WHERE ($1 = 'all' OR c.status = $1) AND ($2::text IS NULL OR c.nombre ILIKE '%' || $2 || '%')
       ORDER BY c.nombre`,
      [status, q || null],
    );
    return { categorias: rows.map(mapCategoria) };
  }),
);

categoriasRouter.get(
  '/:id',
  canRead,
  txRoute(async (req) => ({ categoria: mapCategoria(requireFound(await findCategoria(parse(idParam, req.params).id))) })),
);

categoriasRouter.post(
  '/',
  canWrite,
  txRoute(
    async (req, res) => {
      const data = parse(categoriaSchema, req.body ?? {});
      const { rows } = await db.query('INSERT INTO categorias (organization_id, nombre) VALUES ($1, $2) RETURNING id', [
        req.user.organizationId,
        data.nombre,
      ]);
      res.locals.status = 201;
      res.locals.audit = { entityId: rows[0].id, metadata: data };
      return { categoria: mapCategoria(await findCategoria(rows[0].id)) };
    },
    { audit: 'CATEGORIA_CREATED', entityType: 'categoria' },
  ),
);

categoriasRouter.put(
  '/:id',
  canWrite,
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const data = parse(categoriaSchema, req.body ?? {});
      const prev = requireFound(await findCategoria(id));
      await db.query('UPDATE categorias SET nombre = $1 WHERE id = $2', [data.nombre, id]);
      res.locals.audit = { metadata: { before: { nombre: prev.nombre }, after: data } };
      return { categoria: mapCategoria(await findCategoria(id)) };
    },
    { audit: 'CATEGORIA_UPDATED', entityType: 'categoria' },
  ),
);

categoriasRouter.patch(
  '/:id/status',
  canWrite,
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const { status } = parse(statusSchema, req.body ?? {});
      const prev = requireFound(await findCategoria(id));
      if (status === 'inactive') {
        const { rows } = await db.query("SELECT count(*) AS n FROM servicios WHERE categoria_id = $1 AND status = 'active'", [id]);
        if (Number(rows[0].n) > 0) throw badRequest('Desactive primero los servicios activos de esta categoría', 'HAS_ACTIVE_SERVICES');
      }
      await db.query('UPDATE categorias SET status = $1 WHERE id = $2', [status, id]);
      res.locals.audit = { metadata: { from: prev.status, to: status } };
      return { categoria: mapCategoria(await findCategoria(id)) };
    },
    { audit: 'CATEGORIA_STATUS_CHANGED', entityType: 'categoria' },
  ),
);

// ===========================================================================
// Servicios
// ===========================================================================
export const serviciosRouter = Router();
const servicioSchema = z.object({
  categoriaId: z.uuid('Seleccione una categoría'),
  nombre: name(160),
  valorPublico: money,
  costoClinica: money,
  puntos: z.coerce.number().int('Debe ser entero').min(0).max(1_000_000),
  // Cargos que realizan el servicio (si se omite: todos al crear, sin cambios al editar).
  cargos: z
    .array(z.enum(CARGOS, { message: 'Cargo inválido' }))
    .min(1, 'Seleccione al menos un cargo que realice el servicio')
    .transform((v) => [...new Set(v)])
    .optional(),
});
const servicioListQuery = listQuery.extend({ categoriaId: z.uuid().optional() });

const SERVICIO_SELECT = `SELECT s.*, c.nombre AS categoria_nombre, c.status AS categoria_status
  FROM servicios s JOIN categorias c ON c.id = s.categoria_id`;

const mapServicio = (r) => ({
  id: r.id,
  categoriaId: r.categoria_id,
  categoriaNombre: r.categoria_nombre,
  nombre: r.nombre,
  valorPublico: toNumber(r.valor_publico),
  costoClinica: toNumber(r.costo_clinica),
  puntos: r.puntos,
  cargos: r.cargos,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function findServicio(id) {
  return (await db.query(`${SERVICIO_SELECT} WHERE s.id = $1`, [id])).rows[0];
}

async function requireActiveCategoria(id) {
  const c = await findCategoria(id);
  if (!c || c.status !== 'active') throw badRequest('La categoría no existe o está inactiva', 'INVALID_CATEGORIA');
}

serviciosRouter.get(
  '/',
  canRead,
  txRoute(async (req) => {
    const { status, q, categoriaId } = parse(servicioListQuery, req.query);
    const { rows } = await db.query(
      `${SERVICIO_SELECT}
       WHERE ($1 = 'all' OR s.status = $1)
         AND ($2::text IS NULL OR s.nombre ILIKE '%' || $2 || '%')
         AND ($3::uuid IS NULL OR s.categoria_id = $3)
         AND ($4::text IS NULL OR $4 = ANY (s.cargos))
       ORDER BY c.nombre, s.nombre`,
      // VIEW_ROLE_SERVICES: el Colaborador solo ve los servicios de su cargo.
      [status, q || null, categoriaId ?? null, canSeeMoney(req.user) ? null : (req.user.cargo ?? '')],
    );
    return { servicios: rows.map((r) => servicioFor(req.user, mapServicio(r))) };
  }),
);

serviciosRouter.get(
  '/:id',
  canRead,
  txRoute(async (req) => {
    const s = mapServicio(requireFound(await findServicio(parse(idParam, req.params).id)));
    // Un servicio de otro cargo no existe para el Colaborador (404).
    if (!canSeeMoney(req.user) && !s.cargos.includes(req.user.cargo)) requireFound(null);
    return { servicio: servicioFor(req.user, s) };
  }),
);

serviciosRouter.post(
  '/',
  canWrite,
  txRoute(
    async (req, res) => {
      const d = parse(servicioSchema, req.body ?? {});
      await requireActiveCategoria(d.categoriaId);
      const { rows } = await db.query(
        `INSERT INTO servicios (organization_id, categoria_id, nombre, valor_publico, costo_clinica, puntos, cargos)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::text[], $8::text[])) RETURNING id`,
        [req.user.organizationId, d.categoriaId, d.nombre, d.valorPublico, d.costoClinica, d.puntos, d.cargos ?? null, CARGOS],
      );
      res.locals.status = 201;
      res.locals.audit = { entityId: rows[0].id, metadata: d };
      return { servicio: mapServicio(await findServicio(rows[0].id)) };
    },
    { audit: 'SERVICIO_CREATED', entityType: 'servicio' },
  ),
);

serviciosRouter.put(
  '/:id',
  canWrite,
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const d = parse(servicioSchema, req.body ?? {});
      const prev = mapServicio(requireFound(await findServicio(id)));
      if (d.categoriaId !== prev.categoriaId) await requireActiveCategoria(d.categoriaId);
      await db.query(
        `UPDATE servicios SET categoria_id = $1, nombre = $2, valor_publico = $3, costo_clinica = $4, puntos = $5,
           cargos = coalesce($6::text[], cargos)
         WHERE id = $7`,
        [d.categoriaId, d.nombre, d.valorPublico, d.costoClinica, d.puntos, d.cargos ?? null, id],
      );
      const { categoriaId, nombre, valorPublico, costoClinica, puntos, cargos } = prev;
      res.locals.audit = { metadata: { before: { categoriaId, nombre, valorPublico, costoClinica, puntos, cargos }, after: d } };
      return { servicio: mapServicio(await findServicio(id)) };
    },
    { audit: 'SERVICIO_UPDATED', entityType: 'servicio' },
  ),
);

serviciosRouter.patch(
  '/:id/status',
  canWrite,
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const { status } = parse(statusSchema, req.body ?? {});
      const prev = requireFound(await findServicio(id));
      if (status === 'active' && prev.categoria_status !== 'active') {
        throw badRequest('Active primero la categoría del servicio', 'INACTIVE_CATEGORIA');
      }
      await db.query('UPDATE servicios SET status = $1 WHERE id = $2', [status, id]);
      res.locals.audit = { metadata: { from: prev.status, to: status } };
      return { servicio: mapServicio(await findServicio(id)) };
    },
    { audit: 'SERVICIO_STATUS_CHANGED', entityType: 'servicio' },
  ),
);

// ===========================================================================
// Convenios
// ===========================================================================
export const conveniosRouter = Router();
const descuentos = z
  .record(z.uuid('Categoría inválida'), z.coerce.number().min(0, 'Mínimo 0%').max(100, 'Máximo 100%'))
  .default({});
const convenioSchema = z.object({
  nombre: name(160),
  entidad: name(200),
  porcentajeDescuentoCategoria: descuentos,
});

const mapConvenio = (r) => ({
  id: r.id,
  nombre: r.nombre,
  entidad: r.entidad,
  porcentajeDescuentoCategoria: r.porcentaje_descuento_categoria,
  tipo: r.tipo,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function findConvenio(id) {
  return (await db.query('SELECT * FROM convenios WHERE id = $1', [id])).rows[0];
}

// Todas las categorías del descuento deben existir en la organización (RLS).
async function assertCategorias(map) {
  const ids = Object.keys(map);
  if (!ids.length) return;
  const { rows } = await db.query('SELECT count(*) AS n FROM categorias WHERE id = ANY($1::uuid[])', [ids]);
  if (Number(rows[0].n) !== ids.length) throw badRequest('Alguna categoría del descuento no existe', 'INVALID_CATEGORIA');
}

conveniosRouter.get(
  '/',
  canReadConvenios,
  txRoute(async (req) => {
    const { status, q } = parse(listQuery, req.query);
    const { rows } = await db.query(
      `SELECT * FROM convenios
       WHERE ($1 = 'all' OR status = $1)
         AND ($2::text IS NULL OR nombre ILIKE '%' || $2 || '%' OR entidad ILIKE '%' || $2 || '%')
       ORDER BY nombre`,
      [status, q || null],
    );
    return { convenios: rows.map(mapConvenio) };
  }),
);

conveniosRouter.get(
  '/:id',
  canReadConvenios,
  txRoute(async (req) => ({ convenio: mapConvenio(requireFound(await findConvenio(parse(idParam, req.params).id))) })),
);

conveniosRouter.post(
  '/',
  canWrite,
  txRoute(
    async (req, res) => {
      const d = parse(convenioSchema, req.body ?? {});
      await assertCategorias(d.porcentajeDescuentoCategoria);
      const { rows } = await db.query(
        `INSERT INTO convenios (organization_id, nombre, entidad, porcentaje_descuento_categoria)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
        [req.user.organizationId, d.nombre, d.entidad, JSON.stringify(d.porcentajeDescuentoCategoria)],
      );
      res.locals.status = 201;
      res.locals.audit = { entityId: rows[0].id, metadata: d };
      return { convenio: mapConvenio(await findConvenio(rows[0].id)) };
    },
    { audit: 'CONVENIO_CREATED', entityType: 'convenio' },
  ),
);

conveniosRouter.put(
  '/:id',
  canWrite,
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const d = parse(convenioSchema, req.body ?? {});
      const prev = mapConvenio(requireFound(await findConvenio(id)));
      await assertCategorias(d.porcentajeDescuentoCategoria);
      // El convenio Cumpleaños es del sistema: solo cambia su porcentaje.
      const sistema = prev.tipo === 'cumpleanos';
      await db.query(
        'UPDATE convenios SET nombre = $1, entidad = $2, porcentaje_descuento_categoria = $3::jsonb WHERE id = $4',
        [sistema ? prev.nombre : d.nombre, sistema ? prev.entidad : d.entidad, JSON.stringify(d.porcentajeDescuentoCategoria), id],
      );
      const { nombre, entidad, porcentajeDescuentoCategoria } = prev;
      res.locals.audit = { metadata: { before: { nombre, entidad, porcentajeDescuentoCategoria }, after: d } };
      return { convenio: mapConvenio(await findConvenio(id)) };
    },
    { audit: 'CONVENIO_UPDATED', entityType: 'convenio' },
  ),
);

conveniosRouter.patch(
  '/:id/status',
  canWrite,
  txRoute(
    async (req, res) => {
      const { id } = parse(idParam, req.params);
      const { status } = parse(statusSchema, req.body ?? {});
      const prev = requireFound(await findConvenio(id));
      await db.query('UPDATE convenios SET status = $1 WHERE id = $2', [status, id]);
      res.locals.audit = { metadata: { from: prev.status, to: status } };
      return { convenio: mapConvenio(await findConvenio(id)) };
    },
    { audit: 'CONVENIO_STATUS_CHANGED', entityType: 'convenio' },
  ),
);
