import { useState } from 'react';
import { Cake, CalendarDays, ChartColumn, ChevronLeft, ChevronRight } from 'lucide-react';
import { MESES, todayBogota } from '../components/business.jsx';
import { Alert, Badge, Card, EmptyState, IconButton, PageHeader, Segmented, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { patch } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';

const TONO_DESCUENTO = { Aplicado: 'success', Pendiente: 'warning', Vencido: 'secondary', 'No aplica': 'muted' };

// Por mes del año en curso: cumpleañeros, felicitados y descuentos aplicados.
function Resumen() {
  const res = useResource('/pacientes/cumpleanos/resumen');
  const mesActual = Number(todayBogota().slice(5, 7));
  const meses = res.data?.meses ?? [];
  const suma = (campo) => meses.reduce((a, m) => a + m[campo], 0);

  if (res.error) return <Alert>{res.error}</Alert>;
  if (res.loading && !res.data) return <Spinner />;
  return (
    <Card flush>
      <TableWrap fixed minWidth="min-w-[520px]">
        <thead>
          <tr>
            <th className={`${th} w-[34%]`}>Mes {res.data?.anio}</th>
            <th className={`${th} text-center`}>Cumpleañeros</th>
            <th className={`${th} text-center`}>Felicitados</th>
            <th className={`${th} text-center`}>Descuento aplicado</th>
          </tr>
        </thead>
        <tbody>
          {meses.map((m) => (
            <tr key={m.mes} className={m.mes === mesActual ? 'bg-primary-soft/60' : 'hover:bg-subtle/60'}>
              <td className={`${td} font-semibold`}>{MESES[m.mes - 1]}</td>
              <td className={`${td} tabular text-center`}>{m.cumpleaneros}</td>
              <td className={`${td} tabular text-center`}>{m.felicitados}</td>
              <td className={`${td} tabular text-center`}>{m.descuentos}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="px-4 py-3">Total</td>
            <td className="tabular px-4 py-3 text-center">{suma('cumpleaneros')}</td>
            <td className="tabular px-4 py-3 text-center">{suma('felicitados')}</td>
            <td className="tabular px-4 py-3 text-center">{suma('descuentos')}</td>
          </tr>
        </tfoot>
      </TableWrap>
    </Card>
  );
}

const PESTANAS = [
  { value: 'mes', label: 'Cumpleañeros', icon: CalendarDays },
  { value: 'resumen', label: 'Resumen', icon: ChartColumn },
];

// Pacientes que cumplen años en un mes. Las flechas recorren los 12 meses en
// ciclo (de diciembre pasa a enero). Años, felicitación y descuento son del año
// en curso.
export default function CumpleanerosPage() {
  const hoy = todayBogota();
  const mesActual = Number(hoy.slice(5, 7));
  const diaActual = Number(hoy.slice(8, 10));
  const [pestana, setPestana] = useState('mes');
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
          pestana === 'mes' && (
            <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5">
              <IconButton label="Mes anterior" icon={ChevronLeft} onClick={() => mover(-1)} />
              <span className="min-w-28 text-center text-sm font-semibold" aria-live="polite">
                {MESES[mes - 1]}
              </span>
              <IconButton label="Mes siguiente" icon={ChevronRight} onClick={() => mover(1)} />
            </div>
          )
        }
      />
      <Segmented label="Secciones de cumpleañeros" className="mb-5" value={pestana} onChange={setPestana} options={PESTANAS} />
      {pestana === 'resumen' && <Resumen />}
      {pestana === 'mes' && (res.error || error) && <Alert className="mb-4">{res.error || error}</Alert>}
      {pestana === 'resumen' ? null : res.loading && res.data?.mes !== mes ? (
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
                      <Badge tone={TONO_DESCUENTO[p.descuento]} dot>
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
      {pestana === 'mes' && sinFecha > 0 && (
        <p className="mt-4 text-sm text-muted">
          {sinFecha === 1 ? '1 paciente no tiene' : `${sinFecha} pacientes no tienen`} fecha de nacimiento registrada. Se puede agregar editando sus datos en Pacientes.
        </p>
      )}
    </>
  );
}
