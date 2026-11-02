import { useState } from 'react';
import { CalendarX2, MessageCircle, Phone, PhoneOff, UserCheck } from 'lucide-react';
import { CANALES_CONTACTO, MOTIVOS_AUSENCIA, MonthPicker, SlotPicker, addDays, formatFecha, todayBogota, usePeriodo } from '../components/business.jsx';
import { ColumnChart, STATUS_COLORS } from '../components/charts.jsx';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Segmented, Select, Spinner, TableWrap, Textarea, td, th } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { post } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

// Estado del seguimiento: Pendiente (sin cierre), Responde o No responde.
const ESTADOS = {
  Responde: { color: STATUS_COLORS.good, badge: 'bg-success-soft text-success', icon: UserCheck },
  Pendiente: { color: STATUS_COLORS.warning, badge: 'bg-amber-100 text-amber-800', icon: CalendarX2 },
  'No responde': { color: STATUS_COLORS.critical, badge: 'bg-secondary-soft text-secondary', icon: PhoneOff },
};

function EstadoSeguimiento({ estado }) {
  const s = ESTADOS[estado];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${s.badge}`}>
      <Icon className="size-3.5" aria-hidden /> {estado}
    </span>
  );
}

// Botones de opción (segmentados) accesibles.
function OpcionesBoton({ label, options, value, onChange }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(({ value: v, label: l, icon: Icon }) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`touch-target inline-flex items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
              value === v ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-text hover:border-primary hover:text-primary'
            }`}
          >
            {Icon && <Icon className="size-4" aria-hidden />} {l}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CierreModal({ seguimiento, onClose, onSaved }) {
  const { can } = useAuth();
  const [respuesta, setRespuesta] = useState('Responde');
  const [canal, setCanal] = useState('');
  const [motivo, setMotivo] = useState('');
  const [observacion, setObservacion] = useState('');
  const [reagendar, setReagendar] = useState(false);
  const [slot, setSlot] = useState({ fecha: addDays(todayBogota(), 1), hora: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const responde = respuesta === 'Responde';

  const valido = canal && (!responde || motivo) && (!responde || motivo !== 'Otros' || observacion.trim().length >= 3) && (!reagendar || slot.hora);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await post('/cierres-ausencia', {
        citaId: seguimiento.citaId,
        respuesta,
        canalContacto: canal,
        motivo: responde ? motivo : null,
        observacion: observacion || undefined,
        reagendar: responde && reagendar ? slot : null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Registrar seguimiento"
      description={`${seguimiento.paciente.nombre} · ${formatFecha(seguimiento.fecha)} ${seguimiento.hora}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cierre-form" loading={saving} disabled={!valido}>
            {responde && reagendar ? 'Guardar y reagendar' : 'Guardar seguimiento'}
          </Button>
        </>
      }
    >
      <form id="cierre-form" onSubmit={save} className="flex flex-col gap-5">
        {error && <Alert>{error}</Alert>}
        <OpcionesBoton
          label="Canal de contacto"
          value={canal}
          onChange={setCanal}
          options={CANALES_CONTACTO.map((c) => ({ value: c, label: c, icon: c === 'Llamada' ? Phone : MessageCircle }))}
        />
        <OpcionesBoton
          label="¿Se logró comunicación con el paciente?"
          value={respuesta}
          onChange={(v) => {
            setRespuesta(v);
            if (v === 'No responde') setReagendar(false);
          }}
          options={[
            { value: 'Responde', label: 'Responde', icon: UserCheck },
            { value: 'No responde', label: 'No responde', icon: PhoneOff },
          ]}
        />
        {responde ? (
          <Select label="Motivo de la inasistencia" required value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            <option value="">Seleccione…</option>
            {MOTIVOS_AUSENCIA.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        ) : (
          <Alert tone="success">Se registrará como "No responde": sin motivo ni reagendamiento.</Alert>
        )}
        <Textarea
          label="Observación"
          required={responde && motivo === 'Otros'}
          hint={responde && motivo === 'Otros' ? 'Obligatoria para el motivo "Otros".' : undefined}
          maxLength={1000}
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
        />
        {responde && can('MANAGE_APPOINTMENTS') && (
          <label className="touch-target flex items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" className="size-5" checked={reagendar} onChange={(e) => setReagendar(e.target.checked)} />
            <span className="text-sm font-semibold">El paciente reagenda: abrir calendario</span>
          </label>
        )}
        {responde && reagendar && <SlotPicker value={slot} onChange={setSlot} />}
      </form>
    </Modal>
  );
}

const FILTROS = ['all', 'Pendiente', 'Responde', 'No responde'];

