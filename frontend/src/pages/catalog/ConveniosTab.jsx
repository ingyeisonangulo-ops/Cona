import { useState } from 'react';
import { BadgePercent, Check } from 'lucide-react';
import { porcentajeUnico } from '../../components/business.jsx';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Spinner, StatusBadge, TableWrap, cx, td, th } from '../../components/ui.jsx';
import { post, put } from '../../lib/api.js';
import { useResource } from '../../lib/useResource.js';
import { RowActions, Toolbar, qs, useDebounced, useStatusToggle } from './shared.jsx';

// Un convenio tiene un solo porcentaje de descuento que se aplica a las
// categorías elegidas. Se guarda en el mismo formato { categoriaId: % } que
// usa el cálculo del servidor, con el mismo valor para cada categoría.
function ConvenioModal({ initial, categorias, onClose, onSaved }) {
  const actual = initial?.porcentajeDescuentoCategoria ?? {};
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [entidad, setEntidad] = useState(initial?.entidad ?? '');
  const [pct, setPct] = useState(() => {
    const p = porcentajeUnico(actual);
    return p == null ? '' : String(p);
  });
  const activas = categorias.filter((c) => c.status === 'active' || actual[c.id] !== undefined);
  // Nuevo convenio: todas las categorías activas marcadas.
  const [sel, setSel] = useState(() => new Set(initial ? Object.keys(actual) : activas.map((c) => c.id)));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // El convenio Cumpleaños es del sistema: solo se edita su porcentaje, que rige
  // para todas las categorías.
  const sistema = initial?.tipo === 'cumpleanos';
  const mixto = !sistema && new Set(Object.values(actual).map(Number)).size > 1;
  const todas = activas.length > 0 && activas.every((c) => sel.has(c.id));

  function toggle(id) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const cubiertas = sistema ? activas.map((c) => c.id) : [...sel];
    if (pct !== '' && cubiertas.length === 0) return setError('Seleccione al menos una categoría para aplicar el descuento.');
    setSaving(true);
    setError('');
    const porcentajeDescuentoCategoria = pct === '' ? {} : Object.fromEntries(cubiertas.map((id) => [id, Number(pct)]));
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
      title={sistema ? 'Convenio Cumpleaños' : initial ? 'Editar convenio' : 'Nuevo convenio'}
      description={
        sistema
          ? 'Se puede usar solo en el mes de cumpleaños del paciente, un día al mes, sobre toda la cuenta de ese día.'
          : 'Un solo porcentaje de descuento para las categorías que cubre el convenio.'
      }
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
        {!sistema && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Nombre del convenio" required maxLength={160} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <Input label="Entidad" required maxLength={200} value={entidad} onChange={(e) => setEntidad(e.target.value)} />
          </div>
        )}
        <Input
          label="Porcentaje de descuento (%)"
          type="number"
          inputMode="decimal"
          min="0"
          max="100"
          step="0.01"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          hint={mixto ? 'Este convenio tenía porcentajes distintos por categoría; al guardar quedará uno solo.' : 'Deje vacío para no aplicar descuento.'}
          className="md:max-w-xs"
        />
        {!sistema && (
        <fieldset className="rounded-2xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Categorías que cubre</legend>
          {activas.length === 0 ? (
            <p className="text-sm text-muted">No hay categorías activas.</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSel(todas ? new Set() : new Set(activas.map((c) => c.id)))}
                className="mb-3 text-sm font-semibold text-primary hover:underline"
              >
                {todas ? 'Quitar todas' : 'Seleccionar todas'}
              </button>
              <div className="flex flex-wrap gap-2">
                {activas.map((c) => {
                  const on = sel.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(c.id)}
                      className={cx(
                        'touch-target inline-flex items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
                        on ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-muted hover:text-text',
                      )}
                    >
                      {on && <Check className="size-4" aria-hidden />}
                      {c.nombre}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </fieldset>
        )}
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
  const catList = categorias.data?.categorias ?? [];
  const catName = Object.fromEntries(catList.map((c) => [c.id, c.nombre]));
  const totalActivas = catList.filter((c) => c.status === 'active').length;

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
        <Card flush>
          <TableWrap fixed minWidth="min-w-[820px]">
            <thead>
              <tr>
                <th className={`${th} w-[20%]`}>Convenio</th>
                <th className={`${th} w-[24%]`}>Entidad</th>
                <th className={`${th} w-[12%] text-center`}>Descuento</th>
                <th className={`${th} text-center`}>Categorías</th>
                <th className={`${th} w-[12%] text-center`}>Estado</th>
                {canWrite && <th className={`${th} w-28 text-center`}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const ids = Object.keys(c.porcentajeDescuentoCategoria ?? {});
                const p = porcentajeUnico(c.porcentajeDescuentoCategoria);
                const cubreTodas = totalActivas > 0 && catList.filter((x) => x.status === 'active').every((x) => ids.includes(x.id));
                return (
                  <tr key={c.id} className="hover:bg-subtle/60">
                    <td className={`${td} font-semibold`}>{c.nombre}</td>
                    <td className={`${td} text-muted`}>{c.entidad}</td>
                    <td className={`${td} tabular text-center font-display text-base font-bold`}>{p == null ? '—' : `${p}%`}</td>
                    <td className={`${td} text-center`}>
                      {ids.length === 0 ? (
                        <span className="text-xs text-faint">Sin descuento</span>
                      ) : cubreTodas || c.tipo === 'cumpleanos' ? (
                        <Badge tone="primary">Todas</Badge>
                      ) : (
                        <span className="flex flex-wrap justify-center gap-1">
                          {ids.map((id) => (
                            <Badge key={id} tone="muted">
                              {catName[id] ?? 'Categoría'}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-center`}>
                      <StatusBadge status={c.status} />
                    </td>
                    {canWrite && (
                      <td className={td}>
                        <RowActions centered item={c} onEdit={() => setEditing(c)} onToggle={() => toggle.ask(c)} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {canWrite && editing !== undefined && (
        <ConvenioModal
          initial={editing}
          categorias={catList}
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
