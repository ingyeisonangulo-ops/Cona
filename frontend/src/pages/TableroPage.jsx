import { Link } from 'react-router-dom';
import { BadgePercent, CircleDollarSign, Receipt, Repeat, Stethoscope, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import { MonthPicker, formatFecha, todayBogota, usePeriodo } from '../components/business.jsx';
import { AreaChart, DonutChart, Meter, OTHER, SERIES, STATUS_COLORS, formatCompact } from '../components/charts.jsx';
import { Alert, Avatar, Badge, Card, PageHeader, Sparkline, Spinner, StatCard, TableWrap, td, th } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ACTION_LABELS, formatCOP, formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

const variacion = (actual, anterior) => (anterior ? Math.round(((actual - anterior) / anterior) * 1000) / 10 : null);
const diaCorto = (ymd) => String(Number(ymd.slice(8, 10)));
const tiempoRelativo = (iso) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
};

function ActividadReciente() {
  const res = useResource('/audit-logs?limit=6');
  const logs = res.data?.logs ?? [];
  return (
    <Card
      title="Actividad reciente"
      actions={
        <Link to="/auditoria" className="text-xs font-semibold text-primary hover:underline">
          Ver todo
        </Link>
      }
    >
      {res.loading && !res.data ? (
        <Spinner />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {logs.map((l) => (
            <li key={l.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
              <Avatar name={l.actor?.fullName ?? 'Sistema'} size="sm" />
              <div className="min-w-0 text-sm">
                <p className="truncate">
                  <strong className="font-semibold">{l.actor?.fullName ?? 'Sistema'}</strong>
                </p>
                <p className="truncate text-muted">{ACTION_LABELS[l.action] ?? l.action}</p>
                <p className="mt-0.5 text-xs text-faint">{tiempoRelativo(l.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function TableroPage() {
  const { can } = useAuth();
  const [periodo, move] = usePeriodo();
  const res = useResource(`/tablero?anio=${periodo.anio}&mes=${periodo.mes}`);
  const t = res.data;

  return (
    <>
      <PageHeader
        eyebrow="Tablero gerencial"
        title="Resumen del mes"
        description="Rentabilidad, equipo, servicios y canales de la clínica."
        actions={<MonthPicker periodo={periodo} onMove={move} />}
      />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !t ? (
        <Spinner />
      ) : !t ? null : (
        <div className="flex flex-col gap-5">
          {/* KPIs */}
          <section aria-label="Indicadores clave" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard highlight label="Ingreso total" value={formatCOP(t.kpis.ingresoTotal)} delta={variacion(t.kpis.ingresoTotal, t.anterior.ingresoTotal)} hint="vs mes anterior" icon={Wallet}>
              <Sparkline values={t.serieDiaria.filter((d) => d.fecha <= todayBogota()).map((d) => d.ingreso)} className="-mb-1" />
            </StatCard>
            <StatCard
              label="Costos"
              value={formatCOP(t.kpis.costoTotal)}
              delta={t.kpis.ingresoTotal ? `${Math.round((t.kpis.costoTotal / t.kpis.ingresoTotal) * 1000) / 10}%` : undefined}
              hint={t.kpis.ingresoTotal ? 'de los ingresos' : 'sin ingresos en el mes'}
              icon={Receipt}
              tone="warning"
            />
            <StatCard
              label="Utilidad neta"
              value={formatCOP(t.kpis.utilidadNeta)}
              delta={`${t.kpis.margen}%`}
              hint="de margen"
              icon={CircleDollarSign}
              tone="success"
            />
            <StatCard
              label="Servicios realizados"
              value={formatNumber(t.kpis.serviciosRealizados)}
              delta={variacion(t.kpis.serviciosRealizados, t.anterior.serviciosRealizados)}
              hint={`· ${t.kpis.pacientesAtendidos} pacientes`}
              icon={Stethoscope}
              tone="teal"
            />
          </section>

          {/* Ingresos diarios + agenda */}
          <div className="grid gap-5 lg:grid-cols-3">
            <AreaChart
              className="lg:col-span-2"
              title="Ingresos y costos"
              description={`Por día · costo total ${formatCOP(t.kpis.costoTotal)}`}
              data={t.serieDiaria.map((d) => ({ label: formatFecha(d.fecha), short: diaCorto(d.fecha), values: { ingreso: d.ingreso, costo: d.costo } }))}
              series={[
                { key: 'ingreso', label: 'Ingresos', color: SERIES[0] },
                { key: 'costo', label: 'Costos', color: SERIES[1] },
              ]}
              format={formatCOP}
            />
            <DonutChart
              title="Agenda del mes"
              description={`${formatNumber(t.kpis.citasAgendadas)} citas agendadas`}
              centerValue={t.kpis.citasAgendadas ? `${Math.round((t.kpis.citasCumplidas / t.kpis.citasAgendadas) * 100)}%` : '—'}
              centerLabel="cumplidas"
              data={[
                { label: 'Cumplidas', value: t.kpis.citasCumplidas, color: STATUS_COLORS.good },
                { label: 'Pendientes', value: t.kpis.citasPendientes, color: SERIES[0] },
                { label: 'Ausentes', value: t.kpis.citasAusentes, color: STATUS_COLORS.critical },
              ]}
            />
          </div>

          {/* Equipo + canales */}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card
              className="lg:col-span-3"
              title="Desempeño del equipo"
              description="Puntos y dinero producido vs meta · comisión calculada"
              actions={<Badge tone="muted">{t.colaboradores.length} colaboradores</Badge>}
              bodyClassName="-mx-2"
            >
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>Colaborador</th>
                    <th className={`${th} w-[28%]`}>Puntos / meta</th>
                    <th className={th}>Semanas (pts)</th>
                    <th className={`${th} text-right`}>Producido</th>
                    <th className={`${th} text-right`}>Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {t.colaboradores.map((c) => (
                    <tr key={c.colaboradorId} className="hover:bg-subtle/60">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <Avatar name={c.nombre} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{c.nombre}</p>
                            <p className="text-xs text-muted">
                              {c.cargo ? `${c.cargo} · ` : ''}{c.servicios} servicios{c.bonoRecurrencia ? ` · +${c.bonoRecurrencia} bono` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <Meter value={c.puntosTotales} max={c.meta?.puntos ?? 0} color={c.cumpleMeta ? 'var(--color-success)' : 'var(--color-primary)'} label={`Puntos de ${c.nombre}`} />
                          <span className="tabular w-12 shrink-0 text-right text-xs font-semibold">{c.meta ? `${Math.round(c.cumplimientoPuntos)}%` : '—'}</span>
                        </div>
                        <p className="tabular mt-1 text-xs text-muted">
                          {formatNumber(c.puntosTotales)} / {c.meta ? formatNumber(c.meta.puntos) : 'sin meta'}
                        </p>
                      </td>
                      <td className={td}>
                        <div className="flex items-end gap-1" aria-label={c.semanas.map((w) => `Semana ${w.semana}: ${w.puntos} de ${w.propuestaPuntos ?? '—'}`).join('; ')}>
                          {c.semanas.map((w) => {
                            const max = Math.max(1, ...c.semanas.map((x) => Math.max(x.puntos, x.propuestaPuntos ?? 0)));
                            return (
                              <span key={w.semana} className="flex h-8 w-3 items-end overflow-hidden rounded-[3px] bg-subtle" title={`S${w.semana}: ${w.puntos} / ${w.propuestaPuntos ?? '—'} pts`}>
                                <span
                                  className="w-full rounded-[3px]"
                                  style={{ height: `${(w.puntos / max) * 100}%`, background: w.propuestaPuntos != null && w.puntos >= w.propuestaPuntos ? 'var(--color-success)' : 'var(--color-primary)' }}
                                />
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className={`${td} text-right`}>
                        <p className="tabular font-medium">{formatCOP(c.dinero)}</p>
                        {c.meta && <p className="text-xs text-muted">{c.cumplimientoDinero}% de {formatCompact(c.meta.dinero)}</p>}
                      </td>
                      <td className={`${td} text-right`}>
                        {c.comision > 0 ? <Badge tone="success">{formatCOP(c.comision)}</Badge> : <span className="text-xs text-faint">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>

          </div>

          {/* Servicios + recurrencia/convenios */}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Servicios del mes" description="Ranking por cantidad · rentabilidad por utilidad" bodyClassName="-mx-2">
              {t.servicios.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-muted">Sin servicios realizados en el mes.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th className={th}>Servicio</th>
                      <th className={`${th} w-[22%]`}>Realizados</th>
                      <th className={`${th} text-right`}>Ingreso</th>
                      <th className={`${th} text-right`}>Utilidad</th>
                      <th className={th}>Rentabilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.servicios.map((s) => (
                      <tr key={s.servicioId} className="hover:bg-subtle/60">
                        <td className={td}>
                          <p className="font-medium">{s.nombre}</p>
                          <p className="text-xs text-muted">{s.categoria}</p>
                        </td>
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <Meter value={s.cantidad} max={t.servicios[0].cantidad} label={`${s.nombre}: ${s.cantidad}`} />
                            <span className="tabular w-6 text-right text-xs font-semibold">{s.cantidad}</span>
                          </div>
                        </td>
                        <td className={`${td} tabular text-right`}>{formatCOP(s.ingreso)}</td>
                        <td className={`${td} text-right`}>
                          <p className="tabular font-medium">{formatCOP(s.utilidad)}</p>
                          <p className="text-xs text-muted">{s.margen}% margen</p>
                        </td>
                        <td className={td}>
                          {s.clasificacion === 'mas_rentable' && (
                            <Badge tone="success">
                              <TrendingUp className="size-3" aria-hidden /> Más rentable
                            </Badge>
                          )}
                          {s.clasificacion === 'menos_rentable' && (
                            <Badge tone="secondary">
                              <TrendingDown className="size-3" aria-hidden /> Menos rentable
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Card>

            <div className="flex min-w-0 flex-col gap-5">
              <DonutChart
                title="Pacientes nuevos por canal"
                description="Medio de origen"
                centerLabel="nuevos"
                data={['Redes Sociales', 'Referido', 'Televisión', 'Otro'].map((m, i) => ({
                  label: m,
                  value: t.canales.find((c) => c.medioOrigen === m)?.pacientes ?? 0,
                  color: m === 'Otro' ? OTHER : SERIES[[0, 1, 2][i]],
                }))}
              />
              <Card title="Recurrencia global" icon={Repeat} description="Pacientes del mes anterior que volvieron">
                <div className="flex items-end justify-between gap-3">
                  <p className="tabular text-4xl font-semibold tracking-tight">{t.recurrencia.tasa}%</p>
                  <p className="text-right text-xs text-muted">
                    {t.recurrencia.retornan} de {t.recurrencia.base}
                    <br />
                    pacientes
                  </p>
                </div>
                <div className="relative mt-4">
                  <Meter value={t.recurrencia.tasa} max={100} color={t.recurrencia.nivel ? 'var(--color-success)' : 'var(--color-primary)'} label="Tasa de recurrencia" />
                  {[60, 80].map((m) => (
                    <span key={m} className="absolute top-[-3px] h-3.5 w-0.5 rounded bg-faint" style={{ left: `${m}%` }} aria-hidden />
                  ))}
                </div>
                <div className="relative mt-1.5 h-4 text-[11px] text-faint">
                  <span className="absolute left-0">0%</span>
                  {[60, 80].map((m) => (
                    <span key={m} className="absolute -translate-x-1/2" style={{ left: `${m}%` }}>
                      {m}%
                    </span>
                  ))}
                </div>
                <p className="mt-3 rounded-xl bg-subtle px-3 py-2 text-xs text-muted">
                  {t.recurrencia.nivel
                    ? `Nivel ${t.recurrencia.nivel}% alcanzado: +${t.recurrencia.bonoPuntos} pts a cada colaborador con meta.`
                    : `≥60% → ${t.recurrencia.config.puntosNivel60} pts · ≥80% → ${t.recurrencia.config.puntosNivel80} pts por colaborador.`}
                </p>
              </Card>
              <Card title="Convenios más usados" icon={BadgePercent}>
                {t.convenios.length === 0 ? (
                  <p className="text-sm text-muted">Sin uso de convenios este mes.</p>
                ) : (
                  <ol className="flex flex-col gap-3.5">
                    {t.convenios.slice(0, 5).map((c) => (
                      <li key={c.convenioId}>
                        <p className="mb-1.5 flex justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{c.nombre}</span>
                          <span className="tabular shrink-0 text-muted">{c.usos} usos</span>
                        </p>
                        <Meter value={c.usos} max={t.convenios[0].usos} color={SERIES[2]} label={`${c.nombre}: ${c.usos} usos`} />
                        <p className="mt-1 text-xs text-faint">Descuento otorgado {formatCOP(c.descuento)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </div>

          {can('VIEW_AUDIT_LOGS') && <ActividadReciente />}
          <p className="text-center text-xs text-faint">
            <Users className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            Comisiones del mes: {formatCOP(t.kpis.comisionesTotales)} · Costo total {formatCOP(t.kpis.costoTotal)}
          </p>
        </div>
      )}
    </>
  );
}
