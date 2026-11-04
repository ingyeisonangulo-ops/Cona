import { useState } from 'react';
import { ChevronLeft, ChevronRight, CircleDollarSign, Receipt, Stethoscope, Wallet } from 'lucide-react';
import { MESES, todayBogota } from '../components/business.jsx';
import { AreaChart, ColumnChart, DonutChart, OTHER, SERIES } from '../components/charts.jsx';
import { Alert, Card, IconButton, PageHeader, Spinner, StatCard, TableWrap, td, th } from '../components/ui.jsx';
import { formatCOP, formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

const NOMBRE_GENERO = { F: 'Mujeres', M: 'Hombres', 'Sin dato': 'Sin dato' };
const COLOR_GENERO = { F: SERIES[0], M: SERIES[1], 'Sin dato': OTHER };
const suma = (lista, campo) => lista.reduce((a, x) => a + x[campo], 0);

// Quién usa los servicios: pacientes atendidos, servicios e ingresos por grupo.
function TablaGrupos({ title, description, grupos, nombre = (g) => g }) {
  return (
    <Card flush title={title} description={description}>
      <TableWrap minWidth="min-w-[420px]">
        <thead>
          <tr>
            <th className={th}>Grupo</th>
            <th className={`${th} text-right`}>Pacientes</th>
            <th className={`${th} text-right`}>Servicios</th>
            <th className={`${th} text-right`}>Ingresos</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.grupo} className="hover:bg-subtle/60">
              <td className={`${td} font-semibold`}>{nombre(g.grupo)}</td>
              <td className={`${td} tabular text-right`}>{formatNumber(g.pacientes)}</td>
              <td className={`${td} tabular text-right`}>{formatNumber(g.servicios)}</td>
              <td className={`${td} tabular text-right`}>{formatCOP(g.ingreso)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

export default function MetricasPage() {
  const anioActual = Number(todayBogota().slice(0, 4));
  const [anio, setAnio] = useState(anioActual);
  const res = useResource(`/tablero/metricas?anio=${anio}`);
  const m = res.data?.anio === anio ? res.data : null;

  const totales = m && {
    servicios: suma(m.meses, 'servicios'),
    ingreso: suma(m.meses, 'ingreso'),
    costo: suma(m.meses, 'costo'),
    utilidad: suma(m.meses, 'utilidad'),
  };
  const conDatos = m?.meses.filter((x) => x.servicios > 0) ?? [];
  const mejorMes = conDatos.reduce((a, x) => (!a || x.ingreso > a.ingreso ? x : a), null);

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        title="Métricas de la clínica"
        description="Servicios, resultados y pacientes por año. Se enriquecen con cada registro."
        actions={
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5">
            <IconButton label="Año anterior" icon={ChevronLeft} onClick={() => setAnio((a) => a - 1)} disabled={anio <= 2020} />
            <span className="min-w-16 text-center text-sm font-semibold" aria-live="polite">
              {anio}
            </span>
            <IconButton label="Año siguiente" icon={ChevronRight} onClick={() => setAnio((a) => a + 1)} disabled={anio >= anioActual} />
          </div>
        }
      />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !m ? (
        <Spinner />
      ) : !m ? null : (
        <div className="flex flex-col gap-5">
          {m.serviciosSinCosto > 0 && (
            <Alert>
              {formatNumber(m.serviciosSinCosto)} servicio(s) de {anio} están registrados con costo $0: los costos reales son mayores y la utilidad real es menor que la mostrada.
            </Alert>
          )}

          <section aria-label="Totales del año" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard highlight label={`Ingresos ${anio}`} value={formatCOP(totales.ingreso)} hint={mejorMes ? `Mejor mes: ${MESES[mejorMes.mes - 1]}` : undefined} icon={Wallet} />
            <StatCard label="Costos" value={formatCOP(totales.costo)} icon={Receipt} tone="warning" />
            <StatCard
              label="Utilidad"
              value={formatCOP(totales.utilidad)}
              delta={totales.ingreso ? `${Math.round((totales.utilidad / totales.ingreso) * 1000) / 10}%` : undefined}
              hint={totales.ingreso ? 'de margen' : undefined}
              icon={CircleDollarSign}
              tone="success"
            />
            <StatCard label="Servicios realizados" value={formatNumber(totales.servicios)} hint={`${formatNumber(m.pacientes)} pacientes`} icon={Stethoscope} tone="teal" />
          </section>

          <div className="grid gap-5 lg:grid-cols-3">
            <AreaChart
              className="lg:col-span-2"
              title="Ingresos, costos y utilidad"
              description="Por mes"
              data={m.meses.map((x) => ({ label: MESES[x.mes - 1], short: MESES[x.mes - 1].slice(0, 3), values: { ingreso: x.ingreso, costo: x.costo, utilidad: x.utilidad } }))}
              series={[
                { key: 'ingreso', label: 'Ingresos', color: SERIES[0] },
                { key: 'costo', label: 'Costos', color: SERIES[3] },
                { key: 'utilidad', label: 'Utilidad', color: SERIES[1] },
              ]}
              format={formatCOP}
            />
            <ColumnChart title="Servicios por mes" description="Servicios realizados" unit="servicios" data={m.meses.map((x) => ({ label: MESES[x.mes - 1].slice(0, 3), value: x.servicios }))} />
          </div>

          <Card flush title="Resultados por mes" description={`Año ${anio}`}>
            <TableWrap minWidth="min-w-[720px]">
              <thead>
                <tr>
                  <th className={th}>Mes</th>
                  <th className={`${th} text-right`}>Servicios</th>
                  <th className={`${th} text-right`}>Pacientes</th>
                  <th className={`${th} text-right`}>Ingresos</th>
                  <th className={`${th} text-right`}>Costos</th>
                  <th className={`${th} text-right`}>Utilidad</th>
                </tr>
              </thead>
              <tbody>
                {m.meses.map((x) => (
                  <tr key={x.mes} className="hover:bg-subtle/60">
                    <td className={`${td} font-semibold`}>{MESES[x.mes - 1]}</td>
                    <td className={`${td} tabular text-right`}>{formatNumber(x.servicios)}</td>
                    <td className={`${td} tabular text-right`}>{formatNumber(x.pacientes)}</td>
                    <td className={`${td} tabular text-right`}>{formatCOP(x.ingreso)}</td>
                    <td className={`${td} tabular text-right`}>{formatCOP(x.costo)}</td>
                    <td className={`${td} tabular text-right font-semibold`}>{formatCOP(x.utilidad)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td className="px-4 py-3">Total</td>
                  <td className="tabular px-4 py-3 text-right">{formatNumber(totales.servicios)}</td>
                  <td className="tabular px-4 py-3 text-right" title="Un paciente atendido en varios meses cuenta una sola vez">
                    {formatNumber(m.pacientes)}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{formatCOP(totales.ingreso)}</td>
                  <td className="tabular px-4 py-3 text-right">{formatCOP(totales.costo)}</td>
                  <td className="tabular px-4 py-3 text-right">{formatCOP(totales.utilidad)}</td>
                </tr>
              </tfoot>
            </TableWrap>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <DonutChart
              title="Pacientes por género"
              description={`Atendidos en ${anio}`}
              centerValue={formatNumber(m.pacientes)}
              centerLabel="pacientes"
              data={m.generos.map((g) => ({ label: NOMBRE_GENERO[g.grupo], value: g.pacientes, color: COLOR_GENERO[g.grupo] }))}
            />
            <ColumnChart
              className="lg:col-span-2"
              title="Pacientes por edad"
              description="Edad que cumplen en el año"
              unit="pacientes"
              data={m.edades.map((g) => ({ label: g.grupo, value: g.pacientes }))}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <TablaGrupos title="Uso de servicios por género" description="¿Quiénes usan más los servicios?" grupos={m.generos} nombre={(g) => NOMBRE_GENERO[g]} />
            <TablaGrupos title="Uso de servicios por edad" description="Edad que cumplen en el año" grupos={m.edades} />
          </div>
        </div>
      )}
    </>
  );
}
