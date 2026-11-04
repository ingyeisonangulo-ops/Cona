// SOLO DESARROLLO: carga datos FICTICIOS de demostración para pruebas locales.
// Requiere haber ejecutado migrate y seed. Se ejecuta como dueño del esquema.
// Es idempotente: si ya hay pacientes de demostración (cédula 90000xxxxx), no hace nada.
//
//   npm run seed:demo
//
// Genera (determinista): 3 colaboradores extra, catálogo ampliado, ~70 pacientes,
// atenciones desde hace dos meses hasta hoy, citas pasadas/hoy/futuras (con
// alertas), inasistencias (cerradas y pendientes), metas y configuración de
// recurrencia.
import pg from 'pg';
import { pgSslFromEnv } from './_env.js';
import { hashPassword } from '../src/security/password.js';
import { valorConDescuento } from '../src/services/metrics.js';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed:demo] Prohibido en producción.');
  process.exit(1);
}

// ---------------------------------------------------------------- utilidades
let state = 20261101;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const weighted = (pairs) => {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let x = rand() * total;
  for (const [v, w] of pairs) if ((x -= w) < 0) return v;
  return pairs.at(-1)[0];
};

const tz = 'America/Bogota';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const nowHM = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isSunday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;
const SLOTS = Array.from({ length: 24 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const [ty, tm] = today.split('-').map(Number);
const monthStart = (offset) => {
  const idx = ty * 12 + (tm - 1) + offset;
  return { anio: Math.floor(idx / 12), mes: (idx % 12) + 1, desde: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01` };
};
const M2 = monthStart(-2);
const M1 = monthStart(-1);
const M0 = monthStart(0);
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

// Slots ocupados por fecha (una cita por horario).
const usedSlots = new Map();
function takeSlot(fecha, { after = null, before = null } = {}) {
  const used = usedSlots.get(fecha) ?? new Set();
  const free = SLOTS.filter((s) => !used.has(s) && (!after || s > after) && (!before || s < before));
  if (!free.length) return null;
  const s = pick(free);
  used.add(s);
  usedSlots.set(fecha, used);
  return s;
}

// ------------------------------------------------------------- datos base
const NOMBRES_F = ['María', 'Yuliana', 'Luz Dary', 'Ana Milena', 'Yesica', 'Rosa', 'Daniela', 'Karen', 'Nidia', 'Leidy', 'Carmen', 'Valentina', 'Sandra', 'Marleny', 'Luisa'];
const NOMBRES_M = ['Jhon', 'Carlos', 'Wilmer', 'Andrés', 'Jairo', 'Luis', 'Duvan', 'Fredy', 'Óscar', 'Brayan', 'Hernán', 'Edwin', 'Julián', 'Néstor', 'Santiago'];
const APELLIDOS = ['Riascos', 'Valencia', 'Caicedo', 'Mosquera', 'Angulo', 'Castillo', 'Cortés', 'Hurtado', 'Montaño', 'Quiñones', 'Obregón', 'Rentería', 'Banguera', 'Arboleda', 'Solís', 'Grueso', 'Micolta', 'Torres', 'Possú', 'Asprilla'];
const MEDIOS = [['Redes Sociales', 45], ['Referido', 30], ['Televisión', 10], ['Otro', 15]];

const COLABORADORES_EXTRA = [
  ['lucia.ruiz', 'Dra. Lucía Ruiz Valencia', 'Especialista'],
  ['andres.mena', 'Dr. Andrés Mena Caicedo', 'Odontólogo'],
  ['yesenia.caicedo', 'Yesenia Caicedo', 'Higienista'],
];

const CATALOGO_EXTRA = {
  Endodoncia: [
    ['Endodoncia unirradicular', 450000, 140000, 60],
    ['Endodoncia multirradicular', 750000, 230000, 90],
  ],
  'Cirugía Oral': [
    ['Exodoncia simple', 120000, 40000, 20],
    ['Exodoncia de cordal', 380000, 120000, 50],
  ],
  Periodoncia: [['Curetaje por cuadrante', 260000, 80000, 30]],
};

// Frecuencia relativa de cada servicio (los económicos son más comunes).
const PESO_SERVICIO = {
  'Consulta de valoración': 30,
  'Profilaxis y detartraje': 22,
  'Resina dental': 25,
  'Control de ortodoncia': 14,
  'Instalación de brackets': 3,
  'Blanqueamiento dental': 4,
  'Endodoncia unirradicular': 5,
  'Endodoncia multirradicular': 3,
  'Exodoncia simple': 8,
  'Exodoncia de cordal': 3,
  'Curetaje por cuadrante': 6,
};

const MOTIVOS = ['Imprevisto', 'Falta de dinero', 'Tiempo', 'No recordaba', 'Otros'];
const CANALES = ['Llamada', 'WhatsApp', 'WhatsApp', 'Llamada', 'WhatsApp'];

// ---------------------------------------------------------------- principal
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
const client =new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, ssl: pgSslFromEnv() });
await client.connect();
const q = (sql, params) => client.query(sql, params);

try {
  const org = (await q("SELECT id FROM organizations WHERE slug = 'nuevo-amanecer-pacifico'")).rows[0]?.id;
  if (!org) throw new Error('Ejecute primero "npm run seed".');
  const ya = (await q("SELECT count(*)::int AS n FROM pacientes WHERE cedula LIKE '90000%'")).rows[0].n;
  if (ya > 0) {
    console.log(`[seed:demo] Ya hay ${ya} pacientes de demostración. Nada que hacer.`);
    process.exit(0);
  }
  const domain = process.env.SEED_DEV_EMAIL_DOMAIN?.trim() || 'nuevoamanecer.test';
  const devPassword = process.env.SEED_DEV_PASSWORD?.trim();
  if (!devPassword) throw new Error('Defina SEED_DEV_PASSWORD en backend/.env');

  await q('BEGIN');
  const user = async (email) => (await q('SELECT id FROM users WHERE email = $1', [email])).rows[0]?.id;
  const asistente = await user(`asistente@${domain}`);
  const gerente = await user(`gerente@${domain}`);
  if (!asistente || !gerente) throw new Error('Faltan los usuarios de prueba del seed de desarrollo.');

  // Colaboradores
  const passwordHash = await hashPassword(devPassword);
  // Los servicios de la demo conservan todos los cargos (valor por defecto), así
  // cualquier colaborador puede atender las visitas generadas al azar.
  for (const [local, nombre, cargo] of COLABORADORES_EXTRA) {
    await q(
      `INSERT INTO users (organization_id, email, full_name, role, cargo, password_hash)
       VALUES ($1, $2, $3, 'Colaborador', $4, $5) ON CONFLICT (email) DO NOTHING`,
      [org, `${local}@${domain}`, nombre, cargo, passwordHash],
    );
  }
  const colaboradores = (await q("SELECT id, full_name FROM users WHERE organization_id = $1 AND role = 'Colaborador' AND is_active ORDER BY created_at", [org])).rows;
  const pesoColab = colaboradores.map((c, i) => [c.id, [35, 30, 20, 15][i] ?? 10]);

  // Catálogo ampliado
  for (const [cat, servicios] of Object.entries(CATALOGO_EXTRA)) {
    const c = (
      await q(
        `INSERT INTO categorias (organization_id, nombre, created_by, updated_by) VALUES ($1, $2, $3, $3)
         ON CONFLICT (organization_id, lower(nombre)) DO UPDATE SET nombre = categorias.nombre RETURNING id`,
        [org, cat, gerente],
      )
    ).rows[0].id;
    for (const [nombre, valor, costo, puntos] of servicios) {
      await q(
        `INSERT INTO servicios (organization_id, categoria_id, nombre, valor_publico, costo_clinica, puntos, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (organization_id, lower(nombre)) DO NOTHING`,
        [org, c, nombre, valor, costo, puntos, gerente],
      );
    }
  }
  const servicios = (await q("SELECT * FROM servicios WHERE organization_id = $1 AND status = 'active'", [org])).rows;
  const pesoServicio = servicios.map((s) => [s, PESO_SERVICIO[s.nombre] ?? 5]);
  const catId = Object.fromEntries((await q('SELECT nombre, id FROM categorias WHERE organization_id = $1', [org])).rows.map((r) => [r.nombre, r.id]));

  // Convenios
  await q(
    `INSERT INTO convenios (organization_id, nombre, entidad, porcentaje_descuento_categoria, created_by, updated_by) VALUES
       ($1, 'Cooperativa del Pacífico', 'Coopacífico (entidad ficticia)', $2::jsonb, $4, $4),
       ($1, 'Empleados Portuarios', 'Sociedad Portuaria Demo (ficticia)', $3::jsonb, $4, $4)
     ON CONFLICT (organization_id, lower(nombre)) DO NOTHING`,
    [
      org,
      JSON.stringify({ [catId['Odontología General']]: 15, [catId.Endodoncia]: 10 }),
      JSON.stringify(Object.fromEntries(Object.values(catId).map((id) => [id, 8]))),
      gerente,
    ],
  );
  const convenios = (await q("SELECT * FROM convenios WHERE organization_id = $1 AND status = 'active'", [org])).rows;

  // Recurrencia
  await q(
    `INSERT INTO configuracion_recurrencia (organization_id, puntos_nivel_60, puntos_nivel_80, updated_by) VALUES ($1, 15, 30, $2)
     ON CONFLICT (organization_id) DO UPDATE SET puntos_nivel_60 = 15, puntos_nivel_80 = 30`,
    [org, gerente],
  );

  // Las citas pasadas no se pueden crear por la API (regla de negocio); para la
  // demostración se desactiva temporalmente esa validación dentro de la transacción.
  await q('ALTER TABLE citas DISABLE TRIGGER citas_guard');

  // ------------------------------------------------------------ pacientes
  const diasHabiles = (desde, hasta) => {
    const out = [];
    for (let d = desde; d <= hasta; d = addDays(d, 1)) if (!isSunday(d)) out.push(d);
    return out;
  };
  const diasM2 = diasHabiles(M2.desde, addDays(M1.desde, -1));
  const diasM1 = diasHabiles(M1.desde, addDays(M0.desde, -1)).filter((d) => d < today);
  const diasM0 = diasHabiles(M0.desde, today).filter((d) => d < today);

  const stats = { pacientes: 0, servicios: 0, citas: 0, ausencias: 0, cierres: 0 };
  const produccion = new Map(); // `${colab}|${anio}-${mes}` -> { puntos, dinero }
  const visitasHoy = [];

  async function registrarVisita(pacienteId, fecha, colaboradorId, hora, estadoCita = 'Cumplida') {
    const servicioCita = weighted(pesoServicio);
    const citaId = (
      await q(
        `INSERT INTO citas (organization_id, paciente_id, servicio_id, colaborador_id, fecha, hora, estado, resultado, usuario_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::time, $7, $8, $9, $9, $9) RETURNING id`,
        [org, pacienteId, servicioCita.id, colaboradorId, fecha, hora, estadoCita, estadoCita === 'Cumplida' ? 'Atención realizada sin novedad.' : null, asistente],
      )
    ).rows[0].id;
    stats.citas++;
    if (estadoCita !== 'Cumplida') return citaId;

    const items = [servicioCita, ...(chance(0.3) ? [weighted(pesoServicio)] : [])];
    const convenio = chance(0.25) ? pick(convenios) : null;
    for (const s of items) {
      const manual = chance(0.03);
      const pct = convenio ? Number(convenio.porcentaje_descuento_categoria?.[s.categoria_id] ?? 0) : 0;
      const lista = Number(s.valor_publico);
      const cobrado = manual ? Math.round((lista * 0.7) / 1000) * 1000 : valorConDescuento(lista, pct);
      await q(
        `INSERT INTO servicios_realizados (organization_id, paciente_id, servicio_id, colaborador_id, fecha, convenio_id,
           valor_lista, descuento_pct, valor_cobrado, costo_aplicado, puntos, valor_manual, motivo_valor_manual,
           usuario_registro_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $14)`,
        [org, pacienteId, s.id, colaboradorId, fecha, manual ? null : convenio?.id ?? null, lista, manual ? 0 : pct, cobrado, s.costo_clinica, s.puntos, manual, manual ? 'Tarifa social autorizada por gerencia' : null, asistente],
      );
      stats.servicios++;
      const key = `${colaboradorId}|${fecha.slice(0, 7)}`;
      const p = produccion.get(key) ?? { puntos: 0, dinero: 0 };
      p.puntos += s.puntos;
      p.dinero += cobrado;
      produccion.set(key, p);
    }
    return citaId;
  }

  const pacientes = [];
  for (let i = 0; i < 72; i++) {
    const femenino = chance(0.55);
    const primera = i < 40 ? pick(diasM2) : pick(diasM1.length ? diasM1 : diasM2);
    const p = (
      await q(
        `INSERT INTO pacientes (organization_id, cedula, nombre, apellido, telefono, fecha_registro, medio_origen, fecha_nacimiento, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $9, $8, $8) RETURNING id, fecha_registro`,
        [
          org,
          `90000${String(10000 + i * 137).padStart(5, '0')}`,
          pick(femenino ? NOMBRES_F : NOMBRES_M),
          `${pick(APELLIDOS)} ${pick(APELLIDOS)}`,
          `3${pick(['00', '01', '04', '05', '10', '12', '14', '15', '17', '20'])}${String(Math.floor(rand() * 1e7)).padStart(7, '0')}`,
          primera,
          weighted(MEDIOS),
          asistente,
          `${1955 + Math.floor(rand() * 60)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
        ],
      )
    ).rows[0];
    pacientes.push({ ...p, colaborador: weighted(pesoColab) });
    stats.pacientes++;
  }

  // ------------------------------------------------------ visitas pasadas
  for (const p of pacientes) {
    const fechas = [p.fecha_registro];
    const delMesAnteAnterior = p.fecha_registro < M1.desde;
    // ~85% de los pacientes del mes M-2 vuelven en M-1 (recurrencia ≥ 60% tras inasistencias).
    if (delMesAnteAnterior && chance(0.85) && diasM1.length) fechas.push(pick(diasM1));
    if (!delMesAnteAnterior && chance(0.35) && diasM1.length) {
      const posteriores = diasM1.filter((d) => d > p.fecha_registro);
      if (posteriores.length) fechas.push(pick(posteriores));
    }
    if (diasM0.length && chance(0.4)) fechas.push(pick(diasM0));

    for (const fecha of fechas) {
      const hora = takeSlot(fecha);
      if (!hora) continue;
      const colab = chance(0.8) ? p.colaborador : weighted(pesoColab);
      if (chance(0.16)) {
        // Inasistencia
        const citaId = await registrarVisita(p.id, fecha, colab, hora, 'Ausente');
        stats.ausencias++;
        if (daysBetween(fecha, today) > 3 && chance(0.75)) {
          // ~25% de los seguimientos no logran comunicación con el paciente.
          const responde = chance(0.75);
          let reagendada = null;
          if (responde && chance(0.5)) {
            const nueva = addDays(today, 1 + Math.floor(rand() * 10));
            const h = takeSlot(nueva);
            if (h && !isSunday(nueva)) {
              reagendada = (
                await q(
                  `INSERT INTO citas (organization_id, paciente_id, colaborador_id, fecha, hora, estado, tipo, cita_origen_id, usuario_id, created_by, updated_by)
                   VALUES ($1, $2, $3, $4, $5::time, 'Pendiente', 'reagendada', $6, $7, $7, $7) RETURNING id`,
                  [org, p.id, colab, nueva, h, citaId, asistente],
                )
              ).rows[0].id;
              stats.citas++;
            }
          }
          const motivo = responde ? pick(MOTIVOS) : null;
          const observacion = !responde
            ? 'No contesta; se dejó mensaje.'
            : motivo === 'Otros'
              ? 'Viajó fuera de la ciudad.'
              : 'Se contactó al paciente.';
          await q(
            `INSERT INTO cierres_ausencia (organization_id, cita_id, respuesta, motivo, observacion, canal_contacto, usuario_id, reagendo, cita_reagendada_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [org, citaId, responde ? 'Responde' : 'No responde', motivo, observacion, pick(CANALES), asistente, Boolean(reagendada), reagendada],
          );
          stats.cierres++;
        }
      } else {
        await registrarVisita(p.id, fecha, colab, hora);
      }
    }
  }

  // ------------------------------------------------------------- hoy
  // Antes de la hora actual: cumplidas y alguna vencida (alerta roja);
  // después: confirmadas/pendientes (alerta naranja).
  for (const p of pacientes.slice(0, 10)) {
    const antes = takeSlot(today, { before: nowHM });
    if (antes) {
      if (chance(0.7)) visitasHoy.push(await registrarVisita(p.id, today, p.colaborador, antes));
      else await registrarVisita(p.id, today, p.colaborador, antes, chance(0.5) ? 'Pendiente' : 'Confirmado');
    }
  }
  for (const p of pacientes.slice(10, 16)) {
    const despues = takeSlot(today, { after: nowHM });
    if (despues) await registrarVisita(p.id, today, p.colaborador, despues, chance(0.5) ? 'Confirmado' : 'Pendiente');
  }

  // ----------------------------------------------------- próximos 14 días
  for (let d = 1; d <= 14; d++) {
    const fecha = addDays(today, d);
    if (isSunday(fecha)) continue;
    const n = d <= 2 ? 6 : 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const p = pick(pacientes);
      const hora = takeSlot(fecha);
      if (!hora) break;
      const control = chance(0.2);
      const origen = control ? (await q("SELECT id FROM citas WHERE paciente_id = $1 AND estado = 'Cumplida' LIMIT 1", [p.id])).rows[0]?.id : null;
      await q(
        `INSERT INTO citas (organization_id, paciente_id, servicio_id, colaborador_id, fecha, hora, estado, tipo, cita_origen_id, usuario_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::time, $7, $8, $9, $10, $10, $10)`,
        [org, p.id, weighted(pesoServicio).id, p.colaborador, fecha, hora, chance(0.4) ? 'Confirmado' : 'Pendiente', origen ? 'control' : 'normal', origen, asistente],
      );
      stats.citas++;
    }
  }

  await q('ALTER TABLE citas ENABLE TRIGGER citas_guard');

  // ---------------------------------------------------------------- metas
  // Metas cercanas a la producción real para que unos cumplan y otros no.
  for (const c of colaboradores) {
    for (const [i, M] of [M2, M1, M0].entries()) {
      // El mes en curso apenas empieza: su meta se calcula con la producción del mes anterior.
      const refMes = (i === 2 ? M1 : M).desde.slice(0, 7);
      const ref = produccion.get(`${c.id}|${refMes}`) ?? { puntos: 200, dinero: 3_000_000 };
      const factor = i === 2 ? 1 : pick([0.8, 0.9, 1.05, 1.2]);
      const metaPuntos = Math.max(50, Math.round((ref.puntos * factor) / 10) * 10);
      const metaDinero = Math.max(500_000, Math.round((ref.dinero * factor) / 100_000) * 100_000);
      await q(
        `INSERT INTO metas_colaborador (organization_id, colaborador_id, anio, mes, meta_puntos, meta_dinero, valor_punto_adicional, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (organization_id, colaborador_id, anio, mes) DO NOTHING`,
        [org, c.id, M.anio, M.mes, metaPuntos, metaDinero, pick([1500, 2000, 2500, 3000]), gerente],
      );
    }
  }

  await q("SELECT app_audit_log('SEED_DEMO_LOADED', $1, NULL, NULL, NULL, NULL, 'seed-demo', $2)", [org, JSON.stringify(stats)]);
  await q('COMMIT');

  console.log('[seed:demo] Datos ficticios cargados:');
  console.log(`  ${colaboradores.length} colaboradores · ${stats.pacientes} pacientes · ${stats.servicios} servicios realizados`);
  console.log(`  ${stats.citas} citas (${stats.ausencias} inasistencias, ${stats.cierres} cerradas) · metas de ${M2.mes}/${M2.anio} a ${M0.mes}/${M0.anio}`);
} catch (err) {
  await q('ROLLBACK').catch(() => {});
  console.error(`[seed:demo] ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
