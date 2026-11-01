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
    <Card className={`flex flex-col gap-3 p-4 md:p-4 ${s?.ring ?? ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-white">{cita.hora}</span>
          <div className="min-w-0">
            <p className="font-bold">{cita.paciente.nombre}</p>
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
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5">
              <IconButton label="Día anterior" icon={ChevronLeft} onClick={() => setFecha(addDays(fecha, -1))} />
              <input
                type="date"
                aria-label="Fecha"
                value={fecha}
                onChange={(e) => e.target.value && setFecha(e.target.value)}
                className="touch-target rounded-lg bg-transparent px-2 text-sm font-semibold"
              />
              <IconButton label="Día siguiente" icon={ChevronRight} onClick={() => setFecha(addDays(fecha, 1))} />
            </div>
            <Button variant="ghost" onClick={() => setFecha(todayBogota())}>
              Hoy
            </Button>
            <p className="w-full text-sm font-semibold capitalize text-muted md:ml-auto md:w-auto">{formatFechaLarga(fecha)}</p>
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
            <h2 id="alertas-title" className="mb-1 flex items-center gap-2 font-bold">
              <BellRing className="size-5 text-secondary" aria-hidden /> Alertas
            </h2>
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {Object.entries(ALERTA_STYLES).map(([k, s]) => (
                <span key={k} className={`rounded-full px-2 py-0.5 font-semibold ${s.badge}`}>
                  {s.label}
                </span>
              ))}
            </div>
            {alertas.loading && !alertas.data ? (
              <Spinner />
            ) : listaAlertas.length === 0 ? (
              <p className="text-sm text-muted">No hay citas próximas ni vencidas pendientes.</p>
            ) : (
              <ul className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto">
                {listaAlertas.map((c) => (
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
