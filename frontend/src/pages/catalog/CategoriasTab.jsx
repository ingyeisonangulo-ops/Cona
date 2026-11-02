import { useState } from 'react';
import { FolderTree, Pencil } from 'lucide-react';
import { IconButton, Alert, Button, Card, EmptyState, Input, Modal, Spinner, StatusBadge } from '../../components/ui.jsx';
import { post, put } from '../../lib/api.js';
import { formatNumber } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { StatusToggleButton, Toolbar, qs, useDebounced, useStatusToggle } from './shared.jsx';

function CategoriaModal({ initial, onClose, onSaved }) {
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (initial) await put(`/categorias/${initial.id}`, { nombre });
      else await post('/categorias', { nombre });
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
      title={initial ? 'Editar categoría' : 'Nueva categoría'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="categoria-form" loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="categoria-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Input label="Nombre" required maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </form>
    </Modal>
  );
}

export default function CategoriasTab({ canWrite }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(undefined);
  const debounced = useDebounced(q);
  const res = useResource(`/categorias${qs({ status, q: debounced })}`);
  const toggle = useStatusToggle('/categorias', 'categoría', res.reload);
  const list = res.data?.categorias ?? [];

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        status={status}
        setStatus={setStatus}
        placeholder="Buscar categoría…"
        onCreate={canWrite ? () => setEditing(null) : null}
        createLabel="Nueva categoría"
      />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !res.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={FolderTree} title="No hay categorías" />
        </Card>
      ) : (
        <div className="grid gap-3 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map((c) => (
            <Card key={c.id} compact className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-white">
                  <FolderTree className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold leading-snug">{c.nombre}</h3>
                  <p className="text-xs text-muted">{formatNumber(c.serviciosCount)} servicio(s)</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              {canWrite && (
                <div className="mt-auto flex justify-end gap-1 border-t border-line pt-2">
                  <IconButton label="Editar" icon={Pencil} onClick={() => setEditing(c)} className="hover:bg-primary-soft hover:text-primary" />
                  <StatusToggleButton item={c} onClick={() => toggle.ask(c)} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {canWrite && editing !== undefined && (
        <CategoriaModal
          initial={editing}
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
