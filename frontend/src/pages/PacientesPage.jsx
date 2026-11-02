import { useState } from 'react';
import { History, Pencil, Search, UserRound } from 'lucide-react';
import { EstadoBadge, MEDIOS_ORIGEN, formatFecha } from '../components/business.jsx';
import { Alert, Badge, Button, Card, EmptyState, IconButton, Input, Modal, PageHeader, Select, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { put } from '../lib/api.js';
import { formatCOP } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import { useDebounced } from './catalog/shared.jsx';

function HistorialModal({ paciente, onClose }) {
  const res = useResource(`/pacientes/${paciente.id}/historial`);
  const d = res.data;
  return (
    <Modal open size="lg" onClose={onClose} title={`${paciente.nombre} ${paciente.apellido}`} description={`Cédula ${paciente.cedula} · ${paciente.telefono}`}>
      {res.loading ? (
        <Spinner />
      ) : res.error ? (
        <Alert>{res.error}</Alert>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <h3 className="mb-2 font-bold">Servicios realizados ({d.servicios.length})</h3>
            {d.servicios.length === 0 ? (
              <p className="text-sm text-muted">Sin servicios registrados.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {d.servicios.map((s) => (
                  <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm ${s.estado === 'anulado' ? 'opacity-60' : ''}`}>
                    <div>
                      <p className="font-semibold">{s.servicio}</p>
                      <p className="text-xs text-muted">
                        {formatFecha(s.fecha)} · {s.colaborador}
                        {s.convenio ? ` · ${s.convenio}` : ''}
                      </p>
                    </div>
                    <span className="font-semibold">
                      {formatCOP(s.valorCobrado)} {s.estado === 'anulado' && <Badge tone="secondary">Anulado</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 font-bold">Citas ({d.citas.length})</h3>
            {d.citas.length === 0 ? (
              <p className="text-sm text-muted">Sin citas.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {d.citas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <span>
                      {formatFecha(c.fecha)} · {c.hora} {c.servicio && `· ${c.servicio}`} {c.tipo !== 'normal' && <Badge tone="muted">{c.tipo}</Badge>}
                    </span>
                    <EstadoBadge estado={c.estado} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function EditModal({ paciente, onClose, onSaved }) {
  const [form, setForm] = useState({ nombre: paciente.nombre, apellido: paciente.apellido, telefono: paciente.telefono, medioOrigen: paciente.medioOrigen });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await put(`/pacientes/${paciente.id}`, form);
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
      onClose={onClose}
      title="Editar datos de contacto"
      description={`Cédula ${paciente.cedula} (no modificable)`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="pac-edit" loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="pac-edit" onSubmit={save} className="grid gap-4 md:grid-cols-2">
        {error && <Alert className="md:col-span-2">{error}</Alert>}
        <Input label="Nombre" value={form.nombre} onChange={set('nombre')} />
        <Input label="Apellido" value={form.apellido} onChange={set('apellido')} />
        <Input label="Teléfono" type="tel" value={form.telefono} onChange={set('telefono')} />
        <Select label="Medio de origen" value={form.medioOrigen} onChange={set('medioOrigen')}>
          {MEDIOS_ORIGEN.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </form>
    </Modal>
  );
}

export default function PacientesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const res = useResource(`/pacientes?q=${encodeURIComponent(debounced)}`);
  const [modal, setModal] = useState(null);
  const list = res.data?.pacientes ?? [];

  return (
    <>
      <PageHeader title="Pacientes" description="Búsqueda por cédula o nombre (máx. 50 resultados)." />
      <label className="relative mb-4 block">
        <span className="sr-only">Buscar paciente</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cédula, nombre o apellido…"
          className="touch-target w-full rounded-xl border border-line bg-surface pl-10 pr-3.5 text-base focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 md:text-sm"
        />
      </label>
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !res.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={UserRound} title="Sin resultados" />
        </Card>
      ) : (
        <Card flush>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Paciente</th>
                <th className={th}>Cédula</th>
                <th className={th}>Teléfono</th>
                <th className={th}>Origen</th>
                <th className={th}>Registro</th>
                <th className={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-bg/60">
                  <td className={`${td} font-semibold`}>
                    {p.nombre} {p.apellido}
                  </td>
                  <td className={`${td} font-mono`}>{p.cedula}</td>
                  <td className={td}>{p.telefono}</td>
                  <td className={td}>
                    <Badge tone="muted">{p.medioOrigen}</Badge>
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatFecha(p.fechaRegistro)}</td>
                  <td className={td}>
                    <div className="flex gap-1">
                      {can('VIEW_PATIENT_HISTORY') && <IconButton label="Historial" icon={History} onClick={() => setModal({ kind: 'hist', p })} />}
                      {can('REGISTER_SERVICES') && <IconButton label="Editar contacto" icon={Pencil} onClick={() => setModal({ kind: 'edit', p })} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {modal?.kind === 'hist' && <HistorialModal paciente={modal.p} onClose={() => setModal(null)} />}
      {modal?.kind === 'edit' && (
        <EditModal
          paciente={modal.p}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            res.reload();
          }}
        />
      )}
    </>
  );
}
