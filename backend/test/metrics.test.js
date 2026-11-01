import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bonoRecurrencia,
  comision,
  daysInMonth,
  monthBounds,
  propuestaSemanal,
  tasaRecurrencia,
  valorConDescuento,
  weekOfDay,
} from '../src/services/metrics.js';

test('semanas: días 29-31 se suman a la semana 4', () => {
  assert.deepEqual([1, 7, 8, 14, 15, 21, 22, 28, 29, 30, 31].map(weekOfDay), [1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4]);
});

test('propuesta semanal proporcional que suma la meta exacta', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.deepEqual(propuestaSemanal(400, 2026, 2), [100, 100, 100, 100]);
  const enero = propuestaSemanal(310, 2026, 1); // 31 días
  assert.deepEqual(enero, [70, 70, 70, 100]);
  for (const meta of [1, 7, 99, 1000, 1234]) {
    for (const mes of [1, 2, 4]) assert.equal(propuestaSemanal(meta, 2026, mes).reduce((a, b) => a + b), meta);
  }
});

test('comisión solo si cumple la meta en puntos', () => {
  assert.equal(comision(99, 100, 5000), 0);
  assert.equal(comision(100, 100, 5000), 0);
  assert.equal(comision(130, 100, 5000), 150000);
  assert.equal(comision(130, 0, 5000), 0);
});

test('recurrencia: niveles 60% y 80% no acumulativos', () => {
  const cfg = { puntosNivel60: 10, puntosNivel80: 25 };
  assert.equal(tasaRecurrencia(0, 0), 0);
  assert.equal(tasaRecurrencia(10, 6), 60);
  assert.equal(bonoRecurrencia(59.99, cfg), 0);
  assert.equal(bonoRecurrencia(60, cfg), 10);
  assert.equal(bonoRecurrencia(79.9, cfg), 10);
  assert.equal(bonoRecurrencia(80, cfg), 25);
  assert.equal(bonoRecurrencia(100, null), 0);
});

test('descuento de convenio y límites de mes', () => {
  assert.equal(valorConDescuento(120000, 10), 108000);
  assert.equal(valorConDescuento(99999.99, 0), 99999.99);
  assert.equal(valorConDescuento(150000, 100), 0);
  assert.deepEqual(monthBounds(2026, 12), { desde: '2026-12-01', hasta: '2027-01-01' });
});
