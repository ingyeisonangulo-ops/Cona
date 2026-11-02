import { Link } from 'react-router-dom';
import { BellRing, CalendarCheck2, CalendarDays, CalendarPlus, CalendarX2, ClipboardPlus, Stethoscope } from 'lucide-react';
import { ALERTA_STYLES, AlertaBadge, EstadoBadge, formatFecha, todayBogota } from '../components/business.jsx';
import { Avatar, Button, Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import MiProgresoPage from './MiProgresoPage.jsx';
import TableroPage from './TableroPage.jsx';

const nombreCorto = (n) => n.replace(/^Dra?\.\s+/i, '').split(' ')[0];

// Inicio del personal operativo: el día de hoy de un vistazo.
function OperativoHome() {
  const { user, can } = useAuth();
  const hoy = todayBogota();
  const verAgenda = can('MANAGE_APPOINTMENTS');
  const citasHoy = useResource(verAgenda ? `/citas?desde=${hoy}&hasta=${hoy}` : null);
  const alertas = useResource(verAgenda ? '/citas/alertas' : null);
  const pendientes = useResource(can('CLOSE_ABSENCES') ? '/cierres-ausencia/pendientes' : null);
  const registrados = useResource(can('REGISTER_SERVICES') ? `/servicios-realizados?desde=${hoy}&hasta=${hoy}` : null);

  const citas = citasHoy.data?.citas?.filter((c) => c.estado !== 'Aplazado') ?? [];
  const cumplidas = citas.filter((c) => c.estado === 'Cumplida').length;
  const listaAlertas = alertas.data?.citas ?? [];
  const vencidas = listaAlertas.filter((c) => c.alerta === 'rojo').length;
  const n = (r, v) => (r.loading && !r.data ? '…' : formatNumber(v));

  return (
    <>
      <PageHeader
        eyebrow={`Panel operativo · ${user.role}`}
        title={`Hola, ${nombreCorto(user.fullName)}`}
        description="Esto es lo que pasa hoy en la clínica."
        actions={
          <>
            {can('MANAGE_APPOINTMENTS') && (
              <Link to="/agenda">
                <Button variant="outline" icon={CalendarPlus} tabIndex={-1}>
                  Agenda
                </Button>
              </Link>
            )}
            {can('REGISTER_SERVICES') && (
              <Link to="/registro">
                <Button icon={ClipboardPlus} tabIndex={-1}>
                  Registrar servicios
                </Button>
              </Link>
            )}
          </>
        }
      />

      <section aria-label="Indicadores del día" className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {verAgenda && <StatCard highlight label="Citas de hoy" value={n(citasHoy, citas.length)} hint={`${cumplidas} cumplidas`} icon={CalendarDays} />}
        {verAgenda && <StatCard label="Requieren atención" value={n(alertas, listaAlertas.length)} hint={`${vencidas} vencidas sin cumplir`} icon={BellRing} tone="warning" />}
        {can('CLOSE_ABSENCES') && (
          <StatCard label="Inasistencias pendientes" value={n(pendientes, pendientes.data?.citas.length ?? 0)} hint="sin seguimiento" icon={CalendarX2} tone="secondary" />
        )}
        {can('REGISTER_SERVICES') && (
          <StatCard label="Servicios registrados hoy" value={n(registrados, registrados.data?.servicios.filter((s) => s.estado !== 'anulado').length ?? 0)} icon={Stethoscope} tone="teal" />
        )}
      </section>

      {verAgenda && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card
            className="lg:col-span-2"
            title="Agenda de hoy"
            description={formatFecha(hoy)}
            icon={CalendarCheck2}
            actions={
              <Link to="/agenda" className="text-xs font-semibold text-primary hover:underline">
                Ver agenda
              </Link>
            }
          >
            {citasHoy.loading && !citasHoy.data ? (
              <Spinner />
            ) : citas.length === 0 ? (
              <EmptyState icon={CalendarDays} title="Sin citas para hoy" />
            ) : (
              <ol className="flex flex-col">
                {citas.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 border-b border-line/70 py-3 last:border-0">
                    <span className="tabular w-12 shrink-0 text-sm font-semibold text-text">{c.hora}</span>
                    <span className={`h-9 w-1 shrink-0 rounded-full ${c.alerta === 'rojo' ? 'bg-secondary' : c.estado === 'Cumplida' ? 'bg-success' : 'bg-primary/40'}`} aria-hidden />
                    <Avatar name={c.paciente.nombre} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.paciente.nombre}</p>
                      <p className="truncate text-xs text-muted">
                        {c.servicio ?? 'Sin servicio'}
                        {c.colaborador ? ` · ${c.colaborador}` : ''}
                      </p>
                    </div>
                    <EstadoBadge estado={c.estado} />
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Requieren atención" icon={BellRing} description="Vencidas, hoy, mañana y en 2 días">
            {alertas.loading && !alertas.data ? (
              <Spinner />
            ) : listaAlertas.length === 0 ? (
              <p className="text-sm text-muted">Sin alertas.</p>
            ) : (
              <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto">
                {listaAlertas.slice(0, 15).map((c) => (
                  <li key={c.id} className={`flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm ${ALERTA_STYLES[c.alerta]?.ring ?? ''}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.paciente.nombre}</span>
                      <span className="block text-xs text-muted">
                        {formatFecha(c.fecha)} · {c.hora}
                      </span>
                    </span>
                    <AlertaBadge alerta={c.alerta} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

export default function DashboardPage() {
  const { can } = useAuth();
  if (can('VIEW_DASHBOARD_FINANCE')) return <TableroPage />;
  if (can('MANAGE_APPOINTMENTS', 'REGISTER_SERVICES', 'CLOSE_ABSENCES')) return <OperativoHome />;
  return <MiProgresoPage />;
}
