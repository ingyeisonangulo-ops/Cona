// Integración de los módulos de negocio (Bloque 2) sobre PGlite.
import { EMAILS, PASSWORDS, startHarness } from '../../scripts/lib/harness.js';

const h = await startHarness({ quiet: true });
const { Client, asOwner, check: ok } = h;
let crashed = false;

const ymd = (d) => d.toISOString().slice(0, 10);
const bogotaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const addDays = (s, n) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
const today = bogotaToday();
const [anio, mes] = today.split('-').map(Number);
const prevMonthDay = ymd(new Date(Date.UTC(anio, mes - 2, 10)));

try {
  const ger = await Client.as(EMAILS.gerente);
  const asi = await Client.as(EMAILS.asistente);
  const col = await Client.as(EMAILS.colaborador);
  const sa = await Client.as(EMAILS.superAdmin, PASSWORDS.superAdmin);

  let r = await asi.req('GET', '/colaboradores');
  const colaboradorId = r.data.colaboradores.find((c) => c.cargo === 'Odontólogo')?.id;
  ok(r.status === 200 && colaboradorId, 'asistente lista colaboradores');
  ok(r.data.colaboradores.some((c) => c.cargo === 'Asistente'), 'la Asistente también aparece como colaboradora');

  const servicios = (await ger.req('GET', '/servicios?status=active')).data.servicios;
  const consulta = servicios.find((s) => s.nombre === 'Consulta de valoración'); // 60.000 / 10 pts, Odontología General
  const resina = servicios.find((s) => s.nombre === 'Resina dental'); // 150.000 / 25 pts
  const convenio = (await ger.req('GET', '/convenios')).data.convenios[0]; // 10% Odontología General

  // ---------------------------------------------------------------- Metas
  r = await ger.req('PUT', '/configuracion/recurrencia', { puntosNivel60: 10, puntosNivel80: 25 });
  ok(r.status === 200 && r.data.configuracion.puntosNivel80 === 25, 'configurar puntos de recurrencia');
  r = await ger.req('PUT', '/configuracion/recurrencia', { puntosNivel60: 30, puntosNivel80: 10 });
  ok(r.status === 400, 'nivel 80 < nivel 60 rechazado');
  r = await ger.req('PUT', '/metas', { colaboradorId, anio, mes, metaPuntos: 40, metaDinero: 300000, valorPuntoAdicional: 2000 });
  ok(r.status === 200, 'asignar meta mensual');
  r = await ger.req('PUT', '/metas', { colaboradorId, anio, mes, metaPuntos: 40, metaDinero: 300000, valorPuntoAdicional: 2000, distribucionSemanal: [10, 10, 10, 5] });
  ok(r.status === 400, 'distribución semanal que no suma la meta → 400');
  r = await ger.req('GET', `/metas?anio=${anio}&mes=${mes}`);
  const metaRow = r.data.metas.find((m) => m.colaboradorId === colaboradorId);
  ok(metaRow?.meta?.propuestaSemanal.reduce((a, b) => a + b) === 40, 'propuesta semanal suma la meta');
  r = await asi.req('PUT', '/metas', { colaboradorId, anio, mes, metaPuntos: 1, metaDinero: 0, valorPuntoAdicional: 0 });
  ok(r.status === 403, 'asistente no asigna metas → 403');

  // ------------------------------------------------- RF-08 y atenciones
  r = await asi.req('GET', '/pacientes/cedula/1.061.234.567');
  ok(r.status === 200 && r.data.existe === false, 'cédula nueva: no existe (normaliza puntos)');
  r = await asi.req('POST', '/atenciones', { cedula: '1061234567', items: [{ servicioId: consulta.id, colaboradorId }] });
  ok(r.status === 400 && r.data.error.code === 'PATIENT_DATA_REQUIRED', 'paciente nuevo exige datos personales');
  r = await asi.req('POST', '/atenciones', {
    cedula: '1061234567',
    paciente: { nombre: 'Ana', apellido: 'Riascos', telefono: '3001234567', medioOrigen: 'Referido', fechaNacimiento: '1990-05-14' },
    items: [
      { servicioId: consulta.id, colaboradorId, convenioId: convenio.id },
      { servicioId: resina.id, colaboradorId, otros: { valor: 99000, motivo: 'Tarifa especial autorizada' } },
    ],
  });
  ok(r.status === 201 && r.data.pacienteNuevo, 'registrar atención con paciente nuevo', JSON.stringify(r.data));
  const [srConsulta, srResina] = r.data.servicios.sort((a, b) => a.puntos - b.puntos);
  ok(srConsulta.valorCobrado === 54000 && srConsulta.descuentoPct === 10, 'descuento de convenio aplicado (60.000 − 10%)');
  ok(srResina.valorCobrado === 99000 && srResina.valorManual && srResina.costoAplicado === undefined, '"Otros": valor manual (sin costo en la respuesta de la Asistente)');
  const srResinaGer = (await ger.req('GET', '/servicios-realizados?estado=all')).data.servicios.find((s) => s.id === srResina.id);
  ok(srResinaGer?.costoAplicado === 45000, '"Otros": costo del catálogo (visto por Gerente)');
  ok(srConsulta.registradoPor === 'Asistente de Pruebas', 'usuario de registro estampado');
  const pacienteId = r.data.paciente.id;

  r = await asi.req('GET', '/pacientes/cedula/1061234567');
  ok(r.data.existe === true && r.data.paciente.nombre === 'Ana', 'cédula existente detectada');
  r = await asi.req('POST', '/atenciones', {
    cedula: '1061234567',
    paciente: { nombre: 'Cambiado', apellido: 'Intento', telefono: '3000000000', medioOrigen: 'Otro', fechaNacimiento: '1980-01-01' },
    items: [{ servicioId: consulta.id, colaboradorId }],
  });
  ok(r.status === 201 && !r.data.pacienteNuevo && r.data.paciente.nombre === 'Ana', 'paciente existente: datos personales no se modifican');
  r = await asi.req('POST', '/pacientes', { cedula: '1061234567', nombre: 'Otra', apellido: 'Persona', telefono: '3000000001', medioOrigen: 'Otro', fechaNacimiento: '1985-02-03' });
  ok(r.status === 409 && r.data.error.message === 'El paciente ya está registrado', 'cédula duplicada → "El paciente ya está registrado"');

  const gerenteId = (await ger.req('GET', '/auth/me')).data.user.id;
  r = await asi.req('POST', '/atenciones', { cedula: '1061234567', items: [{ servicioId: consulta.id, colaboradorId: gerenteId }] });
  ok(r.status === 400, 'el colaborador debe tener rol Colaborador');
  r = await asi.req('POST', '/atenciones', { cedula: '1061234567', fecha: addDays(today, 3), items: [{ servicioId: consulta.id, colaboradorId }] });
  ok(r.status === 400, 'fecha futura rechazada');
  r = await asi.req('POST', '/atenciones', { cedula: '1061234567', items: [{ servicioId: consulta.id, colaboradorId, otros: { valor: 1, motivo: 'x' } }] });
  ok(r.status === 400, '"Otros" exige motivo');

  // Edición con historial inmutable
  r = await asi.req('PUT', `/servicios-realizados/${srConsulta.id}`, { servicioId: consulta.id, colaboradorId, convenioId: null, fecha: today });
  ok(r.status === 200 && r.data.servicio.valorCobrado === 60000, 'editar servicio realizado recalcula valor');
  r = await asi.req('GET', `/servicios-realizados/${srConsulta.id}/historial`);
  ok(r.data.historial.length === 2 && r.data.historial[1].operacion === 'UPDATE' && r.data.historial[1].usuario, 'historial registra quién y cuándo editó');
  r = await asi.req('PATCH', `/servicios-realizados/${srResina.id}/anular`, { motivo: 'Registro duplicado' });
  ok(r.status === 403, 'asistente no anula → 403');
  r = await asi.req('DELETE', `/servicios-realizados/${srResina.id}`);
  ok(r.status === 404, 'no existe borrado físico (DELETE → 404)');

  // Producción del mes anterior para la recurrencia (100%: el paciente vuelve).
  await asOwner(async (pg) => {
    const org = (await pg.query("SELECT id FROM organizations WHERE slug = 'nuevo-amanecer-pacifico'")).rows[0].id;
    await pg.query(
      `INSERT INTO servicios_realizados (organization_id, paciente_id, servicio_id, colaborador_id, fecha, valor_lista, valor_cobrado, costo_aplicado, puntos, usuario_registro_id)
       VALUES ($1, $2, $3, $4, $5, 60000, 60000, 15000, 10, $6)`,
      [org, pacienteId, consulta.id, colaboradorId, prevMonthDay, gerenteId],
    );
  });

  // ---------------------------------------------------------------- Agenda
  const manana = addDays(today, 1);
  const pasado = addDays(today, 2);
  r = await asi.req('POST', '/citas', { pacienteId, fecha: manana, hora: '09:00', servicioId: consulta.id, colaboradorId });
  ok(r.status === 201 && r.data.cita.alerta === 'naranja', 'cita para mañana → alerta naranja');
  const citaManana = r.data.cita;
  r = await asi.req('POST', '/citas', { pacienteId, fecha: manana, hora: '09:00' });
  ok(r.status === 409 && r.data.error.message === 'El horario seleccionado ya está ocupado', 'slot ocupado bloqueado');
  r = await asi.req('POST', '/citas', { pacienteId, fecha: pasado, hora: '10:30', colaboradorId });
  ok(r.status === 201 && r.data.cita.alerta === 'amarillo', 'cita en 2 días → alerta amarilla');
  r = await asi.req('POST', '/citas', { pacienteId, fecha: manana, hora: '09:15' });
  ok(r.status === 400, 'hora fuera de slot de 30 min');
  r = await asi.req('POST', '/citas', { pacienteId, fecha: addDays(today, -1), hora: '09:00' });
  ok(r.status === 400, 'no se agenda en el pasado');
  r = await asi.req('GET', `/citas/disponibilidad?fecha=${manana}`);
  ok(r.data.slots.find((s) => s.hora === '09:00').ocupado === true, 'disponibilidad marca slot ocupado');

  // Aplazar libera el slot
  r = await asi.req('POST', `/citas/${citaManana.id}/aplazar`, { fecha: pasado, hora: '11:00' });
  ok(r.status === 200 && r.data.cita.estado === 'Aplazado' && r.data.nueva.tipo === 'reagendada', 'aplazar crea cita reagendada');
  r = await asi.req('POST', '/citas', { pacienteId, fecha: manana, hora: '09:00', colaboradorId });
  ok(r.status === 201, 'slot aplazado queda libre');
  const citaVencida = r.data.cita;
  r = await asi.req('POST', '/citas', { pacienteId, fecha: manana, hora: '14:00', colaboradorId });
  const citaCumplida = r.data.cita;

  // Simula el paso del tiempo: las citas pasan a ayer.
  await asOwner((pg) => pg.query("UPDATE citas SET fecha = app_today() - 1 WHERE id = ANY($1::uuid[])", [[citaVencida.id, citaCumplida.id]]));
  r = await asi.req('GET', '/citas/alertas');
  ok(r.data.citas.find((c) => c.id === citaVencida.id)?.alerta === 'rojo', 'cita vencida no cumplida → alerta roja');
  r = await asi.req('PATCH', `/citas/${citaCumplida.id}/estado`, {
    estado: 'Cumplida',
    resultado: 'Atención sin novedad',
    control: { fecha: addDays(today, 15), hora: '08:00' },
  });
  ok(r.status === 200 && r.data.control?.tipo === 'control' && r.data.control.colaboradorId === colaboradorId, 'cumplida + cita de control');
  r = await asi.req('PATCH', `/citas/${citaCumplida.id}/estado`, { estado: 'Ausente' });
  ok(r.status === 400, 'cita cerrada no cambia de estado');
  r = await asi.req('PATCH', `/citas/${citaVencida.id}/estado`, { estado: 'Ausente' });
  ok(r.status === 200, 'marcar ausente');

  // ----------------------------------------------------- Inasistencias
  r = await asi.req('GET', '/cierres-ausencia/pendientes');
  ok(r.data.citas.some((c) => c.id === citaVencida.id), 'ausencia aparece pendiente de cierre');
  r = await asi.req('POST', '/cierres-ausencia', { citaId: citaVencida.id, motivo: 'Otros', canalContacto: 'WhatsApp' });
  ok(r.status === 400, 'motivo "Otros" exige observación');
  r = await asi.req('POST', '/cierres-ausencia', {
    citaId: citaVencida.id,
    motivo: 'No recordaba',
    canalContacto: 'Llamada',
    observacion: 'Se le recordó por llamada',
    reagendar: { fecha: addDays(today, 5), hora: '16:00' },
  });
  ok(r.status === 201 && r.data.nuevaCita?.tipo === 'reagendada', 'cerrar inasistencia y reagendar');
  r = await asi.req('POST', '/cierres-ausencia', { citaId: citaVencida.id, motivo: 'Tiempo', canalContacto: 'WhatsApp' });
  ok(r.status === 409, 'inasistencia ya cerrada → 409');
  r = await asi.req('POST', '/cierres-ausencia', { citaId: citaCumplida.id, motivo: 'Tiempo', canalContacto: 'WhatsApp' });
  ok(r.status === 400, 'solo se cierran citas Ausente');

  // Estado del seguimiento: Responde / No responde / Pendiente
  const ausentes = [];
  for (const hora of ['15:00', '16:00']) {
    r = await asi.req('POST', '/citas', { pacienteId, fecha: manana, hora });
    ausentes.push(r.data.cita.id);
  }
  await asOwner((pg) => pg.query('UPDATE citas SET fecha = app_today() - 1 WHERE id = ANY($1::uuid[])', [ausentes]));
  for (const id of ausentes) await asi.req('PATCH', `/citas/${id}/estado`, { estado: 'Ausente' });
  r = await asi.req('POST', '/cierres-ausencia', { citaId: ausentes[0], respuesta: 'No responde', canalContacto: 'SMS' });
  ok(r.status === 400, 'canal distinto de Llamada/WhatsApp rechazado');
  r = await asi.req('POST', '/cierres-ausencia', {
    citaId: ausentes[0],
    respuesta: 'No responde',
    canalContacto: 'WhatsApp',
    reagendar: { fecha: addDays(today, 6), hora: '16:00' },
  });
  ok(r.status === 400, '"No responde" no permite reagendar');
  r = await asi.req('POST', '/cierres-ausencia', { citaId: ausentes[0], respuesta: 'No responde', canalContacto: 'WhatsApp', motivo: 'Tiempo' });
  ok(r.status === 201, '"No responde" se cierra sin motivo (se ignora)');
  const [ay, am] = addDays(today, -1).split('-').map(Number);
  r = await asi.req('GET', `/cierres-ausencia/seguimientos?anio=${ay}&mes=${am}`);
  const estadoDe = (id) => r.data.seguimientos.find((s) => s.citaId === id)?.estado;
  ok(estadoDe(citaVencida.id) === 'Responde' && estadoDe(ausentes[0]) === 'No responde' && estadoDe(ausentes[1]) === 'Pendiente', 'seguimientos con estado Responde / No responde / Pendiente');
  r = await asi.req('GET', `/cierres-ausencia/estadisticas?anio=${ay}&mes=${am}`);
  const st = r.data;
  const n = (arr, key, val) => arr.find((x) => x[key] === val)?.cantidad;
  ok(
    n(st.estados, 'estado', 'Responde') === 1 && n(st.estados, 'estado', 'No responde') === 1 && n(st.estados, 'estado', 'Pendiente') === 1,
    'estadísticas: conteo por estado',
    JSON.stringify(st.estados),
  );
  ok(n(st.motivos, 'motivo', 'No recordaba') === 1 && st.motivos.length === 5, 'estadísticas: motivos');
  ok(n(st.canales, 'canal', 'Llamada') === 1 && n(st.canales, 'canal', 'WhatsApp') === 0, 'estadísticas: canal con comunicación lograda');
  ok(n(st.reagendamiento, 'opcion', 'Reagendó') === 1 && n(st.reagendamiento, 'opcion', 'No reagendó') === 1, 'estadísticas: reagendaron / no reagendaron');
  ok(n(st.respuesta, 'respuesta', 'Responde') === 1 && n(st.respuesta, 'respuesta', 'No responde') === 1, 'estadísticas: responde / no responde');

  // ------------------------------------------------- Vista Colaborador
  r = await col.req('GET', '/mi-progreso');
  const prog = r.data;
  // Puntos del mes: consulta 10 + resina 25 + consulta 10 = 45; bono recurrencia 100% → 25.
  ok(r.status === 200 && prog.puntos.servicios === 45 && prog.puntos.bonoRecurrencia === 25 && prog.puntos.total === 70, 'puntos + bono de recurrencia', JSON.stringify(prog.puntos));
  ok(prog.meta.puntos === 40 && prog.faltantes === 0 && prog.porcentaje === 175, 'meta, faltantes y % alcanzado');
  ok(prog.semanas.length === 4 && prog.semanas.every((s) => typeof s.propuesta === 'number'), 'propuesta por semana');
  // Las citas se movieron a "ayer", que puede caer en el mes anterior.
  const [ya, ym] = addDays(today, -1).split('-').map(Number);
  const progAyer = (await col.req('GET', `/mi-progreso?anio=${ya}&mes=${ym}`)).data;
  ok(
    Array.isArray(progAyer.citasPorDia) && progAyer.citasPorDia.some((d) => d.cumplidas === 1 && d.noCumplidas >= 1),
    'RF-32: citas por día en cantidades',
    JSON.stringify(progAyer.citasPorDia),
  );
  ok(prog.recurrencia?.tasa === 100, 'tasa de recurrencia visible');
  const forbiddenKeys = /"(dinero|valor\w*|costo\w*|comision\w*|margen|utilidad|ingreso\w*|cedula|telefono|paciente\w*|nombre|apellido|metaDinero|valorPuntoAdicional)"/i;
  ok(!forbiddenKeys.test(r.text), 'mi-progreso no expone dinero ni datos de pacientes', r.text.match(forbiddenKeys)?.[0]);

  r = await col.req('GET', '/servicios');
  ok(r.status === 200 && r.data.servicios.every((s) => s.valorPublico === undefined && s.costoClinica === undefined), 'catálogo sin cifras en dinero para Colaborador');
  r = await asi.req('GET', '/servicios');
  ok(r.status === 200 && r.data.servicios.length > 0 && r.data.servicios.every((s) => s.valorPublico > 0 && s.costoClinica === undefined), 'Asistente ve valor al público pero no el costo de la clínica');
  r = await asi.req('GET', '/servicios-realizados?estado=all');
  ok(r.status === 200 && r.data.servicios.length > 0 && r.data.servicios.every((s) => s.costoAplicado === undefined), 'servicios realizados sin costo para Asistente');
  r = await ger.req('GET', '/servicios');
  ok(r.status === 200 && r.data.servicios.every((s) => typeof s.costoClinica === 'number'), 'Gerente ve el costo de la clínica');
  for (const [path, label] of [
    ['/tablero', 'tablero gerencial'],
    ['/pacientes?q=Ana', 'búsqueda de pacientes'],
    ['/pacientes/cedula/1061234567', 'consulta por cédula'],
    [`/pacientes/${pacienteId}/historial`, 'historial de paciente'],
    ['/citas/alertas', 'agenda general'],
    [`/citas/disponibilidad?fecha=${manana}`, 'ocupación de agenda'],
    ['/servicios-realizados', 'servicios realizados'],
    ['/convenios', 'convenios'],
    ['/metas', 'metas (con dinero)'],
    ['/cierres-ausencia/pendientes', 'inasistencias'],
  ]) {
    r = await col.req('GET', path);
    ok([403, 404].includes(r.status) && !r.text.includes('1061234567') && !r.text.includes('Riascos'), `Colaborador bloqueado: ${label} (${r.status})`);
  }

  // ----------------------------------------------------- Tablero gerencial
  r = await asi.req('GET', '/tablero');
  ok(r.status === 403, 'asistente no ve tablero gerencial');
  r = await ger.req('GET', `/tablero?anio=${anio}&mes=${mes}`);
  const t = r.data;
  // Ingreso: 60.000 (editado) + 99.000 (manual) + 54.000? No: la 3.ª atención es consulta sin convenio = 60.000.
  ok(r.status === 200 && t.kpis.ingresoTotal === 219000 && t.kpis.costoTotal === 75000 && t.kpis.utilidadNeta === 144000, 'KPIs ingreso/costo/utilidad', JSON.stringify(t.kpis));
  ok(t.kpis.margen === 65.8 && t.kpis.serviciosRealizados === 3, 'margen % y servicios realizados');
  ok(t.kpis.citasAgendadas >= 4, 'servicios agendados (citas del mes)');
  const c = t.colaboradores.find((x) => x.colaboradorId === colaboradorId);
  ok(c.puntosTotales === 70 && c.comision === (70 - 40) * 2000 && c.dinero === 219000, 'comisión = (puntos − meta) × valor punto', JSON.stringify({ p: c.puntosTotales, com: c.comision }));
  ok(c.semanas.length === 4 && c.semanas.every((w) => w.propuestaDinero != null), 'reporte semanal en puntos y dinero');
  ok(t.servicios[0].cantidad === 2 && t.servicios.some((s) => s.clasificacion === 'mas_rentable'), 'ranking y clasificación de servicios');
  ok(t.canales.some((x) => x.medioOrigen === 'Referido' && x.pacientes === 1), 'pacientes nuevos por medio de origen');
  ok(t.recurrencia.tasa === 100 && t.recurrencia.bonoPuntos === 25, 'recurrencia global y bono automático');

  r = await ger.req('PATCH', `/servicios-realizados/${srResina.id}/anular`, { motivo: 'Registro duplicado' });
  ok(r.status === 200 && r.data.servicio.estado === 'anulado', 'gerente anula servicio');
  r = await ger.req('GET', `/tablero?anio=${anio}&mes=${mes}`);
  ok(r.data.kpis.ingresoTotal === 120000, 'servicio anulado sale de las métricas');
  r = await sa.req('GET', '/audit-logs?action=ATENCION_REGISTERED');
  ok(r.data.logs.length >= 2, 'auditoría de atenciones registradas');

  // ----------------------------------------------------- Cargos (migración 008)
  r = await ger.req('POST', '/users', { email: 'higienista@clinica.test', fullName: 'Higienista Nueva', role: 'Colaborador', password: 'TemporalSegura1' });
  ok(r.status === 400 && r.data.error.code === 'CARGO_REQUIRED', 'colaborador nuevo exige cargo');
  r = await ger.req('POST', '/users', { email: 'higienista@clinica.test', fullName: 'Higienista Nueva', role: 'Colaborador', cargo: 'Higienista', password: 'TemporalSegura1' });
  ok(r.status === 201 && r.data.user.cargo === 'Higienista', 'crear colaborador con cargo Higienista');
  const higienistaId = r.data.user.id;
  r = await ger.req('PATCH', `/users/${higienistaId}`, { cargo: 'Auxiliar' });
  ok(r.status === 200 && r.data.user.cargo === 'Auxiliar' && r.data.user.role === 'Colaborador', 'cambiar cargo sin cambiar rol');
  r = await ger.req('POST', '/users', { email: 'gerente2@clinica.test', fullName: 'Gerente Dos', role: 'Gerente', cargo: 'Odontólogo', password: 'TemporalSegura1' });
  ok(r.status === 201 && r.data.user.cargo === null, 'Gerente queda sin cargo aunque se envíe uno');

  r = await ger.req('POST', '/servicios', { categoriaId: consulta.categoriaId, nombre: 'Sellantes', valorPublico: 50000, costoClinica: 10000, puntos: 5, cargos: ['Auxiliar', 'Asistente'] });
  ok(r.status === 201 && r.data.servicio.cargos.join() === 'Auxiliar,Asistente', 'servicio con cargos que lo realizan');
  const sellantes = r.data.servicio;
  r = await asi.req('POST', '/atenciones', { cedula: '1061234567', items: [{ servicioId: sellantes.id, colaboradorId }] });
  ok(r.status === 400 && /no realiza este servicio/.test(r.data.error.message), 'Odontólogo no puede registrar un servicio de otro cargo', JSON.stringify(r.data));
  const asistenteId = (await asi.req('GET', '/auth/me')).data.user.id;
  r = await asi.req('POST', '/atenciones', { cedula: '1061234567', items: [{ servicioId: sellantes.id, colaboradorId: asistenteId }] });
  ok(r.status === 201, 'la Asistente registra un servicio de su cargo a su nombre');
  r = await col.req('GET', '/servicios');
  ok(r.status === 200 && !r.data.servicios.some((s) => s.id === sellantes.id) && r.data.servicios.length > 0, 'el Colaborador solo ve los servicios de su cargo');
  r = await col.req('GET', `/servicios/${sellantes.id}`);
  ok(r.status === 404, 'servicio de otro cargo → 404 para el Colaborador');
  r = await asi.req('GET', '/mi-progreso');
  ok(r.status === 200 && r.data.puntos.total >= 5, 'Mi progreso de la Asistente cuenta sus servicios');

  // ----------------------------------------------------- Cumpleañeros (migración 009)
  const datosPaciente = { cedula: '7700112', nombre: 'Bruno', apellido: 'Díaz', telefono: '3000000002', medioOrigen: 'Otro' };
  r = await asi.req('POST', '/pacientes', datosPaciente);
  ok(r.status === 400 && /nacimiento/i.test(JSON.stringify(r.data)), 'paciente nuevo exige fecha de nacimiento', JSON.stringify(r.data));
  r = await asi.req('POST', '/pacientes', { ...datosPaciente, fechaNacimiento: '2999-01-01' });
  ok(r.status === 400, 'fecha de nacimiento futura rechazada');
  r = await asi.req('POST', '/pacientes', { ...datosPaciente, fechaNacimiento: '1990-02-30' });
  ok(r.status === 400, 'fecha de nacimiento inexistente rechazada');
  r = await asi.req('POST', '/pacientes', { ...datosPaciente, fechaNacimiento: '2001-05-03' });
  ok(r.status === 201 && r.data.paciente.fechaNacimiento === '2001-05-03', 'paciente con fecha de nacimiento');
  const bruno = r.data.paciente;

  r = await asi.req('GET', '/pacientes/cumpleanos?mes=5');
  ok(r.status === 200 && r.data.cumpleaneros.map((c) => c.nombre).join() === 'Bruno Díaz,Ana Riascos', 'cumpleañeros del mes ordenados por día', JSON.stringify(r.data));
  ok(r.data.cumpleaneros[0].dia === 3 && r.data.cumpleaneros[1].dia === 14, 'cumpleañeros con su día');
  ok(Object.keys(r.data.cumpleaneros[0]).sort().join() === 'dia,id,nombre', 'cumpleañeros solo expone nombre y día');
  r = await asi.req('GET', '/pacientes/cumpleanos?mes=8');
  ok(r.status === 200 && r.data.cumpleaneros.length === 0, 'mes sin cumpleañeros');
  r = await asi.req('GET', '/pacientes/cumpleanos');
  ok(r.status === 200 && r.data.mes >= 1 && r.data.mes <= 12, 'cumpleañeros usa el mes actual por defecto');
  r = await asi.req('GET', '/pacientes/cumpleanos?mes=13');
  ok(r.status === 400, 'mes inválido → 400');
  r = await col.req('GET', '/pacientes/cumpleanos');
  ok(r.status === 403, 'Colaborador no ve cumpleañeros');

  r = await asi.req('PUT', `/pacientes/${bruno.id}`, { nombre: 'Bruno', apellido: 'Díaz', telefono: '3000000003', medioOrigen: 'Otro' });
  ok(r.status === 200 && r.data.paciente.fechaNacimiento === '2001-05-03', 'editar sin fecha conserva la fecha de nacimiento');
  r = await asi.req('PUT', `/pacientes/${bruno.id}`, { nombre: 'Bruno', apellido: 'Díaz', telefono: '3000000003', medioOrigen: 'Otro', fechaNacimiento: '2001-06-03' });
  ok(r.status === 200 && r.data.paciente.fechaNacimiento === '2001-06-03', 'editar corrige la fecha de nacimiento');
} catch (err) {
  console.error(err);
  crashed = true;
} finally {
  await h.close();
  const { fails, passes } = h.results();
  console.log(fails || crashed ? `\n${fails} FALLOS (${passes} OK)` : `\nTODO OK (${passes})`);
  process.exit(fails || crashed ? 1 : 0);
}
