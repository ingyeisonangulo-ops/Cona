import { useEffect, useState } from 'react';
import { Pencil, Plus, Power, PowerOff, Search } from 'lucide-react';
import { Button, ConfirmModal, IconButton } from '../../components/ui.jsx';
import { patch } from '../../lib/api.js';

export function Toolbar({ q, setQ, status, setStatus, onCreate, createLabel, placeholder }) {
  return (
    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
      <label className="relative flex-1">
        <span className="sr-only">Buscar</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="touch-target w-full rounded-xl border border-line bg-surface pl-10 pr-3.5 text-base focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 md:text-sm"
        />
      </label>
      <div className="flex gap-2">
        <select
          aria-label="Filtrar por estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="touch-target flex-1 rounded-xl border border-line bg-surface px-3 text-base focus:border-primary focus:outline-none md:flex-none md:text-sm"
        >
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        {onCreate && (
          <Button icon={Plus} onClick={onCreate} className="whitespace-nowrap">
            <span className="hidden xs:inline">{createLabel}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

// Acciones de una fila del catálogo: editar y activar/desactivar.
export function RowActions({ item, onEdit, onToggle, centered = false }) {
  return (
    <div className={`flex gap-1 ${centered ? 'justify-center' : 'justify-end'}`}>
      <IconButton label="Editar" icon={Pencil} onClick={onEdit} className="hover:bg-primary-soft hover:text-primary" />
      <StatusToggleButton item={item} onClick={onToggle} />
    </div>
  );
}

export function StatusToggleButton({ item, onClick }) {
  const active = item.status === 'active';
  return (
    <IconButton
      label={active ? 'Desactivar' : 'Activar'}
      icon={active ? PowerOff : Power}
      onClick={onClick}
      className={active ? 'hover:bg-secondary-soft hover:text-secondary' : 'hover:bg-success-soft hover:text-success'}
    />
  );
}

// Confirmación + PATCH /:id/status reutilizable para las tres entidades.
export function useStatusToggle(basePath, entityLabel, onDone) {
  const [target, setTarget] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setTarget(null);
    setError('');
  };

  async function confirm() {
    setLoading(true);
    setError('');
    try {
      await patch(`${basePath}/${target.id}/status`, { status: target.status === 'active' ? 'inactive' : 'active' });
      close();
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const deactivating = target?.status === 'active';
  const modal = (
    <ConfirmModal
      open={Boolean(target)}
      title={deactivating ? `Desactivar ${entityLabel}` : `Activar ${entityLabel}`}
      message={
        deactivating
          ? `“${target?.nombre}” dejará de estar disponible para nuevos registros. El historial se conserva.`
          : `“${target?.nombre}” volverá a estar disponible.`
      }
      confirmLabel={deactivating ? 'Desactivar' : 'Activar'}
      tone={deactivating ? 'danger' : 'primary'}
      loading={loading}
      error={error}
      onConfirm={confirm}
      onClose={close}
    />
  );
  return { ask: setTarget, modal };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function qs(params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  return s.toString() ? `?${s}` : '';
}
