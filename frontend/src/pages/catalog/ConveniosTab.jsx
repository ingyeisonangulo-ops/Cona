import { useState } from 'react';
import { BadgePercent, Building2, Pencil } from 'lucide-react';
import { IconButton, Alert, Badge, Button, Card, EmptyState, Input, Modal, Spinner, StatusBadge } from '../../components/ui.jsx';
import { post, put } from '../../lib/api.js';
import { useResource } from '../../lib/useResource.js';
import { StatusToggleButton, Toolbar, qs, useDebounced, useStatusToggle } from './shared.jsx';

function ConvenioModal({ initial, categorias, onClose, onSaved }) {
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [entidad, setEntidad] = useState(initial?.entidad ?? '');
  // Porcentajes como texto para permitir campos vacíos (= sin descuento).
  const [pct, setPct] = useState(() =>
    Object.fromEntries(Object.entries(initial?.porcentajeDescuentoCategoria ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const visibles = categorias.filter((c) => c.status === 'active' || pct[c.id] !== undefined);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const porcentajeDescuentoCategoria = Object.fromEntries(
      Object.entries(pct)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => [k, Number(v)]),
    );
    const body = { nombre, entidad, porcentajeDescuentoCategoria };
    try {
      if (initial) await put(`/convenios/${initial.id}`, body);
      else await post('/convenios', body);
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
      title={initial ? 'Editar convenio' : 'Nuevo convenio'}
      description="Defina el porcentaje de descuento por categoría. Deje vacío para no aplicar descuento."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="convenio-form" loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="convenio-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Nombre del convenio" required maxLength={160} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input label="Entidad" required maxLength={200} value={entidad} onChange={(e) => setEntidad(e.target.value)} />
        </div>
        <fieldset className="rounded-2xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Descuento por categoría (%)</legend>
          {visibles.length === 0 ? (
            <p className="text-sm text-muted">No hay categorías activas.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {visibles.map((c) => (
                <label key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-2">
                  <span className="text-sm font-medium">{c.nombre}</span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={pct[c.id] ?? ''}
                      onChange={(e) => setPct((p) => ({ ...p, [c.id]: e.target.value }))}
                      aria-label={`Descuento para ${c.nombre}`}
                      className="touch-target w-24 rounded-lg border border-line bg-surface px-2 text-right text-base focus:border-primary focus:outline-none md:text-sm"
                    />
                    <span className="text-sm text-muted">%</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export default function ConveniosTab({ canWrite }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(undefined);
  const debounced = useDebounced(q);
  const res = useResource(`/convenios${qs({ status, q: debounced })}`);
  const categorias = useResource('/categorias?status=all');
  const toggle = useStatusToggle('/convenios', 'convenio', res.reload);
  const list = res.data?.convenios ?? [];
  const catName = Object.fromEntries((categorias.data?.categorias ?? []).map((c) => [c.id, c.nombre]));

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        status={status}
        setStatus={setStatus}
        placeholder="Buscar convenio o entidad…"
        onCreate={canWrite ? () => setEditing(null) : null}
        createLabel="Nuevo convenio"
      />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !res.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={BadgePercent} title="No hay convenios" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => {
            const descuentos = Object.entries(c.porcentajeDescuentoCategoria ?? {});
            return (
              <Card key={c.id} compact className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold leading-snug">{c.nombre}</h3>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                      <Building2 className="size-4 shrink-0" aria-hidden /> {c.entidad}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {descuentos.length === 0 ? (
                    <Badge tone="muted">Sin descuentos</Badge>
                  ) : (
                    descuentos.map(([id, p]) => (
                      <Badge key={id} tone="secondary">
                        {catName[id] ?? 'Categoría'} · {p}%
                      </Badge>
                    ))
                  )}
                </div>
                {canWrite && (
                  <div className="mt-auto flex justify-end gap-1 border-t border-line pt-2">
                    <IconButton label="Editar" icon={Pencil} onClick={() => setEditing(c)} className="hover:bg-primary-soft hover:text-primary" />
                    <StatusToggleButton item={c} onClick={() => toggle.ask(c)} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {canWrite && editing !== undefined && (
        <ConvenioModal
          initial={editing}
          categorias={categorias.data?.categorias ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            res.reload();
          }}
        />
      )}
      {toggle.modal}
    </>
  );
}
