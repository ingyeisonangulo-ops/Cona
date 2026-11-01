import { Link } from 'react-router-dom';
import { BadgePercent, CalendarDays, FolderTree, Repeat, Stethoscope, TrendingUp, Trophy, Wallet } from 'lucide-react';
import { Card, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

function KpiCard({ icon: Icon, title, value, hint, to, pending }) {
  const body = (
    <Card className="flex h-full items-start gap-4 transition-shadow hover:shadow-pop">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-white shadow-sm">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted">{title}</p>
        <p className={`mt-1 text-2xl font-extrabold tracking-tight ${pending ? 'text-muted/60' : 'text-text'}`}>{value}</p>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
    </Card>
  );
  return to ? (
    <Link to={to} className="rounded-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">
      {body}
    </Link>
  ) : (
    body
  );
}

const PENDING = 'Disponible en un próximo bloque';

export default function DashboardPage() {
  const { user, can } = useAuth();
  const canCatalog = can('MANAGE_SERVICES', 'REGISTER_SERVICES', 'VIEW_ROLE_SERVICES');
  const servicios = useResource(canCatalog ? '/servicios?status=active' : null);
  const categorias = useResource(canCatalog ? '/categorias?status=active' : null);
  const convenios = useResource(canCatalog ? '/convenios?status=active' : null);

  const count = (r, key) => (r.loading ? '…' : r.error ? '—' : formatNumber(r.data?.[key]?.length ?? 0));
  const firstName = user.fullName.split(' ')[0];

  return (
    <>
      <PageHeader title={`Hola, ${firstName}`} description={`Resumen general · ${user.role}`} />

      {canCatalog && (
        <section aria-labelledby="kpi-catalogo" className="mb-8">
          <h2 id="kpi-catalogo" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Catálogo
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <KpiCard icon={Stethoscope} title="Servicios activos" value={count(servicios, 'servicios')} hint="Ofertados al público" to="/catalogo" />
            <KpiCard icon={FolderTree} title="Categorías activas" value={count(categorias, 'categorias')} hint="Agrupación del catálogo" to="/catalogo?tab=categorias" />
            <KpiCard icon={BadgePercent} title="Convenios vigentes" value={count(convenios, 'convenios')} hint="Descuentos por categoría" to="/catalogo?tab=convenios" />
          </div>
        </section>
      )}

      <section aria-labelledby="kpi-gestion">
        <h2 id="kpi-gestion" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Indicadores de gestión
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {can('VIEW_DASHBOARD_FINANCE') && <KpiCard icon={Wallet} title="Ingresos del mes" value="—" hint={PENDING} pending />}
          {can('VIEW_MONTHLY_APPOINTMENTS_COUNT') && <KpiCard icon={CalendarDays} title="Citas del mes" value="—" hint={PENDING} pending />}
          {can('VIEW_RECURRENCE_RATE') && <KpiCard icon={Repeat} title="Tasa de recurrencia" value="—" hint={PENDING} pending />}
          {can('VIEW_PERSONAL_PROGRESS') && <KpiCard icon={Trophy} title="Mi progreso (puntos)" value="—" hint={PENDING} pending />}
          {can('VIEW_DASHBOARD_FINANCE') && <KpiCard icon={TrendingUp} title="Margen por servicio" value="—" hint={PENDING} pending />}
        </div>
      </section>
    </>
  );
}
