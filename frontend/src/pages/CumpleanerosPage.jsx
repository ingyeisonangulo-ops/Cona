import { useState } from 'react';
import { Cake, ChevronLeft, ChevronRight, Percent } from 'lucide-react';
import { MESES, todayBogota } from '../components/business.jsx';
import { Alert, Badge, Button, Card, EmptyState, IconButton, Input, PageHeader, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { patch, put } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';

// El Gerente define el porcentaje; el resto del personal solo lo ve.
function DescuentoCumpleanos({ porcentaje, onSaved }) {
  const { can } = useAuth();
  const [valor, setValor] = useState(null); // null: sin editar
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activo = porcentaje > 0;

  async function guardar(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await put('/configuracion/cumpleanos', { porcentaje: Number(valor) });
      setValor(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card compact className="mb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Percent className="size-[18px]" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">Descuento de cumpleaños: {activo ? `${porcentaje}%` : 'sin definir'}</p>
            <p className="text-xs text-muted">Para los servicios del mes de cumpleaños. Si hay convenio, se aplica el mayor de los dos.</p>
          </div>
        </div>
        {can('MANAGE_COLLABORATORS') &&
          (valor === null ? (
            <Button variant="outline" onClick={() => setValor(String(porcentaje))}>
              {activo ? 'Cambiar' : 'Definir'}
            </Button>
          ) : (
            <form onSubmit={guardar} className="flex items-end gap-2">
              <Input
                label="Porcentaje (%)"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                required
                autoFocus
                className="w-32"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <Button variant="outline" onClick={() => setValor(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={saving}>
                Guardar
              </Button>
            </form>
          ))}
      </div>
      {error && <Alert className="mt-3">{error}</Alert>}
    </Card>
  );
}

// Pacientes que cumplen años en un mes. Las flechas recorren los 12 meses en
// ciclo (de diciembre pasa a enero). Años, felicitación y descuento son del año
// en curso.
export default function CumpleanerosPage() {
  const hoy = todayBogota();
  const mesActual = Number(hoy.slice(5, 7));
  const diaActual = Number(hoy.slice(8, 10));
  const [mes, setMes] = useState(mesActual);
  const [marcando, setMarcando] = useState(null);
  const [error, setError] = useState('');
  const res = useResource(`/pacientes/cumpleanos?mes=${mes}`);
  const lista = res.data?.mes === mes ? res.data.cumpleaneros : [];
  const sinFecha = res.data?.sinFecha ?? 0;
  const mover = (delta) => setMes((m) => ((m - 1 + delta + 12) % 12) + 1);

  async function marcar(paciente, felicitado) {
    setMarcando(paciente.id);
    setError('');
    try {
      await patch(`/pacientes/${paciente.id}/felicitacion`, { felicitado });
      await res.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setMarcando(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        title="Cumpleañeros"
        description="Pacientes que cumplen años en el mes."
        actions={
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5">
            <IconButton label="Mes anterior" icon={ChevronLeft} onClick={() => mover(-1)} />
            <span className="min-w-28 text-center text-sm font-semibold" aria-live="polite">
              {MESES[mes - 1]}
            </span>
            <IconButton label="Mes siguiente" icon={ChevronRight} onClick={() => mover(1)} />
          </div>
        }
      />
      {res.data && <DescuentoCumpleanos porcentaje={res.data.descuentoPct} onSaved={res.reload} />}
      {(res.error || error) && <Alert className="mb-4">{res.error || error}</Alert>}
      {res.loading && res.data?.mes !== mes ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <Card>
          <EmptyState icon={Cake} title={`Sin cumpleañeros en ${MESES[mes - 1].toLowerCase()}`} />
        </Card>
      ) : (
        <Card flush>
          <TableWrap fixed minWidth="min-w-[620px]">
            <thead>
              <tr>
                <th className={`${th} w-[38%]`}>Paciente</th>
                <th className={`${th} text-center`}>Día</th>
                <th className={`${th} text-center`}>Años</th>
                <th className={`${th} text-center`}>Felicitación</th>
                <th className={`${th} text-center`}>Descuento</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const esHoy = mes === mesActual && p.dia === diaActual;
                return (
                  <tr key={p.id} className="hover:bg-subtle/60">
                    <td className={`${td} font-semibold`}>{p.nombre}</td>
                    <td className={`${td} text-center`}>
                      <span
                        className={`tabular inline-grid size-8 place-items-center rounded-full ${esHoy ? 'bg-yellow-300 font-bold text-ink' : ''}`}
                        title={esHoy ? 'Cumple años hoy' : undefined}
                      >
                        {p.dia}
                      </span>
                      {esHoy && <span className="sr-only">(cumple años hoy)</span>}
                    </td>
                    <td className={`${td} tabular text-center`}>{p.anios}</td>
                    <td className={`${td} text-center`}>
                      <label className="touch-target inline-grid cursor-pointer place-items-center">
                        <span className="sr-only">Felicitación a {p.nombre}</span>
                        <input
                          type="checkbox"
                          className="size-5 cursor-pointer accent-primary"
                          checked={p.felicitado}
                          disabled={marcando === p.id}
                          onChange={(e) => marcar(p, e.target.checked)}
                        />
                      </label>
                    </td>
                    <td className={`${td} text-center`}>
                      <Badge tone={p.descuento === 'Aplicado' ? 'success' : 'warning'} dot>
                        {p.descuento}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {sinFecha > 0 && (
        <p className="mt-4 text-sm text-muted">
          {sinFecha === 1 ? '1 paciente no tiene' : `${sinFecha} pacientes no tienen`} fecha de nacimiento registrada. Se puede agregar editando sus datos en Pacientes.
        </p>
      )}
    </>
  );
}
