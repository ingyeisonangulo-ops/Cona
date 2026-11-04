import { useState } from 'react';
import { Cake, ChevronLeft, ChevronRight } from 'lucide-react';
import { MESES, todayBogota } from '../components/business.jsx';
import { Alert, Card, EmptyState, IconButton, PageHeader, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { useResource } from '../lib/useResource.js';

// Pacientes que cumplen años en un mes. Las flechas recorren los 12 meses en
// ciclo (de diciembre pasa a enero), sin importar el año.
export default function CumpleanerosPage() {
  const [mes, setMes] = useState(Number(todayBogota().slice(5, 7)));
  const res = useResource(`/pacientes/cumpleanos?mes=${mes}`);
  const lista = res.data?.mes === mes ? res.data.cumpleaneros : [];
  const sinFecha = res.data?.sinFecha ?? 0;
  const mover = (delta) => setMes((m) => ((m - 1 + delta + 12) % 12) + 1);

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
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && res.data?.mes !== mes ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <Card>
          <EmptyState icon={Cake} title={`Sin cumpleañeros en ${MESES[mes - 1].toLowerCase()}`} />
        </Card>
      ) : (
        <Card flush>
          <TableWrap minWidth="min-w-0">
            <thead>
              <tr>
                <th className={th}>Paciente</th>
                <th className={`${th} w-32 text-center`}>Día</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className="hover:bg-subtle/60">
                  <td className={`${td} font-semibold`}>{p.nombre}</td>
                  <td className={`${td} tabular text-center`}>{p.dia}</td>
                </tr>
              ))}
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
