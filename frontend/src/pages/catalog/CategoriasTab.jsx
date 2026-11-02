import { useState } from 'react';
import { FolderTree } from 'lucide-react';
import { Alert, Button, Card, EmptyState, Input, Modal, Spinner, StatusBadge, TableWrap, td, th } from '../../components/ui.jsx';
import { post, put } from '../../lib/api.js';
import { ColumnChart } from '../../components/charts.jsx';
import { formatNumber } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { RowActions, Toolbar, qs, useDebounced, useStatusToggle } from './shared.jsx';

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
        <div className="grid gap-5 lg:grid-cols-5">
          <Card flush className="lg:col-span-3" title="Categorías" description={`${list.length} categoría(s)`}>
            <TableWrap fixed minWidth="min-w-[480px]">
              <thead>
                <tr>
                  <th className={`${th} w-[46%]`}>Categoría</th>
                  <th className={`${th} text-center`}>Servicios</th>
                  <th className={`${th} text-center`}>Estado</th>
                  {canWrite && <th className={`${th} w-28 text-center`}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="hover:bg-subtle/60">
                    <td className={td}>
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                          <FolderTree className="size-4" aria-hidden />
                        </span>
                        <span className="truncate font-semibold">{c.nombre}</span>
                      </span>
                    </td>
                    <td className={`${td} tabular text-center font-semibold`}>{formatNumber(c.serviciosCount)}</td>
                    <td className={`${td} text-center`}>
                      <StatusBadge status={c.status} />
                    </td>
                    {canWrite && (
                      <td className={td}>
                        <RowActions centered item={c} onEdit={() => setEditing(c)} onToggle={() => toggle.ask(c)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <ColumnChart
            className="lg:col-span-2"
            title="Servicios por categoría"
            description="Cantidad de servicios del catálogo en cada categoría"
            unit="servicios"
            height={220}
            data={list.map((c) => ({ label: c.nombre, value: Number(c.serviciosCount) }))}
          />
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
