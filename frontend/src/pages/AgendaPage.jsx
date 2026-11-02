import { useState } from 'react';
import { BellRing, CalendarCheck, CalendarClock, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Phone, Search, UserX } from 'lucide-react';
import {
  ALERTA_STYLES,
  AlertaBadge,
  EstadoBadge,
  MEDIOS_ORIGEN,
  SlotPicker,
  addDays,
  formatFecha,
  formatFechaLarga,
  todayBogota,
  useCatalogos,
} from '../components/business.jsx';
import { Alert, Badge, Button, Card, ConfirmModal, EmptyState, IconButton, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui.jsx';
import { get, patch, post } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Selector de semana: lunes a domingo de la fecha elegida, con flechas por semana.
function WeekStrip({ fecha, onChange }) {
  const hoy = todayBogota();
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  const lunes = addDays(fecha, -((dow + 6) % 7));
  const dias = Array.from({ length: 7 }, (_, i) => addDays(lunes, i));
  return (
    <div className="flex items-center gap-1">
      <div className="hidden md:block">
        <IconButton label="Semana anterior" icon={ChevronLeft} onClick={() => onChange(addDays(fecha, -7))} />
      </div>
      <div className="scrollbar-none grid flex-1 grid-cols-7 gap-1 overflow-x-auto">
        {dias.map((d, i) => {
          const sel = d === fecha;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={sel}
              aria-label={formatFechaLarga(d)}
              onClick={() => onChange(d)}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center rounded-2xl transition-colors ${sel ? 'bg-primary text-white' : 'text-text hover:bg-subtle'}`}
            >
              <span className={`text-[11px] font-medium ${sel ? 'text-white/80' : 'text-muted'}`}>{DIA_CORTO[(i + 1) % 7]}</span>
              <span className="tabular font-display text-base font-bold">{Number(d.slice(8, 10))}</span>
              <span className={`mt-0.5 size-1 rounded-full ${d === hoy ? (sel ? 'bg-white' : 'bg-primary') : 'bg-transparent'}`} aria-hidden />
            </button>
          );
        })}
      </div>
      <div className="hidden md:block">
        <IconButton label="Semana siguiente" icon={ChevronRight} onClick={() => onChange(addDays(fecha, 7))} />
      </div>
    </div>
  );
}

function NuevaCitaModal({ fecha, onClose, onSaved }) {
  const cat = useCatalogos({ convenios: false });
  const [cedula, setCedula] = useState('');
  const [lookup, setLookup] = useState(null);
  const [nuevo, setNuevo] = useState({ nombre: '', apellido: '', telefono: '', medioOrigen: '' });
  const [form, setForm] = useState({ servicioId: '', colaboradorId: '' });
  const [slot, setSlot] = useState({ fecha, hora: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function buscar() {
    setError('');
    try {
      setLookup(await get(`/pacientes/cedula/${encodeURIComponent(cedula.trim())}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let pacienteId = lookup?.paciente?.id;
      if (!pacienteId) pacienteId = (await post('/pacientes', { cedula: cedula.trim(), ...nuevo })).paciente.id;
      await post('/citas', { pacienteId, ...slot, servicioId: form.servicioId || null, colaboradorId: form.colaboradorId || null });
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
      title="Nueva cita"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cita-form" loading={saving} disabled={!lookup || !slot.hora}>
            Agendar
          </Button>
        </>
      }
    >
      <form id="cita-form" onSubmit={save} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div className="flex items-end gap-2">
          <Input
            label="Cédula del paciente"
            inputMode="numeric"
            className="flex-1"
            value={cedula}
            onChange={(e) => {
              setCedula(e.target.value);
              setLookup(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                buscar();
              }
            }}
          />
          <Button variant="outline" icon={Search} onClick={buscar} disabled={!cedula.trim()}>
            Buscar
          </Button>
        </div>
        {lookup?.existe && (
          <Alert tone="success">
            El paciente ya está registrado: <strong>{lookup.paciente.nombre} {lookup.paciente.apellido}</strong>
          </Alert>
        )}
        {lookup && !lookup.existe && (
          <div className="grid gap-3 rounded-2xl border border-line p-3 md:grid-cols-2">
            <p className="text-sm font-semibold md:col-span-2">Paciente nuevo</p>
            <Input label="Nombre" required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            <Input label="Apellido" required value={nuevo.apellido} onChange={(e) => setNuevo({ ...nuevo, apellido: e.target.value })} />
            <Input label="Teléfono" type="tel" required value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} />
            <Select label="Medio de origen" required value={nuevo.medioOrigen} onChange={(e) => setNuevo({ ...nuevo, medioOrigen: e.target.value })}>
              <option value="">Seleccione…</option>
              {MEDIOS_ORIGEN.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Select label="Servicio (opcional)" value={form.servicioId} onChange={(e) => setForm({ ...form, servicioId: e.target.value })}>
            <option value="">—</option>
            {cat.servicios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Select>
          <Select label="Colaborador (opcional)" value={form.colaboradorId} onChange={(e) => setForm({ ...form, colaboradorId: e.target.value })}>
            <option value="">—</option>
            {cat.colaboradores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </div>
        <SlotPicker value={slot} onChange={setSlot} />
      </form>
    </Modal>
  );
}

function CumplidaModal({ cita, onClose, onSaved }) {
  const [resultado, setResultado] = useState('');
  const [control, setControl] = useState(false);
  const [slot, setSlot] = useState({ fecha: addDays(todayBogota(), 15), hora: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await patch(`/citas/${cita.id}/estado`, { estado: 'Cumplida', resultado: resultado || undefined, control: control ? slot : null });
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
      title="Finalizar atención"
      description={`${cita.paciente.nombre} · ${formatFecha(cita.fecha)} ${cita.hora}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={control && !slot.hora} onClick={save}>
            Marcar cumplida
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Textarea label="Resultado de la atención" maxLength={1000} value={resultado} onChange={(e) => setResultado(e.target.value)} />
        <label className="touch-target flex items-center gap-3 rounded-xl border border-line px-3">
          <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={control} onChange={(e) => setControl(e.target.checked)} />
          <span className="text-sm font-semibold">Agendar cita de control</span>
        </label>
        {control && <SlotPicker value={slot} onChange={setSlot} />}
      </div>
    </Modal>
  );
}

function AplazarModal({ cita, onClose, onSaved }) {
  const [slot, setSlot] = useState({ fecha: addDays(todayBogota(), 1), hora: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError('');
    try {
      await post(`/citas/${cita.id}/aplazar`, slot);
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
      title="Aplazar cita"
      description={`${cita.paciente.nombre} · la cita actual queda Aplazada y se crea una nueva.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={!slot.hora} onClick={save}>
            Reagendar
          </Button>
        </>
      }
    >
      {error && <Alert className="mb-4">{error}</Alert>}
      <SlotPicker value={slot} onChange={setSlot} />
    </Modal>
  );
}

function CitaCard({ cita, onAction }) {
  const s = ALERTA_STYLES[cita.alerta];
  const abierta = ['Pendiente', 'Confirmado'].includes(cita.estado);
  return (
    <Card compact className={`flex flex-col gap-3 ${s?.ring ?? ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="tabular grid h-11 w-14 shrink-0 place-items-center rounded-xl bg-primary-soft text-sm font-semibold text-primary">{cita.hora}</span>
          <div className="min-w-0">
            <p className="font-semibold">{cita.paciente.nombre}</p>
            <p className="flex items-center gap-1 text-xs text-muted">
              <Phone className="size-3" aria-hidden /> {cita.paciente.telefono}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <AlertaBadge alerta={cita.alerta} />
          {cita.tipo !== 'normal' && <Badge tone="muted">{cita.tipo === 'control' ? 'Control' : 'Reagendada'}</Badge>}
          <EstadoBadge estado={cita.estado} />
        </div>
      </div>
      {(cita.servicio || cita.colaborador) && (
        <p className="text-sm text-muted">
          {cita.servicio ?? 'Sin servicio'} {cita.colaborador && `· ${cita.colaborador}`}
        </p>
      )}
      {cita.resultado && <p className="rounded-xl bg-bg px-3 py-2 text-sm">{cita.resultado}</p>}
      {abierta && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {cita.estado === 'Pendiente' && (
            <Button variant="outline" icon={CalendarCheck} className="px-3" onClick={() => onAction('confirmar', cita)}>
              Confirmar
            </Button>
          )}
          <Button variant="outline" icon={CheckCircle2} className="px-3" onClick={() => onAction('cumplida', cita)}>
            Cumplida
          </Button>
          <Button variant="outline" icon={CalendarClock} className="px-3" onClick={() => onAction('aplazar', cita)}>
            Aplazar
          </Button>
          <Button variant="danger" icon={UserX} className="px-3" onClick={() => onAction('ausente', cita)}>
            Ausente
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function AgendaPage() {
  const [fecha, setFecha] = useState(todayBogota());
  const [nueva, setNueva] = useState(false);
  const [filtroAlerta, setFiltroAlerta] = useState(null); // amarillo | naranja | rojo | null (todas)
  const [action, setAction] = useState(null); // { kind, cita }
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const dia = useResource(`/citas?desde=${fecha}&hasta=${fecha}`);
  const alertas = useResource('/citas/alertas');

  const refresh = () => {
    dia.reload();
    alertas.reload();
  };
  const done = () => {
    setAction(null);
    setActionError('');
    refresh();
  };

  async function quick(estado) {
    setBusy(true);
    setActionError('');
    try {
      await patch(`/citas/${action.cita.id}/estado`, { estado });
      done();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const citas = dia.data?.citas ?? [];
  const listaAlertas = alertas.data?.citas ?? [];
  const alertasVisibles = filtroAlerta ? listaAlertas.filter((c) => c.alerta === filtroAlerta) : listaAlertas;

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Slots de 30 minutos · un paciente por horario."
        actions={
          <Button icon={CalendarPlus} onClick={() => setNueva(true)}>
            Nueva cita
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-4 rounded-card border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
              <p className="font-display text-[15px] font-bold first-letter:uppercase">{formatFechaLarga(fecha)}</p>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" className="px-3" onClick={() => setFecha(todayBogota())}>
                  Hoy
                </Button>
                <input
                  type="date"
                  aria-label="Ir a una fecha"
                  value={fecha}
                  onChange={(e) => e.target.value && setFecha(e.target.value)}
                  className="touch-target rounded-xl border border-line bg-subtle px-2 text-sm"
                />
              </div>
            </div>
            <WeekStrip fecha={fecha} onChange={setFecha} />
          </div>
          {dia.error && <Alert className="mb-4">{dia.error}</Alert>}
          {dia.loading && !dia.data ? (
            <Spinner />
          ) : citas.length === 0 ? (
            <Card>
              <EmptyState icon={CalendarClock} title="Sin citas este día" />
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {citas.map((c) => (
                <CitaCard key={c.id} cita={c} onAction={(kind, cita) => setAction({ kind, cita })} />
              ))}
            </div>
          )}
        </section>

        <aside aria-labelledby="alertas-title">
          <Card className="lg:sticky lg:top-24">
            <h2 id="alertas-title" className="mb-2 flex items-center gap-2.5 text-base font-bold">
              <span className="grid size-9 place-items-center rounded-xl bg-secondary-soft text-secondary">
                <BellRing className="size-[18px]" aria-hidden />
              </span>
              Requieren atención
            </h2>
            <div role="group" aria-label="Filtrar alertas" className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {Object.entries(ALERTA_STYLES).map(([k, s]) => {
                const activo = filtroAlerta === k;
                const n = listaAlertas.filter((c) => c.alerta === k).length;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => setFiltroAlerta(activo ? null : k)}
                    className={`touch-target inline-flex items-center gap-1.5 rounded-full px-3 font-semibold transition ${s.badge} ${activo ? 'outline-2 outline-offset-1 outline-current' : filtroAlerta ? 'opacity-55 hover:opacity-100' : ''}`}
                  >
                    {s.label}
                    <span className="tabular rounded-full bg-white/80 px-1.5">{n}</span>
                  </button>
                );
              })}
            </div>
            {alertas.loading && !alertas.data ? (
              <Spinner />
            ) : alertasVisibles.length === 0 ? (
              <p className="text-sm text-muted">{filtroAlerta ? `No hay citas en «${ALERTA_STYLES[filtroAlerta].label}».` : 'No hay citas próximas ni vencidas pendientes.'}</p>
            ) : (
              <ul className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto">
                {alertasVisibles.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setFecha(c.fecha)}
                      className={`touch-target w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm hover:bg-bg ${ALERTA_STYLES[c.alerta]?.ring ?? ''}`}
                    >
                      <span className="font-semibold">{c.paciente.nombre}</span>
                      <span className="block text-xs text-muted">
                        {formatFecha(c.fecha)} · {c.hora} · {c.estado}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      {nueva && (
        <NuevaCitaModal
          fecha={fecha >= todayBogota() ? fecha : todayBogota()}
          onClose={() => setNueva(false)}
          onSaved={() => {
            setNueva(false);
            refresh();
          }}
        />
      )}
      {action?.kind === 'cumplida' && <CumplidaModal cita={action.cita} onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === 'aplazar' && <AplazarModal cita={action.cita} onClose={() => setAction(null)} onSaved={done} />}
      <ConfirmModal
        open={action?.kind === 'confirmar' || action?.kind === 'ausente'}
        title={action?.kind === 'ausente' ? 'Marcar inasistencia' : 'Confirmar cita'}
        message={
          action?.kind === 'ausente'
            ? `${action?.cita.paciente.nombre} no asistió. La cita pasará a Inasistencias para su seguimiento.`
            : `Confirmar la asistencia de ${action?.cita.paciente.nombre}.`
        }
        confirmLabel={action?.kind === 'ausente' ? 'Marcar ausente' : 'Confirmar'}
        tone={action?.kind === 'ausente' ? 'danger' : 'primary'}
        loading={busy}
        error={actionError}
        onConfirm={() => quick(action.kind === 'ausente' ? 'Ausente' : 'Confirmado')}
        onClose={() => {
          setAction(null);
          setActionError('');
        }}
      />
    </>
  );
}
