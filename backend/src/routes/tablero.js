import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { parse, txRoute } from '../lib/txRoute.js';
import { requirePermission } from '../middleware/authorize.js';
import { monthBounds, porcentaje, todayParts } from '../services/metrics.js';
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

// Rangos de edad de las métricas. La edad es la que el paciente cumple en el año
// consultado, así cada paciente queda en un solo rango todo el año.
const RANGOS_EDAD = [
  ['0 a 12', 0, 12],
  ['13 a 17', 13, 17],
  ['18 a 29', 18, 29],
  ['30 a 44', 30, 44],
  ['45 a 59', 45, 59],
  ['60 o más', 60, Infinity],
];
const SIN_DATO = 'Sin dato';
const grupoVacio = (grupo) => ({ grupo, pacientes: 0, servicios: 0, ingreso: 0 });
const sumarEn = (mapa, grupo, fila) => {
  const g = mapa.get(grupo);
  g.pacientes += 1;
  g.servicios += fila.servicios;
  g.ingreso += Number(fila.ingreso);
};
const listaGrupos = (mapa) => [...mapa.values()].map((g) => ({ ...g, ingreso: money(g.ingreso) }));

// Métricas de un año: servicios y resultado por mes, y quiénes usan los servicios
// (género y edad). Solo cuenta servicios no anulados.
tableroRouter.get(
  '/metricas',
  requirePermission('VIEW_DASHBOARD_FINANCE'),
  txRoute(async (req) => {
    const { anio } = parse(z.object({ anio: z.coerce.number().int().min(2020).max(2100).default(todayParts().anio) }), req.query);
    const desde = `${anio}-01-01`;
    const hasta = `${anio + 1}-01-01`;

    const { rows: porMes } = await db.query(
      `SELECT m.mes, count(sr.id)::int AS servicios, count(DISTINCT sr.paciente_id)::int AS pacientes,
              coalesce(sum(sr.valor_cobrado), 0) AS ingreso, coalesce(sum(sr.costo_aplicado), 0) AS costo
       FROM generate_series(1, 12) AS m(mes)
       LEFT JOIN servicios_realizados sr ON sr.estado = 'registrado' AND sr.fecha >= $1::date AND sr.fecha < $2::date
         AND extract(month FROM sr.fecha) = m.mes
       GROUP BY m.mes ORDER BY m.mes`,
      [desde, hasta],
    );
    const meses = porMes.map((r) => ({
      mes: r.mes,
      servicios: r.servicios,
      pacientes: r.pacientes,
      ingreso: money(r.ingreso),
      costo: money(r.costo),
      utilidad: money(r.ingreso - r.costo),
    }));

    const { rows: porPaciente } = await db.query(
      `SELECT p.genero, $3::int - extract(year FROM p.fecha_nacimiento)::int AS edad,
              count(*)::int AS servicios, sum(sr.valor_cobrado) AS ingreso
       FROM servicios_realizados sr JOIN pacientes p ON p.id = sr.paciente_id
       WHERE sr.estado = 'registrado' AND sr.fecha >= $1::date AND sr.fecha < $2::date
       GROUP BY p.id, p.genero, p.fecha_nacimiento`,
      [desde, hasta, anio],
    );
    const generos = new Map(['F', 'M', SIN_DATO].map((g) => [g, grupoVacio(g)]));
    const edades = new Map([...RANGOS_EDAD.map(([r]) => r), SIN_DATO].map((r) => [r, grupoVacio(r)]));
    for (const fila of porPaciente) {
      sumarEn(generos, fila.genero ?? SIN_DATO, fila);
      const rango = fila.edad == null ? null : RANGOS_EDAD.find(([, min, max]) => fila.edad >= min && fila.edad <= max);
      sumarEn(edades, rango?.[0] ?? SIN_DATO, fila);
    }

    const sinCosto = (
      await db.query(
        `SELECT count(*)::int AS n FROM servicios_realizados
         WHERE estado = 'registrado' AND costo_aplicado = 0 AND fecha >= $1::date AND fecha < $2::date`,
        [desde, hasta],
      )
    ).rows[0].n;

    return { anio, meses, pacientes: porPaciente.length, generos: listaGrupos(generos), edades: listaGrupos(edades), serviciosSinCosto: sinCosto };
  }),
);

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
