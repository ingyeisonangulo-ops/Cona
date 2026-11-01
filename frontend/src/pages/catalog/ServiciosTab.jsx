import { useState } from 'react';
import { Pencil, Stethoscope } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner, StatusBadge, TableWrap, td, th } from '../../components/ui.jsx';
import { post, put } from '../../lib/api.js';
import { formatCOP, formatNumber } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { StatusToggleButton, Toolbar, qs, useDebounced, useStatusToggle } from './shared.jsx';

const EMPTY = { categoriaId: '', nombre: '', valorPublico: '', costoClinica: '', puntos: '0' };

// Se monta solo mientras está abierto: el estado inicial sale de `initial`.
function ServicioModal({ initial, categorias, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    initial
      ? {
          categoriaId: initial.categoriaId,
          nombre: initial.nombre,
          valorPublico: String(initial.valorPublico),
          costoClinica: String(initial.costoClinica),
          puntos: String(initial.puntos),
        }
      : EMPTY,
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const margin = Number(form.valorPublico || 0) - Number(form.costoClinica || 0);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = {
      categoriaId: form.categoriaId,
      nombre: form.nombre,
      valorPublico: Number(form.valorPublico),
      costoClinica: Number(form.costoClinica),
      puntos: Number(form.puntos),
    };
    try {
      if (initial) await put(`/servicios/${initial.id}`, body);
      else await post('/servicios', body);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Al editar, la categoría actual se muestra aunque esté inactiva.
  const options = categorias.filter((c) => c.status === 'active' || c.id === initial?.categoriaId);

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Editar servicio' : 'Nuevo servicio'}
      description="Valores en pesos colombianos (COP)."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="servicio-form" loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="servicio-form" onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
        {error && <Alert className="md:col-span-2">{error}</Alert>}
        <Select label="Categoría" required value={form.categoriaId} onChange={set('categoriaId')} className="md:col-span-2">
          <option value="">Seleccione…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {c.status !== 'active' ? ' (inactiva)' : ''}
            </option>
          ))}
        </Select>
        <Input label="Nombre del servicio" required maxLength={160} value={form.nombre} onChange={set('nombre')} className="md:col-span-2" />
        <Input label="Valor al público" type="number" inputMode="decimal" min="0" step="0.01" required value={form.valorPublico} onChange={set('valorPublico')} />
        <Input label="Costo clínica" type="number" inputMode="decimal" min="0" step="0.01" required value={form.costoClinica} onChange={set('costoClinica')} />
        <Input label="Puntos" type="number" inputMode="numeric" min="0" step="1" required value={form.puntos} onChange={set('puntos')} hint="Puntos para el progreso del colaborador." />
        <div className="flex flex-col justify-center rounded-xl bg-primary-soft px-4 py-3">
          <span className="text-xs font-medium text-brand-dark/80">Margen estimado</span>
          <span className={`text-lg font-bold ${margin < 0 ? 'text-secondary' : 'text-brand-dark'}`}>{formatCOP(margin)}</span>
        </div>
      </form>
    </Modal>
  );
}

export default function ServiciosTab({ canWrite }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [view, setView] = useState('grid');
  const [editing, setEditing] = useState(undefined); // undefined: cerrado · null: nuevo
  const debounced = useDebounced(q);

  const servicios = useResource(`/servicios${qs({ status, q: debounced })}`);
  const categorias = useResource('/categorias?status=all');
  const toggle = useStatusToggle('/servicios', 'servicio', servicios.reload);

  const list = servicios.data?.servicios ?? [];

  const actions = (s) =>
    canWrite && (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" icon={Pencil} onClick={() => setEditing(s)} className="px-3">
          Editar
        </Button>
        <StatusToggleButton item={s} onClick={() => toggle.ask(s)} />
      </div>
    );

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        status={status}
        setStatus={setStatus}
        view={view}
        setView={setView}
        placeholder="Buscar servicio…"
        onCreate={canWrite ? () => setEditing(null) : null}
        createLabel="Nuevo servicio"
      />
      {servicios.error && <Alert className="mb-4">{servicios.error}</Alert>}
      {servicios.loading && !servicios.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={Stethoscope} title="No hay servicios">
            {canWrite ? 'Cree el primer servicio del catálogo.' : 'Aún no hay servicios con este filtro.'}
          </EmptyState>
        </Card>
      ) : view === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <Card key={s.id} className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Badge>{s.categoriaNombre}</Badge>
                  <h3 className="mt-2 font-bold leading-snug text-text">{s.nombre}</h3>
                </div>
                <StatusBadge status={s.status} />
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Público</dt>
                  <dd className="font-bold text-primary">{formatCOP(s.valorPublico)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Costo</dt>
                  <dd className="font-semibold">{formatCOP(s.costoClinica)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Puntos</dt>
                  <dd className="font-semibold">{formatNumber(s.puntos)}</dd>
                </div>
              </dl>
              {canWrite && <div className="mt-auto border-t border-line pt-4">{actions(s)}</div>}
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-0 md:p-0">
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Servicio</th>
                <th className={th}>Categoría</th>
                <th className={`${th} text-right`}>Valor público</th>
                <th className={`${th} text-right`}>Costo clínica</th>
                <th className={`${th} text-right`}>Puntos</th>
                <th className={th}>Estado</th>
                {canWrite && <th className={th}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="hover:bg-bg/60">
                  <td className={`${td} font-semibold`}>{s.nombre}</td>
                  <td className={td}>{s.categoriaNombre}</td>
                  <td className={`${td} text-right font-semibold text-primary`}>{formatCOP(s.valorPublico)}</td>
                  <td className={`${td} text-right`}>{formatCOP(s.costoClinica)}</td>
                  <td className={`${td} text-right`}>{formatNumber(s.puntos)}</td>
                  <td className={td}>
                    <StatusBadge status={s.status} />
                  </td>
                  {canWrite && <td className={td}>{actions(s)}</td>}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {canWrite && editing !== undefined && (
        <ServicioModal
          initial={editing}
          categorias={categorias.data?.categorias ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            servicios.reload();
          }}
        />
      )}
      {toggle.modal}
    </>
  );
}
