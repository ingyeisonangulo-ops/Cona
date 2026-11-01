import { CalendarCheck2, Flag, Repeat, Sparkles, Target, Trophy } from 'lucide-react';
import { MonthPicker, ProgressBar, formatFecha, usePeriodo } from '../components/business.jsx';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

// Vista del Colaborador: solo puntos, metas en puntos y cantidades.
// Por diseño NO muestra dinero, datos de pacientes ni ocupación de agenda
// (la API tampoco los envía).
function Stat({ icon: Icon, label, value, hint }) {
  return (
    <Card className="flex items-start gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-white">
        <Icon className="size-6" aria-hidden />
      </span>
      <div>
        <p className="text-sm text-muted">{label}</p>
        <p className="text-2xl font-extrabold tracking-tight">{value}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </Card>
  );
}

export default function MiProgresoPage() {
  const { user } = useAuth();
  const [periodo, move] = usePeriodo();
  const res = useResource(`/mi-progreso?anio=${periodo.anio}&mes=${periodo.mes}`);
  const d = res.data;

  return (
    <>
      <PageHeader title={`Mi progreso, ${user.fullName.split(' ')[0]}`} description="Puntos y metas del mes." actions={<MonthPicker periodo={periodo} onMove={move} />} />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !d ? (
        <Spinner />
      ) : !d ? null : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Trophy} label="Puntos acumulados" value={formatNumber(d.puntos.total)} hint={d.puntos.bonoRecurrencia ? `Incluye ${d.puntos.bonoRecurrencia} de bono por recurrencia` : `${d.serviciosRealizados} servicio(s)`} />
            <Stat icon={Target} label="Meta del mes" value={d.meta ? formatNumber(d.meta.puntos) : '—'} hint={d.meta ? 'puntos' : 'Sin meta asignada'} />
            <Stat icon={Flag} label="Puntos faltantes" value={d.meta ? formatNumber(d.faltantes) : '—'} hint={d.cumpleMeta ? '¡Meta cumplida!' : undefined} />
            <Stat icon={Sparkles} label="% alcanzado" value={d.meta ? `${d.porcentaje}%` : '—'} />
          </div>

          {d.meta && (
            <Card>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold">Avance mensual</span>
                <span className="text-muted">
                  {formatNumber(d.puntos.total)} / {formatNumber(d.meta.puntos)} pts
                </span>
              </div>
              <ProgressBar value={d.puntos.total} max={d.meta.puntos} tone={d.cumpleMeta ? 'success' : 'primary'} label="Avance mensual" />
              <h2 className="mb-3 mt-6 font-bold">Propuesta por semana</h2>
              <div className="grid gap-3 md:grid-cols-4">
                {d.semanas.map((w) => (
                  <div key={w.semana} className="rounded-2xl border border-line p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Semana {w.semana} {w.semana === 4 && <span className="normal-case">(22–fin)</span>}
                    </p>
                    <p className="mt-1 text-lg font-bold">
                      {formatNumber(w.puntos)} <span className="text-sm font-normal text-muted">/ {formatNumber(w.propuesta)} pts</span>
                    </p>
                    <ProgressBar value={w.puntos} max={w.propuesta} tone={w.puntos >= w.propuesta ? 'success' : 'primary'} label={`Semana ${w.semana}`} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            {d.citasPorDia && (
              <Card className="lg:col-span-2">
                <h2 className="mb-3 flex items-center gap-2 font-bold">
                  <CalendarCheck2 className="size-5 text-primary" aria-hidden /> Mis citas del mes
                </h2>
                {d.citasPorDia.length === 0 ? (
                  <EmptyState title="Sin citas asignadas este mes" />
                ) : (
                  <ul className="grid gap-2 xs:grid-cols-2 md:grid-cols-3">
                    {d.citasPorDia.map((c) => (
                      <li key={c.fecha} className="rounded-xl border border-line p-3 text-sm">
                        <p className="font-semibold capitalize">{formatFecha(c.fecha)}</p>
                        <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                          <span className="font-semibold text-success">{c.cumplidas} cumplidas</span>
                          <span className="font-semibold text-secondary">{c.noCumplidas} no cumplidas</span>
                          {c.programadas > 0 && <span className="text-muted">{c.programadas} programadas</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {d.recurrencia && (
              <Card>
                <h2 className="mb-2 flex items-center gap-2 font-bold">
                  <Repeat className="size-5 text-primary" aria-hidden /> Tasa de recurrencia
                </h2>
                <p className="text-3xl font-extrabold">{d.recurrencia.tasa}%</p>
                <p className="mt-1 text-sm text-muted">
                  {d.recurrencia.nivel ? `Nivel ${d.recurrencia.nivel}% alcanzado: bono de puntos activo.` : 'Al llegar a 60% u 80% se otorgan puntos extra.'}
                </p>
                <div className="mt-3">
                  <ProgressBar value={d.recurrencia.tasa} max={100} tone={d.recurrencia.nivel ? 'success' : 'primary'} label="Tasa de recurrencia" />
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
