import { db } from '../db.js';
import {
  bonoRecurrencia,
  comision,
  monthBounds,
  nivelRecurrencia,
  porcentaje,
  propuestaSemanal,
  tasaRecurrencia,
  weekOfDay,
} from './metrics.js';

export async function loadRecurrencia(anio, mes) {
  const { rows } = await db.query('SELECT * FROM app_recurrence_rate($1, $2)', [anio, mes]);
  const { base = 0, retornan = 0 } = rows[0] ?? {};
  const cfg = (await db.query('SELECT puntos_nivel_60, puntos_nivel_80 FROM configuracion_recurrencia')).rows[0];
  const config = { puntosNivel60: cfg?.puntos_nivel_60 ?? 0, puntosNivel80: cfg?.puntos_nivel_80 ?? 0 };
  const tasa = tasaRecurrencia(base, retornan);
  return { base, retornan, tasa, nivel: nivelRecurrencia(tasa), bonoPuntos: bonoRecurrencia(tasa, config), config };
}

/**
 * Desempeño mensual por colaborador. Con colaboradorId se limita a uno; la RLS
 * además restringe a un Colaborador a sus propias filas.
 *
 * Puntos totales = puntos de servicios registrados + bono de recurrencia (este
 * último solo para colaboradores con meta asignada en el mes).
 */
export async function desempenoColaboradores({ anio, mes, colaboradorId = null, recurrencia }) {
  const { desde, hasta } = monthBounds(anio, mes);

  const colaboradores = colaboradorId
    ? (await db.query('SELECT id, full_name, cargo FROM users WHERE id = $1', [colaboradorId])).rows
    : (await db.query("SELECT id, full_name, cargo FROM users WHERE role IN ('Colaborador', 'Asistente') AND is_active ORDER BY full_name")).rows;

  const prod = await db.query(
    `SELECT colaborador_id, extract(day FROM fecha)::int AS dia,
            sum(puntos)::int AS puntos, sum(valor_cobrado) AS dinero, count(*)::int AS servicios
     FROM servicios_realizados
     WHERE estado = 'registrado' AND fecha >= $1 AND fecha < $2 AND ($3::uuid IS NULL OR colaborador_id = $3)
     GROUP BY 1, 2`,
    [desde, hasta, colaboradorId],
  );
  const metas = await db.query(
    `SELECT colaborador_id, meta_puntos, meta_dinero, valor_punto_adicional, distribucion_semanal
     FROM metas_colaborador WHERE anio = $1 AND mes = $2 AND ($3::uuid IS NULL OR colaborador_id = $3)`,
    [anio, mes, colaboradorId],
  );
  const metaBy = new Map(metas.rows.map((m) => [m.colaborador_id, m]));

  // Incluye colaboradores inactivos que tengan producción en el mes.
  const known = new Set(colaboradores.map((c) => c.id));
  const missing = [...new Set(prod.rows.map((r) => r.colaborador_id))].filter((id) => !known.has(id));
  if (missing.length) {
    const extra = await db.query('SELECT id, full_name, cargo FROM users WHERE id = ANY($1::uuid[])', [missing]);
    colaboradores.push(...extra.rows);
  }

  return colaboradores.map((c) => {
    const semanas = [0, 0, 0, 0].map(() => ({ puntos: 0, dinero: 0 }));
    let servicios = 0;
    for (const r of prod.rows.filter((p) => p.colaborador_id === c.id)) {
      const w = semanas[weekOfDay(r.dia) - 1];
      w.puntos += r.puntos;
      w.dinero += Number(r.dinero);
      servicios += r.servicios;
    }
    const m = metaBy.get(c.id);
    const meta = m
      ? {
          puntos: m.meta_puntos,
          dinero: Number(m.meta_dinero),
          valorPuntoAdicional: Number(m.valor_punto_adicional),
          semanasPuntos: m.distribucion_semanal ?? propuestaSemanal(m.meta_puntos, anio, mes),
          semanasDinero: propuestaSemanal(Math.round(Number(m.meta_dinero)), anio, mes),
          ajustada: Boolean(m.distribucion_semanal),
        }
      : null;

    const puntosServicios = semanas.reduce((a, w) => a + w.puntos, 0);
    const dinero = Math.round(semanas.reduce((a, w) => a + w.dinero, 0) * 100) / 100;
    const bono = meta ? (recurrencia?.bonoPuntos ?? 0) : 0;
    const puntosTotales = puntosServicios + bono;

    return {
      colaboradorId: c.id,
      nombre: c.full_name,
      cargo: c.cargo ?? null,
      servicios,
      puntosServicios,
      bonoRecurrencia: bono,
      puntosTotales,
      dinero,
      meta,
      faltantes: meta ? Math.max(0, meta.puntos - puntosTotales) : null,
      cumplimientoPuntos: meta ? porcentaje(puntosTotales, meta.puntos) : null,
      cumplimientoDinero: meta ? porcentaje(dinero, meta.dinero) : null,
      cumpleMeta: meta ? puntosTotales >= meta.puntos : false,
      comision: meta ? comision(puntosTotales, meta.puntos, meta.valorPuntoAdicional) : 0,
      semanas: semanas.map((w, i) => ({
        semana: i + 1,
        puntos: w.puntos,
        dinero: Math.round(w.dinero * 100) / 100,
        propuestaPuntos: meta?.semanasPuntos[i] ?? null,
        propuestaDinero: meta?.semanasDinero[i] ?? null,
      })),
    };
  });
}
