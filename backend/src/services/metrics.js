// Reglas de negocio puras (sin BD): semanas, propuesta de meta, recurrencia y
// comisiones. Cubiertas por test/metrics.test.js.

export const TIME_ZONE = 'America/Bogota';

export function daysInMonth(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

// Semanas fijas del mes: 1-7, 8-14, 15-21 y 22-fin (los días 29-31 caen en la 4).
export function weekOfDay(day) {
  return Math.min(4, Math.ceil(day / 7));
}

export function weekDays(anio, mes) {
  return [7, 7, 7, daysInMonth(anio, mes) - 21];
}

/**
 * Propuesta de distribución de la meta mensual en 4 semanas, proporcional a los
 * días de cada semana. Semanas 1-3 se redondean hacia abajo; el residuo va a
 * la semana 4 (que incluye los días 29-31). Siempre suma la meta exacta.
 */
export function propuestaSemanal(metaPuntos, anio, mes) {
  const total = daysInMonth(anio, mes);
  const [d1, d2, d3] = weekDays(anio, mes);
  const s = [d1, d2, d3].map((d) => Math.floor((metaPuntos * d) / total));
  return [...s, metaPuntos - s[0] - s[1] - s[2]];
}

export function tasaRecurrencia(base, retornan) {
  if (!base) return 0;
  return Math.round((retornan / base) * 10000) / 100;
}

// Nivel alcanzado (no acumulativo): >= 80% otorga el nivel 80; >= 60% el nivel 60.
export function nivelRecurrencia(tasa) {
  if (tasa >= 80) return 80;
  if (tasa >= 60) return 60;
  return 0;
}

export function bonoRecurrencia(tasa, config) {
  const nivel = nivelRecurrencia(tasa);
  if (nivel === 80) return config?.puntosNivel80 ?? 0;
  if (nivel === 60) return config?.puntosNivel60 ?? 0;
  return 0;
}

// Solo hay comisión si se cumple la meta en puntos.
export function comision(puntosLogrados, metaPuntos, valorPuntoAdicional) {
  if (!metaPuntos || puntosLogrados < metaPuntos) return 0;
  return Math.round((puntosLogrados - metaPuntos) * valorPuntoAdicional * 100) / 100;
}

export function porcentaje(valor, meta) {
  if (!meta) return 0;
  return Math.round((valor / meta) * 1000) / 10;
}

// Valor a cobrar aplicando el descuento del convenio para la categoría.
export function valorConDescuento(valorLista, descuentoPct) {
  return Math.round(valorLista * (100 - descuentoPct)) / 100;
}

export function monthBounds(anio, mes) {
  const pad = (n) => String(n).padStart(2, '0');
  const next = mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
  return { desde: `${anio}-${pad(mes)}-01`, hasta: `${next[0]}-${pad(next[1])}-01` };
}

export function todayParts(date = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date).split('-').map(Number);
  return { anio: y, mes: m, dia: d };
}
