import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  CalendarX2,
  ClipboardList,
  ClipboardPlus,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Stethoscope,
  Target,
  Trophy,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { get } from '../lib/api.js';
import { Logo, LogoMark } from './Logo.jsx';
import { Avatar, IconButton, cx } from './ui.jsx';

// Navegación por rol, agrupada en secciones. Cada entrada declara los permisos
// que la habilitan; una sección sin entradas visibles no se muestra.
// `short` es la etiqueta de la barra inferior (móvil).
const SECTIONS = [
  {
    label: null,
    items: [
      { to: '/', label: 'Inicio', icon: LayoutDashboard, perms: null },
      { to: '/mi-progreso', label: 'Mi progreso', icon: Trophy, perms: ['VIEW_PERSONAL_PROGRESS'], hideIf: ['MANAGE_APPOINTMENTS', 'VIEW_DASHBOARD_FINANCE'] },
    ],
  },
  {
    label: 'Operación',
    items: [
      { to: '/registro', label: 'Registrar servicios', short: 'Registrar', icon: ClipboardPlus, perms: ['REGISTER_SERVICES'] },
      { to: '/agenda', label: 'Agenda', icon: CalendarDays, perms: ['MANAGE_APPOINTMENTS'] },
      { to: '/inasistencias', label: 'Inasistencias', short: 'Ausencias', icon: CalendarX2, perms: ['CLOSE_ABSENCES'], badge: 'pendientes' },
      { to: '/pacientes', label: 'Pacientes', icon: UserRound, perms: ['SEARCH_PATIENTS'] },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { to: '/metas', label: 'Metas y comisiones', short: 'Metas', icon: Target, perms: ['MANAGE_COLLABORATORS'] },
      { to: '/catalogo', label: 'Servicios y convenios', short: 'Servicios', icon: Stethoscope, perms: ['MANAGE_SERVICES', 'REGISTER_SERVICES', 'VIEW_ROLE_SERVICES'] },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/usuarios', label: 'Usuarios', icon: Users, perms: ['MANAGE_USERS'] },
      { to: '/roles', label: 'Roles y permisos', short: 'Roles', icon: ShieldCheck, perms: ['MANAGE_USERS'] },
      { to: '/auditoria', label: 'Auditoría', icon: ClipboardList, perms: ['VIEW_AUDIT_LOGS'] },
    ],
  },
];
const PERFIL = { to: '/perfil', label: 'Mi perfil', short: 'Perfil', icon: UserRound };

const RAIL_KEY = 'cona.sidebar.rail';
const readRail = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};

const fechaHoy = () => {
  const t = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date());
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function useVisibleSections() {
  const { can } = useAuth();
  return SECTIONS.map((s) => ({ ...s, items: s.items.filter((n) => (!n.perms || can(...n.perms)) && !(n.hideIf && can(...n.hideIf))) })).filter((s) => s.items.length);
}

