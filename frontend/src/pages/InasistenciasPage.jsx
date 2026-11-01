import { useState } from 'react';
import { CalendarX2, Phone } from 'lucide-react';
import { CANALES_CONTACTO, MOTIVOS_AUSENCIA, SlotPicker, addDays, formatFecha, todayBogota } from '../components/business.jsx';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Spinner, TableWrap, Textarea, td, th } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { post } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

function CierreModal({ cita, onClose, onSaved }) {
  const { can } = useAuth();
  const [form, setForm] = useState({ motivo: '', canalContacto: '', observacion: '' });
  const [reagendar, setReagendar] = useState(false);
  const [slot, setSlot] = useState({ fecha: addDays(todayBogota(), 1), hora: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await post('/cierres-ausencia', { citaId: cita.id, ...form, observacion: form.observacion || undefined, reagendar: reagendar ? slot : null });
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
      title="Cerrar inasistencia"
      description={`${cita.paciente.nombre} · ${formatFecha(cita.fecha)} ${cita.hora}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cierre-form" loading={saving} disabled={reagendar && !slot.hora}>
            {reagendar ? 'Cerrar y reagendar' : 'Cerrar seguimiento'}
          </Button>
        </>
      }
    >
      <form id="cierre-form" onSubmit={save} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 md:grid-cols-2">
          <Select label="Motivo" required value={form.motivo} onChange={set('motivo')}>
            <option value="">Seleccione…</option>
            {MOTIVOS_AUSENCIA.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Select label="Canal de contacto" required value={form.canalContacto} onChange={set('canalContacto')}>
            <option value="">Seleccione…</option>
            {CANALES_CONTACTO.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </div>
        <Textarea
          label="Observación"
          required={form.motivo === 'Otros'}
          hint={form.motivo === 'Otros' ? 'Obligatoria para el motivo "Otros".' : undefined}
          maxLength={1000}
          value={form.observacion}
          onChange={set('observacion')}
        />
        {can('MANAGE_APPOINTMENTS') && (
          <label className="touch-target flex items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" className="size-5" checked={reagendar} onChange={(e) => setReagendar(e.target.checked)} />
            <span className="text-sm font-semibold">El paciente reagenda: abrir calendario</span>
          </label>
        )}
        {reagendar && <SlotPicker value={slot} onChange={setSlot} />}
      </form>
    </Modal>
  );
}

export default function InasistenciasPage() {
  const pendientes = useResource('/cierres-ausencia/pendientes');
  const cerrados = useResource('/cierres-ausencia');
  const [cita, setCita] = useState(null);
  const lista = pendientes.data?.citas ?? [];

  return (
    <>
      <PageHeader title="Inasistencias" description="Seguimiento y cierre de citas a las que el paciente no asistió." />
      <h2 className="mb-3 font-bold">Pendientes de seguimiento ({lista.length})</h2>
      {pendientes.error && <Alert className="mb-4">{pendientes.error}</Alert>}
      {pendientes.loading && !pendientes.data ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarX2} title="Sin inasistencias pendientes" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 border-l-4 border-l-secondary p-4 md:p-4">
              <div>
                <p className="font-bold">{c.paciente.nombre}</p>
                <p className="text-xs text-muted">
                  {formatFecha(c.fecha)} · {c.hora} {c.servicio && `· ${c.servicio}`}
                </p>
              </div>
              <a href={`tel:${c.paciente.telefono.replace(/\s/g, '')}`} className="touch-target inline-flex items-center gap-2 text-sm font-semibold text-primary">
                <Phone className="size-4" aria-hidden /> {c.paciente.telefono}
              </a>
              <Button onClick={() => setCita(c)} className="mt-auto">
                Registrar seguimiento
              </Button>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-8 font-bold">Seguimientos cerrados</h2>
      {cerrados.loading && !cerrados.data ? (
        <Spinner />
      ) : (cerrados.data?.cierres ?? []).length === 0 ? (
        <Card>
          <EmptyState title="Aún no hay cierres" />
        </Card>
      ) : (
        <Card className="p-0 md:p-0">
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Paciente</th>
                <th className={th}>Cita</th>
                <th className={th}>Motivo</th>
                <th className={th}>Canal</th>
                <th className={th}>Reagendó</th>
                <th className={th}>Cerrado por</th>
              </tr>
            </thead>
            <tbody>
              {cerrados.data.cierres.map((x) => (
                <tr key={x.id}>
                  <td className={`${td} font-semibold`}>
                    {x.paciente}
                    {x.observacion && <p className="max-w-xs truncate text-xs font-normal text-muted">{x.observacion}</p>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {formatFecha(x.citaFecha)} {x.citaHora}
                  </td>
                  <td className={td}>
                    <Badge tone="secondary">{x.motivo}</Badge>
                  </td>
                  <td className={td}>{x.canalContacto}</td>
                  <td className={td}>{x.reagendo ? `${formatFecha(x.nuevaCita.fecha)} ${x.nuevaCita.hora}` : 'No'}</td>
                  <td className={`${td} text-xs text-muted`}>
                    {x.usuario}
                    <br />
                    {formatDateTime(x.fecha)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {cita && (
        <CierreModal
          cita={cita}
          onClose={() => setCita(null)}
          onSaved={() => {
            setCita(null);
            pendientes.reload();
            cerrados.reload();
          }}
        />
      )}
    </>
  );
}
