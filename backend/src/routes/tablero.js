import { Router } from 'express';
import { db } from '../db.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';
import { monthBounds, porcentaje } from '../services/metrics.js';
import { desempenoColaboradores, loadRecurrencia } from '../services/performance.js';
import { periodoSchema } from './colaboradores.js';

// Tablero Gerencial & BI — solo VIEW_DASHBOARD_FINANCE (Super Admin y Gerente).
export const tableroRouter = Router();

const money = (v) => Math.round(Number(v ?? 0) * 100) / 100;

// Top/bottom N por utilidad (sin solaparse cuando hay pocos servicios).
function clasificar(servicios) {
  const ordenados = [...servicios].sort((a, b) => b.utilidad - a.utilidad);
  const n = Math.min(3, Math.floor(ordenados.length / 2));
  const top = new Set(ordenados.slice(0, n).map((s) => s.servicioId));
  const bottom = new Set(ordenados.slice(ordenados.length - n).map((s) => s.servicioId));
  return servicios.map((s) => ({
    ...s,
    clasificacion: top.has(s.servicioId) ? 'mas_rentable' : bottom.has(s.servicioId) ? 'menos_rentable' : null,
  }));
}

tableroRouter.get(
  '/',
  requirePermission('VIEW_DASHBOARD_FINANCE'),
  txRoute(async (req) => {
    const { anio, mes } = parse(periodoSchema(), req.query);
    const { desde, hasta } = monthBounds(anio, mes);

    const k = (
      await db.query(
        `SELECT coalesce(sum(valor_cobrado), 0) AS ingreso, coalesce(sum(costo_aplicado), 0) AS costo,
                count(*)::int AS servicios, count(DISTINCT paciente_id)::int AS pacientes_atendidos
         FROM servicios_realizados WHERE estado = 'registrado' AND fecha >= $1 AND fecha < $2`,
        [desde, hasta],
      )
    ).rows[0];
    const citas = (
      await db.query(
        `SELECT count(*) FILTER (WHERE estado <> 'Aplazado')::int AS agendadas,
                count(*) FILTER (WHERE estado = 'Cumplida')::int AS cumplidas,
                count(*) FILTER (WHERE estado = 'Ausente')::int AS ausentes,
                count(*) FILTER (WHERE estado IN ('Pendiente', 'Confirmado'))::int AS pendientes
         FROM citas WHERE fecha >= $1 AND fecha < $2`,
        [desde, hasta],
      )
    ).rows[0];
    const nuevos = (await db.query('SELECT count(*)::int AS n FROM pacientes WHERE fecha_registro >= $1 AND fecha_registro < $2', [desde, hasta])).rows[0].n;

    const ingreso = money(k.ingreso);
    const costo = money(k.costo);
    const utilidad = money(ingreso - costo);

    // Serie diaria del mes (gráfica de área) y mes anterior (variación de los KPI).
    const diaria = (
      await db.query(
        `SELECT d::date::text AS fecha,
                coalesce(sum(sr.valor_cobrado), 0) AS ingreso, coalesce(sum(sr.costo_aplicado), 0) AS costo,
                count(sr.id)::int AS servicios
         FROM generate_series($1::date, ($2::date - 1), interval '1 day') d
         LEFT JOIN servicios_realizados sr ON sr.fecha = d::date AND sr.estado = 'registrado'
         GROUP BY d ORDER BY d`,
        [desde, hasta],
      )
    ).rows.map((r) => ({ fecha: r.fecha, ingreso: money(r.ingreso), costo: money(r.costo), servicios: r.servicios }));
    const prev = monthBounds(mes === 1 ? anio - 1 : anio, mes === 1 ? 12 : mes - 1);
    const kp = (
      await db.query(
        `SELECT coalesce(sum(valor_cobrado), 0) AS ingreso, coalesce(sum(costo_aplicado), 0) AS costo, count(*)::int AS servicios,
                (SELECT count(*)::int FROM pacientes WHERE fecha_registro >= $1 AND fecha_registro < $2) AS nuevos
         FROM servicios_realizados WHERE estado = 'registrado' AND fecha >= $1 AND fecha < $2`,
        [prev.desde, prev.hasta],
      )
    ).rows[0];
    const anterior = {
      ingresoTotal: money(kp.ingreso),
      costoTotal: money(kp.costo),
      utilidadNeta: money(kp.ingreso - kp.costo),
      serviciosRealizados: kp.servicios,
      pacientesNuevos: kp.nuevos,
    };

    const servicios = (
      await db.query(
        `SELECT s.id, s.nombre, c.nombre AS categoria, count(*)::int AS cantidad,
                sum(sr.valor_cobrado) AS ingreso, sum(sr.costo_aplicado) AS costo
         FROM servicios_realizados sr
         JOIN servicios s ON s.id = sr.servicio_id
         JOIN categorias c ON c.id = s.categoria_id
         WHERE sr.estado = 'registrado' AND sr.fecha >= $1 AND sr.fecha < $2
         GROUP BY s.id, s.nombre, c.nombre
         ORDER BY cantidad DESC, s.nombre`,
        [desde, hasta],
      )
    ).rows.map((r) => {
      const ing = money(r.ingreso);
      const cos = money(r.costo);
      return {
        servicioId: r.id,
        nombre: r.nombre,
        categoria: r.categoria,
        cantidad: r.cantidad,
        ingreso: ing,
        costo: cos,
        utilidad: money(ing - cos),
        margen: porcentaje(ing - cos, ing),
      };
    });

    const convenios = (
      await db.query(
        `SELECT cv.id, cv.nombre, cv.entidad, count(*)::int AS usos,
                sum(sr.valor_cobrado) AS ingreso, sum(sr.valor_lista - sr.valor_cobrado) AS descuento
         FROM servicios_realizados sr JOIN convenios cv ON cv.id = sr.convenio_id
         WHERE sr.estado = 'registrado' AND sr.fecha >= $1 AND sr.fecha < $2 AND NOT sr.valor_manual
         GROUP BY cv.id, cv.nombre, cv.entidad
         ORDER BY usos DESC, cv.nombre`,
        [desde, hasta],
      )
    ).rows.map((r) => ({ convenioId: r.id, nombre: r.nombre, entidad: r.entidad, usos: r.usos, ingreso: money(r.ingreso), descuento: money(r.descuento) }));

    const canales = (
      await db.query(
        `SELECT medio_origen, count(*)::int AS pacientes FROM pacientes
         WHERE fecha_registro >= $1 AND fecha_registro < $2 GROUP BY medio_origen ORDER BY pacientes DESC`,
        [desde, hasta],
      )
    ).rows.map((r) => ({ medioOrigen: r.medio_origen, pacientes: r.pacientes, porcentaje: porcentaje(r.pacientes, nuevos) }));

    const recurrencia = await loadRecurrencia(anio, mes);
    const colaboradores = await desempenoColaboradores({ anio, mes, recurrencia });

    return {
      anio,
      mes,
      kpis: {
        ingresoTotal: ingreso,
        costoTotal: costo,
        utilidadNeta: utilidad,
        margen: porcentaje(utilidad, ingreso),
        serviciosRealizados: k.servicios,
        pacientesAtendidos: k.pacientes_atendidos,
        pacientesNuevos: nuevos,
        citasAgendadas: citas.agendadas,
        citasCumplidas: citas.cumplidas,
        citasAusentes: citas.ausentes,
        citasPendientes: citas.pendientes,
        comisionesTotales: money(colaboradores.reduce((a, c) => a + c.comision, 0)),
      },
      anterior,
      serieDiaria: diaria,
      colaboradores,
      servicios: clasificar(servicios),
      convenios,
      canales,
      recurrencia: {
        base: recurrencia.base,
        retornan: recurrencia.retornan,
        tasa: recurrencia.tasa,
        nivel: recurrencia.nivel,
        bonoPuntos: recurrencia.bonoPuntos,
        config: recurrencia.config,
      },
    };
  }),
);