// Contadores del menú y la campana (se refrescan al cambiar de página).
function useCounters(pathname) {
  const { can } = useAuth();
  const [c, setC] = useState({ pendientes: 0, alertas: 0 });
  const verAusencias = can('CLOSE_ABSENCES');
  const verAgenda = can('MANAGE_APPOINTMENTS');
  useEffect(() => {
    let alive = true;
    Promise.all([
      verAusencias ? get('/cierres-ausencia/pendientes').then((d) => d.citas.length) : 0,
      verAgenda ? get('/citas/alertas').then((d) => d.citas.filter((x) => x.alerta === 'rojo' || x.alerta === 'naranja').length) : 0,
    ])
      .then(([pendientes, alertas]) => alive && setC({ pendientes, alertas }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, verAusencias, verAgenda]);
  return c;
}

function CountBadge({ n, className }) {
  if (!(n > 0)) return null;
  return <span className={cx('min-w-5 rounded-full bg-secondary px-1.5 py-px text-center text-[11px] font-bold text-white', className)}>{n > 99 ? '99+' : n}</span>;
}

function NavItems({ sections, onNavigate, counters, rail }) {
  return (
    <nav aria-label="Navegación principal" className={cx('flex flex-col', rail ? 'items-center gap-3' : 'gap-5')}>
      {sections.map((section, i) => (
        <div key={section.label ?? 'general'} className={cx(rail && 'flex flex-col items-center gap-1')}>
          {section.label &&
            (rail ? (
              i > 0 && <span className="mb-2 block h-px w-8 bg-line" aria-hidden />
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{section.label}</p>
            ))}
          <div className={cx('flex flex-col gap-0.5', rail && 'items-center gap-1')}>
            {section.items.map(({ to, label, icon: Icon, badge }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={onNavigate}
                aria-label={rail ? label : undefined}
                title={rail ? label : undefined}
                className={({ isActive }) =>
                  cx(
                    'touch-target group relative flex items-center rounded-xl text-sm font-medium transition-colors',
                    rail ? 'size-11 justify-center' : 'gap-3 px-3',
                    isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-subtle hover:text-text',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cx('size-[18px] shrink-0', isActive ? 'text-primary' : 'text-faint group-hover:text-text')} aria-hidden />
                    {!rail && <span className={cx('flex-1 truncate', isActive && 'font-semibold')}>{label}</span>}
                    {badge && <CountBadge n={counters[badge]} className={rail ? 'absolute -right-1 -top-1 ring-2 ring-surface' : undefined} />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// Barra inferior (móvil y tableta): 3 destinos frecuentes + "Menú" con el resto.
function BottomBar({ sections, counters, onMenu }) {
  let items = sections.flatMap((s) => s.items);
  if (items.some((n) => n.to === '/mi-progreso')) items = items.filter((n) => n.to !== '/');
  items = items.slice(0, 3);
  if (items.length < 3) items.push(PERFIL);
  return (
    <nav aria-label="Accesos rápidos" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-4 px-2 pt-1.5">
        {items.map(({ to, label, short, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => cx('relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px]', isActive ? 'font-semibold text-primary' : 'font-medium text-muted')}
          >
            <span className="relative">
              <Icon className="size-[22px]" strokeWidth={1.8} aria-hidden />
              {badge && <CountBadge n={counters[badge]} className="absolute -right-3 -top-1.5 ring-2 ring-surface" />}
            </span>
            <span className="max-w-full truncate px-1">{short ?? label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={onMenu} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium text-muted">
          <Menu className="size-[22px]" strokeWidth={1.8} aria-hidden />
          Menú
        </button>
      </div>
    </nav>
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(readRail);
  const [leaving, setLeaving] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const counters = useCounters(location.pathname);
  const sections = useVisibleSections();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function toggleRail() {
    setRail((r) => {
      try {
        localStorage.setItem(RAIL_KEY, r ? '0' : '1');
      } catch {
        /* sin almacenamiento: solo cambia en esta sesión */
      }
      return !r;
    });
  }

  async function handleLogout() {
    setLeaving(true);
    await logout();
    navigate('/login', { replace: true });
  }

  const sidebar = (isRail) => (
    <div className="flex h-full flex-col">
      <div className={cx('flex items-center pb-6 pt-6', isRail ? 'flex-col gap-4 px-2' : 'justify-between gap-2 px-6')}>
        {isRail ? (
          <LogoMark className="size-10" />
        ) : (
          <div className="max-w-[9.5rem]">
            <Logo />
          </div>
        )}
      </div>
      <div className={cx('flex-1 overflow-y-auto', isRail ? 'px-2' : 'px-3')}>
        <NavItems sections={sections} onNavigate={() => setOpen(false)} counters={counters} rail={isRail} />
      </div>
      {/* Tarjeta de usuario */}
      <div className={cx('border-t border-line p-3', isRail && 'flex flex-col items-center gap-2')}>
        {isRail ? (
          <>
            <Link to="/perfil" aria-label="Mi perfil" title={user.fullName} className="rounded-full">
              <Avatar name={user.fullName} />
            </Link>
            <IconButton label="Cerrar sesión" icon={LogOut} onClick={handleLogout} disabled={leaving} className="hover:bg-secondary-soft hover:text-secondary" />
          </>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-subtle p-2">
            <Link to="/perfil" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none" aria-label="Mi perfil">
              <Avatar name={user.fullName} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">{user.fullName}</span>
                <span className="block truncate text-xs text-muted">{user.role}</span>
              </span>
            </Link>
            <IconButton label="Cerrar sesión" icon={LogOut} onClick={handleLogout} disabled={leaving} className="hover:bg-secondary-soft hover:text-secondary" />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={cx('min-h-dvh', rail ? 'lg:pl-[76px]' : 'lg:pl-64')}>
      {/* Barra lateral (escritorio): completa o franja de íconos */}
      <aside className={cx('pl-safe fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface lg:block', rail ? 'w-[76px]' : 'w-64')}>{sidebar(rail)}</aside>

      {/* Menú deslizable (móvil) */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
          <aside className="pt-safe pb-safe pl-safe absolute inset-y-0 left-0 w-[min(17rem,85vw)] bg-surface shadow-pop">
            <div className="absolute right-2 top-2 pt-safe">
              <IconButton label="Cerrar menú" icon={X} onClick={() => setOpen(false)} />
            </div>
            {sidebar(false)}
          </aside>
        </div>
      )}

      {/* Barra superior */}
      <header className="pt-safe pr-safe sticky top-0 z-20 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-4 md:px-8">
          <div className="-ml-2 hidden lg:block">
            <IconButton label={rail ? 'Expandir menú' : 'Contraer menú'} icon={rail ? PanelLeftOpen : PanelLeftClose} onClick={toggleRail} />
          </div>
          <div className="w-24 lg:hidden">
            <Logo />
          </div>
          <p className="hidden text-sm text-muted lg:block">{fechaHoy()}</p>
          <div className="ml-auto flex items-center gap-1.5 md:gap-3">
            {can('MANAGE_APPOINTMENTS') && (
              <Link
                to="/agenda"
                className="touch-target relative inline-grid place-items-center rounded-full border border-line bg-surface text-muted hover:text-primary"
                aria-label={`Alertas de agenda: ${counters.alertas}`}
                title="Citas vencidas o para hoy/mañana"
              >
                <Bell className="size-[18px]" aria-hidden />
                <CountBadge n={counters.alertas} className="absolute -right-1 -top-1 ring-2 ring-bg" />
              </Link>
            )}
            <Link to="/perfil" className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 hover:bg-surface md:pr-3" aria-label="Mi perfil">
              <Avatar name={user.fullName} />
              <span className="hidden text-left md:block">
                <span className="block text-sm font-semibold leading-tight text-text">{user.fullName}</span>
                <span className="block text-xs text-muted">{user.role}</span>
              </span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-[max(1rem,env(safe-area-inset-left))] pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:px-8 lg:pb-10">
        <Outlet />
      </main>

      <BottomBar sections={sections} counters={counters} onMenu={() => setOpen(true)} />
    </div>
  );
}
