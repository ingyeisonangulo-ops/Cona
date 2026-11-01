import { BadgePercent, CalendarDays, CircleDollarSign, HandCoins, Megaphone, Percent, Receipt, Repeat, Stethoscope, TrendingDown, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react';
import { MonthPicker, ProgressBar, usePeriodo } from '../components/business.jsx';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { formatCOP, formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

function Kpi({ icon: Icon, title, value, hint, tone }) {
  return (
    <Card className="flex items-start gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-white shadow-sm">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted">{title}</p>
        <p className={`mt-1 truncate text-xl font-extrabold tracking-tight md:text-2xl ${tone === 'neg' ? 'text-secondary' : 'text-text'}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
    </Card>
  );
}

// Barra de datos dentro de una celda (proporción respecto al máximo de la columna).
function DataBar({ value, max }) {
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-bg">
      <div className="h-full rounded-full bg-primary" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
      <Icon className="size-5 text-primary" aria-hidden /> {children}
    </h2>
  );
}

export default function TableroPage() {
  const [periodo, move] = usePeriodo();
  const res = useResource(`/tablero?anio=${periodo.anio}&mes=${periodo.mes}`);
  const t = res.data;

  return (
    <>
      <PageHeader title="Tablero gerencial" description="Rentabilidad, metas, servicios, convenios y canales." actions={<MonthPicker periodo={periodo} onMove={move} />} />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !t ? (
        <Spinner />
      ) : !t ? null : (
        <div className="flex flex-col gap-8">
          <section aria-label="Indicadores clave" className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Wallet} title="Ingreso total" value={formatCOP(t.kpis.ingresoTotal)} hint="Con descuentos de convenio" />
            <Kpi icon={Receipt} title="Costo total" value={formatCOP(t.kpis.costoTotal)} hint="Costos fijos por servicio" />
            <Kpi icon={CircleDollarSign} title="Utilidad neta" value={formatCOP(t.kpis.utilidadNeta)} tone={t.kpis.utilidadNeta < 0 ? 'neg' : undefined} />
            <Kpi icon={Percent} title="Margen" value={`${t.kpis.margen}%`} />
            <Kpi icon={Stethoscope} title="Servicios realizados" value={formatNumber(t.kpis.serviciosRealizados)} hint={`${formatNumber(t.kpis.pacientesAtendidos)} pacientes atendidos`} />
            <Kpi icon={CalendarDays} title="Servicios agendados" value={formatNumber(t.kpis.citasAgendadas)} hint={`${t.kpis.citasCumplidas} cumplidas · ${t.kpis.citasAusentes} ausentes`} />
            <Kpi icon={UserPlus} title="Pacientes nuevos" value={formatNumber(t.kpis.pacientesNuevos)} />
            <Kpi icon={HandCoins} title="Comisiones del mes" value={formatCOP(t.kpis.comisionesTotales)} />
          </section>

          <section>
            <SectionTitle icon={Users}>Reporte por colaborador</SectionTitle>
            {t.colaboradores.length === 0 ? (
              <Card>
                <EmptyState title="Sin colaboradores" />
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {t.colaboradores.map((c) => (
                  <Card key={c.colaboradorId} className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{c.nombre}</h3>
                        <p className="text-xs text-muted">
                          {c.servicios} servicio(s){c.bonoRecurrencia ? ` · +${c.bonoRecurrencia} pts por recurrencia` : ''}
                        </p>
                      </div>
                      {c.meta ? (
                        <Badge tone={c.cumpleMeta ? 'primary' : 'muted'}>{c.cumpleMeta ? 'Meta cumplida' : 'En progreso'}</Badge>
                      ) : (
                        <Badge tone="secondary">Sin meta</Badge>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="flex justify-between text-sm">
                          <span className="text-muted">Puntos</span>
                          <strong>
                            {formatNumber(c.puntosTotales)} / {c.meta ? formatNumber(c.meta.puntos) : '—'}
                          </strong>
                        </p>
                        <ProgressBar value={c.puntosTotales} max={c.meta?.puntos ?? 0} tone={c.cumpleMeta ? 'success' : 'primary'} label={`Puntos de ${c.nombre}`} />
                      </div>
                      <div>
                        <p className="flex justify-between text-sm">
                          <span className="text-muted">Dinero producido</span>
                          <strong>{formatCOP(c.dinero)}</strong>
                        </p>
                        <ProgressBar value={c.dinero} max={c.meta?.dinero ?? 0} label={`Dinero de ${c.nombre}`} />
                        {c.meta && <p className="mt-1 text-xs text-muted">Meta {formatCOP(c.meta.dinero)} · {c.cumplimientoDinero}%</p>}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[420px] text-left text-xs">
                        <thead>
                          <tr className="text-muted">
                            <th className="py-1 font-semibold">Semana</th>
                            <th className="py-1 text-right font-semibold">Puntos / meta</th>
                            <th className="py-1 text-right font-semibold">Dinero / meta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.semanas.map((w) => (
                            <tr key={w.semana} className="border-t border-line">
                              <td className="py-1.5">S{w.semana}</td>
                              <td className="py-1.5 text-right">
                                {formatNumber(w.puntos)} / {w.propuestaPuntos ?? '—'}
                              </td>
                              <td className="py-1.5 text-right">
                                {formatCOP(w.dinero)} / {w.propuestaDinero == null ? '—' : formatCOP(w.propuestaDinero)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="flex items-center justify-between rounded-xl bg-primary-soft px-3 py-2 text-sm text-brand-dark">
                      <span>Comisión calculada</span>
                      <strong className="text-base">{formatCOP(c.comision)}</strong>
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle icon={Stethoscope}>Reporte por servicio</SectionTitle>
            {t.servicios.length === 0 ? (
              <Card>
                <EmptyState title="Sin servicios realizados en el mes" />
              </Card>
            ) : (
              <Card className="p-0 md:p-0">
                <TableWrap>
                  <thead>
                    <tr>
                      <th className={th}>#</th>
                      <th className={th}>Servicio</th>
                      <th className={`${th} text-right`}>Realizados</th>
                      <th className={`${th} text-right`}>Ingreso</th>
                      <th className={`${th} text-right`}>Utilidad</th>
                      <th className={`${th} text-right`}>Margen</th>
                      <th className={th}>Rentabilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.servicios.map((s, i) => (
                      <tr key={s.servicioId}>
                        <td className={`${td} text-muted`}>{i + 1}</td>
                        <td className={td}>
                          <p className="font-semibold">{s.nombre}</p>
                          <p className="text-xs text-muted">{s.categoria}</p>
                        </td>
                        <td className={`${td} w-32 text-right`}>
                          {formatNumber(s.cantidad)}
                          <DataBar value={s.cantidad} max={t.servicios[0].cantidad} />
                        </td>
                        <td className={`${td} text-right`}>{formatCOP(s.ingreso)}</td>
                        <td className={`${td} text-right font-semibold ${s.utilidad < 0 ? 'text-secondary' : ''}`}>{formatCOP(s.utilidad)}</td>
                        <td className={`${td} text-right`}>{s.margen}%</td>
                        <td className={td}>
                          {s.clasificacion === 'mas_rentable' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
                              <TrendingUp className="size-3" aria-hidden /> Más rentable
                            </span>
                          )}
                          {s.clasificacion === 'menos_rentable' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-1 text-xs font-semibold text-secondary">
                              <TrendingDown className="size-3" aria-hidden /> Menos rentable
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </Card>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-3">
            <section className="lg:col-span-1">
              <SectionTitle icon={BadgePercent}>Convenios más usados</SectionTitle>
              <Card>
                {t.convenios.length === 0 ? (
                  <p className="text-sm text-muted">Sin uso de convenios este mes.</p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {t.convenios.map((c) => (
                      <li key={c.convenioId}>
                        <p className="flex justify-between text-sm">
                          <span className="font-semibold">{c.nombre}</span>
                          <span>{c.usos} uso(s)</span>
                        </p>
                        <DataBar value={c.usos} max={t.convenios[0].usos} />
                        <p className="mt-1 text-xs text-muted">Descuento otorgado {formatCOP(c.descuento)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </section>
            <section>
              <SectionTitle icon={Megaphone}>Pacientes nuevos por canal</SectionTitle>
              <Card>
                {t.canales.length === 0 ? (
                  <p className="text-sm text-muted">Sin pacientes nuevos este mes.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {t.canales.map((c) => (
                      <li key={c.medioOrigen}>
                        <p className="flex justify-between text-sm">
                          <span className="font-semibold">{c.medioOrigen}</span>
                          <span>
                            {c.pacientes} · {c.porcentaje}%
                          </span>
                        </p>
                        <DataBar value={c.pacientes} max={t.canales[0].pacientes} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
            <section>
              <SectionTitle icon={Repeat}>Tasa de recurrencia global</SectionTitle>
              <Card>
                <p className="text-4xl font-extrabold">{t.recurrencia.tasa}%</p>
                <p className="mt-1 text-sm text-muted">
                  {t.recurrencia.retornan} de {t.recurrencia.base} pacientes del mes anterior volvieron.
                </p>
                <div className="mt-3">
                  <ProgressBar value={t.recurrencia.tasa} max={100} tone={t.recurrencia.nivel ? 'success' : 'primary'} label="Tasa de recurrencia" />
                </div>
                <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-sm">
                  {t.recurrencia.nivel
                    ? `Nivel ${t.recurrencia.nivel}% alcanzado: +${t.recurrencia.bonoPuntos} pts a cada colaborador con meta.`
                    : `Niveles: ≥60% → ${t.recurrencia.config.puntosNivel60} pts · ≥80% → ${t.recurrencia.config.puntosNivel80} pts.`}
                </p>
              </Card>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