export default function InasistenciasPage() {
  const [periodo, move] = usePeriodo();
  const [filtro, setFiltro] = useState('all');
  const [seleccion, setSeleccion] = useState(null);
  const q = `anio=${periodo.anio}&mes=${periodo.mes}`;
  const stats = useResource(`/cierres-ausencia/estadisticas?${q}`);
  const lista = useResource(`/cierres-ausencia/seguimientos?${q}&estado=${encodeURIComponent(filtro)}`);
  const pendientesTotales = useResource('/cierres-ausencia/pendientes');
  const s = stats.data;
  const rows = lista.data?.seguimientos ?? [];
  const pendientesOtrosMeses = (pendientesTotales.data?.citas ?? []).filter((c) => {
    const [y, m] = c.fecha.split('-').map(Number);
    return y !== periodo.anio || m !== periodo.mes;
  }).length;

  const refresh = () => {
    stats.reload();
    lista.reload();
    pendientesTotales.reload();
  };

  return (
    <>
      <PageHeader
        title="Inasistencias"
        description="Seguimiento de citas a las que el paciente no asistió (por fecha de la cita)."
        actions={<MonthPicker periodo={periodo} onMove={move} />}
      />
      {pendientesOtrosMeses > 0 && (
        <Alert className="mb-4">Hay {pendientesOtrosMeses} inasistencia(s) pendiente(s) de seguimiento en otros meses.</Alert>
      )}

      <section aria-labelledby="graficas" className="mb-8">
        <h2 id="graficas" className="sr-only">
          Gráficas
        </h2>
        {stats.error && <Alert className="mb-4">{stats.error}</Alert>}
        {stats.loading && !s ? (
          <Spinner />
        ) : s ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <ColumnChart
              title="Estado de los seguimientos"
              description={`${s.total} inasistencia(s) en el mes`}
              data={s.estados.map((e) => ({ label: e.estado, value: e.cantidad, color: ESTADOS[e.estado].color }))}
            />
            <ColumnChart title="Motivos de inasistencia" description="Pacientes que respondieron" data={s.motivos.map((m) => ({ label: m.motivo, value: m.cantidad }))} />
            <ColumnChart title="Canal con comunicación lograda" description="Seguimientos con respuesta" data={s.canales.map((c) => ({ label: c.canal, value: c.cantidad }))} />
            <ColumnChart title="Reagendamiento" description="De los seguimientos realizados" data={s.reagendamiento.map((r) => ({ label: r.opcion, value: r.cantidad }))} />
            <ColumnChart
              title="Respuesta al contacto"
              description="Seguimientos realizados"
              data={s.respuesta.map((r) => ({ label: r.respuesta, value: r.cantidad, color: ESTADOS[r.respuesta].color }))}
            />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="seguimientos">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 id="seguimientos" className="text-lg font-bold">
            Seguimientos del mes
          </h2>
          <Segmented
            label="Filtrar por estado"
            value={filtro}
            onChange={setFiltro}
            options={FILTROS.map((f) => ({ value: f, label: f === 'all' ? 'Todos' : f }))}
          />
        </div>
        {lista.error && <Alert className="mb-4">{lista.error}</Alert>}
        {lista.loading && !lista.data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarX2} title="Sin inasistencias para este filtro" />
          </Card>
        ) : (
          <Card flush>
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Paciente</th>
                  <th className={th}>Cita</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Motivo</th>
                  <th className={th}>Canal</th>
                  <th className={th}>Reagendó</th>
                  <th className={th}>Gestión</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.citaId} className="hover:bg-bg/60">
                    <td className={td}>
                      <p className="font-semibold">{x.paciente.nombre}</p>
                      <a href={`tel:${x.paciente.telefono.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-xs text-primary">
                        <Phone className="size-3" aria-hidden /> {x.paciente.telefono}
                      </a>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {formatFecha(x.fecha)} {x.hora}
                      {x.servicio && <p className="text-xs text-muted">{x.servicio}</p>}
                    </td>
                    <td className={td}>
                      <EstadoSeguimiento estado={x.estado} />
                    </td>
                    <td className={td}>
                      {x.cierre?.motivo ? <Badge tone="muted">{x.cierre.motivo}</Badge> : <span className="text-muted">—</span>}
                      {x.cierre?.observacion && <p className="mt-1 max-w-[14rem] truncate text-xs text-muted" title={x.cierre.observacion}>{x.cierre.observacion}</p>}
                    </td>
                    <td className={td}>{x.cierre?.canalContacto ?? <span className="text-muted">—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {!x.cierre ? <span className="text-muted">—</span> : x.cierre.reagendo ? `Sí · ${formatFecha(x.cierre.nuevaCita.fecha)} ${x.cierre.nuevaCita.hora}` : 'No'}
                    </td>
                    <td className={td}>
                      {x.estado === 'Pendiente' ? (
                        <Button className="px-3" onClick={() => setSeleccion(x)}>
                          Registrar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted">
                          {x.cierre.usuario}
                          <br />
                          {formatDateTime(x.cierre.fecha)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        )}
      </section>

      {seleccion && (
        <CierreModal
          seguimiento={seleccion}
          onClose={() => setSeleccion(null)}
          onSaved={() => {
            setSeleccion(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
