import { CalendarCheck2, Flag, Repeat, Sparkles, Target, Trophy } from 'lucide-react';
import { MonthPicker, formatFecha, usePeriodo } from '../components/business.jsx';
import { DonutChart, Meter } from '../components/charts.jsx';
import { Alert, Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

// Vista del Colaborador: solo puntos, metas en puntos y cantidades.
// Por diseño NO muestra dinero, datos de pacientes ni ocupación de agenda
// (la API tampoco los envía).
export default function MiProgresoPage() {
  const { user } = useAuth();
  const [periodo, move] = usePeriodo();
  const res = useResource(`/mi-progreso?anio=${periodo.anio}&mes=${periodo.mes}`);
  const d = res.data;
  const nombre = user.fullName.replace(/^Dra?\.\s+/i, '').split(' ')[0];

  return (
    <>
      <PageHeader eyebrow="Mi progreso" title={`Hola, ${nombre}`} description="Tus puntos y metas del mes." actions={<MonthPicker periodo={periodo} onMove={move} />} />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !d ? (
        <Spinner />
      ) : !d ? null : (
        <div className="flex flex-col gap-5">
          <section aria-label="Indicadores" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              highlight
              label="Puntos acumulados"
              value={formatNumber(d.puntos.total)}
              hint={d.puntos.bonoRecurrencia ? `incluye +${d.puntos.bonoRecurrencia} de bono` : `${d.serviciosRealizados} servicios`}
              icon={Trophy}
            >
              {d.meta && (
                <span className="block h-1.5 overflow-hidden rounded-full bg-night-2" aria-hidden>
                  <span className="block h-full rounded-full bg-night-accent" style={{ width: `${Math.min(100, d.porcentaje)}%` }} />
                </span>
              )}
            </StatCard>
            <StatCard label="Meta del mes" value={d.meta ? formatNumber(d.meta.puntos) : '—'} hint={d.meta ? 'puntos' : 'sin meta asignada'} icon={Target} tone="violet" />
            <StatCard label="Puntos faltantes" value={d.meta ? formatNumber(d.faltantes) : '—'} hint={d.cumpleMeta ? '¡meta cumplida!' : undefined} icon={Flag} tone={d.cumpleMeta ? 'success' : 'warning'} />
            <StatCard label="% alcanzado" value={d.meta ? `${d.porcentaje}%` : '—'} icon={Sparkles} tone="teal" />
          </section>

          {d.meta && (
            <div className="grid gap-5 lg:grid-cols-3">
              <DonutChart
                title="Avance mensual"
                description={`${formatNumber(d.puntos.total)} de ${formatNumber(d.meta.puntos)} puntos`}
                centerValue={`${Math.min(100, Math.round(d.porcentaje))}%`}
                centerLabel="de la meta"
                data={[
                  { label: 'Logrados', value: Math.min(d.puntos.total, d.meta.puntos), color: d.cumpleMeta ? 'var(--color-success)' : 'var(--color-primary)' },
                  { label: 'Faltantes', value: d.faltantes, color: '#cbd5e1' },
                ]}
              />
              <Card className="lg:col-span-2" title="Propuesta por semana" description="Semanas 1–7, 8–14, 15–21 y 22–fin de mes">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {d.semanas.map((w) => {
                    const ok = w.propuesta != null && w.puntos >= w.propuesta;
                    return (
                      <div key={w.semana} className="rounded-xl border border-line p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">Semana {w.semana}</p>
                        <p className="tabular mt-2 text-xl font-semibold">
                          {formatNumber(w.puntos)} <span className="text-sm font-normal text-faint">/ {formatNumber(w.propuesta)}</span>
                        </p>
                        <Meter className="mt-3" value={w.puntos} max={w.propuesta} color={ok ? 'var(--color-success)' : 'var(--color-primary)'} label={`Semana ${w.semana}`} />
                        <p className={`mt-2 text-xs ${ok ? 'text-success' : 'text-muted'}`}>{ok ? 'Cumplida' : `Faltan ${formatNumber(Math.max(0, w.propuesta - w.puntos))}`}</p>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            {d.citasPorDia && (
              <Card className="lg:col-span-2" title="Mis citas del mes" description="Cantidades por día" icon={CalendarCheck2}>
                {d.citasPorDia.length === 0 ? (
                  <EmptyState title="Sin citas asignadas este mes" />
                ) : (
                  <ul className="grid gap-2 xs:grid-cols-2 md:grid-cols-3">
                    {d.citasPorDia.map((c) => (
                      <li key={c.fecha} className="rounded-xl border border-line px-3 py-2.5">
                        <p className="text-sm font-medium capitalize">{formatFecha(c.fecha)}</p>
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="inline-flex items-center gap-1 text-success">
                            <span className="size-1.5 rounded-full bg-success" aria-hidden />
                            {c.cumplidas} cumplidas
                          </span>
                          <span className="inline-flex items-center gap-1 text-secondary">
                            <span className="size-1.5 rounded-full bg-secondary" aria-hidden />
                            {c.noCumplidas} no cumplidas
                          </span>
                          {c.programadas > 0 && <span className="text-muted">{c.programadas} programadas</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {d.recurrencia && (
              <Card title="Tasa de recurrencia" icon={Repeat} description="Pacientes que vuelven mes a mes">
                <p className="tabular text-4xl font-semibold tracking-tight">{d.recurrencia.tasa}%</p>
                <Meter className="mt-4" value={d.recurrencia.tasa} max={100} color={d.recurrencia.nivel ? 'var(--color-success)' : 'var(--color-primary)'} label="Tasa de recurrencia" />
                <p className="mt-3 rounded-xl bg-subtle px-3 py-2 text-xs text-muted">
                  {d.recurrencia.nivel ? `Nivel ${d.recurrencia.nivel}% alcanzado: bono de puntos activo.` : 'Al llegar a 60% u 80% se otorgan puntos extra.'}
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
