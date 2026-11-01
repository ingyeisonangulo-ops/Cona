import { Link } from 'react-router-dom';
import { BellRing, CalendarDays, CalendarX2, ClipboardPlus } from 'lucide-react';
import { ALERTA_STYLES, AlertaBadge, formatFecha } from '../components/business.jsx';
import { Card, PageHeader, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useResource } from '../lib/useResource.js';
import MiProgresoPage from './MiProgresoPage.jsx';
import TableroPage from './TableroPage.jsx';

// Inicio según el rol: Tablero gerencial (finanzas), panel operativo
// (agenda/registro) o la vista restringida del Colaborador.
function OperativoHome() {
  const { user, can } = useAuth();
  const alertas = useResource(can('MANAGE_APPOINTMENTS') ? '/citas/alertas' : null);
  const pendientes = useResource(can('CLOSE_ABSENCES') ? '/cierres-ausencia/pendientes' : null);
  const lista = alertas.data?.citas ?? [];

  const atajos = [
    can('REGISTER_SERVICES') && { to: '/registro', label: 'Registrar servicios', icon: ClipboardPlus },
    can('MANAGE_APPOINTMENTS') && { to: '/agenda', label: 'Agenda', icon: CalendarDays },
    can('CLOSE_ABSENCES') && { to: '/inasistencias', label: `Inasistencias${pendientes.data ? ` (${pendientes.data.citas.length})` : ''}`, icon: CalendarX2 },
  ].filter(Boolean);

  return (
    <>
      <PageHeader title={`Hola, ${user.fullName.split(' ')[0]}`} description={`Panel operativo · ${user.role}`} />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {atajos.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="rounded-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">
            <Card className="flex items-center gap-4 transition-shadow hover:shadow-pop">
              <span className="grid size-12 place-items-center rounded-full bg-primary text-white">
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="font-bold">{label}</span>
            </Card>
          </Link>
        ))}
      </div>
      {can('MANAGE_APPOINTMENTS') && (
        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-bold">
            <BellRing className="size-5 text-secondary" aria-hidden /> Citas que requieren atención
          </h2>
          {alertas.loading && !alertas.data ? (
            <Spinner />
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted">Sin alertas.</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {lista.slice(0, 12).map((c) => (
                <li key={c.id} className={`flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm ${ALERTA_STYLES[c.alerta]?.ring ?? ''}`}>
                  <span>
                    <strong>{c.paciente.nombre}</strong>
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
