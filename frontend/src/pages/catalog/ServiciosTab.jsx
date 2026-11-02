import { useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Segmented, Select, Spinner, StatusBadge, TableWrap, td, th } from '../../components/ui.jsx';
import { post, put } from '../../lib/api.js';
import { formatCOP, formatNumber } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { RowActions, Toolbar, qs, useDebounced, useStatusToggle } from './shared.jsx';

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

export default function ServiciosTab({ canWrite, showMoney }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [categoriaId, setCategoriaId] = useState('');
  const [editing, setEditing] = useState(undefined); // undefined: cerrado · null: nuevo
  const debounced = useDebounced(q);

  const servicios = useResource(`/servicios${qs({ status, q: debounced, categoriaId })}`);
  const categorias = useResource('/categorias?status=all');
  const toggle = useStatusToggle('/servicios', 'servicio', servicios.reload);

  const list = servicios.data?.servicios ?? [];
  const catList = categorias.data?.categorias ?? [];
  const filtroCategorias = catList.filter((c) => c.status === 'active' || c.id === categoriaId);

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        status={status}
        setStatus={setStatus}
        placeholder="Buscar servicio…"
        onCreate={canWrite ? () => setEditing(null) : null}
        createLabel="Nuevo servicio"
      />
      {filtroCategorias.length > 0 && (
        <Segmented
          label="Filtrar por categoría"
          size="sm"
          className="scrollbar-none mb-4 max-w-full"
          value={categoriaId}
          onChange={setCategoriaId}
          options={[{ value: '', label: 'Todas' }, ...filtroCategorias.map((c) => ({ value: c.id, label: c.nombre }))]}
        />
      )}
      {servicios.error && <Alert className="mb-4">{servicios.error}</Alert>}
      {servicios.loading && !servicios.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={Stethoscope} title="No hay servicios">
            {canWrite && !categoriaId && !debounced ? 'Cree el primer servicio del catálogo.' : 'No hay servicios con este filtro.'}
          </EmptyState>
        </Card>
      ) : (
        <Card flush>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Servicio</th>
                <th className={th}>Categoría</th>
                {showMoney && <th className={`${th} text-right`}>Valor público</th>}
                {showMoney && <th className={`${th} text-right`}>Costo clínica</th>}
                <th className={`${th} text-right`}>Puntos</th>
                <th className={th}>Estado</th>
                {canWrite && <th className={`${th} text-right`}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="hover:bg-subtle/60">
                  <td className={`${td} font-semibold`}>{s.nombre}</td>
                  <td className={td}>
                    <Badge tone="muted">{s.categoriaNombre}</Badge>
                  </td>
                  {showMoney && <td className={`${td} tabular text-right font-semibold`}>{formatCOP(s.valorPublico)}</td>}
                  {showMoney && <td className={`${td} tabular text-right text-muted`}>{formatCOP(s.costoClinica)}</td>}
                  <td className={`${td} tabular text-right`}>{formatNumber(s.puntos)}</td>
                  <td className={td}>
                    <StatusBadge status={s.status} />
                  </td>
                  {canWrite && (
                    <td className={td}>
                      <RowActions onEdit={() => setEditing(s)} item={s} onToggle={() => toggle.ask(s)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {canWrite && editing !== undefined && (
        <ServicioModal
          initial={editing}
          categorias={catList}
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
