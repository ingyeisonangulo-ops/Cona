import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ClipboardList, LayoutDashboard, LogOut, Menu, ShieldCheck, Stethoscope, UserCircle, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Logo } from './Logo.jsx';
import { IconButton } from './ui.jsx';

// Navegación por rol: cada entrada declara los permisos que la habilitan.
const NAV = [
  { to: '/', label: 'Tablero', icon: LayoutDashboard, perms: null },
  { to: '/catalogo', label: 'Servicios y convenios', icon: Stethoscope, perms: ['MANAGE_SERVICES', 'REGISTER_SERVICES', 'VIEW_ROLE_SERVICES'] },
  { to: '/usuarios', label: 'Usuarios', icon: Users, perms: ['MANAGE_USERS'] },
  { to: '/roles', label: 'Roles y permisos', icon: ShieldCheck, perms: ['MANAGE_USERS'] },
  { to: '/auditoria', label: 'Auditoría', icon: ClipboardList, perms: ['VIEW_AUDIT_LOGS'] },
  { to: '/perfil', label: 'Mi perfil', icon: UserCircle, perms: null },
];

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function NavItems({ onNavigate }) {
  const { can } = useAuth();
  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-1">
      {NAV.filter((n) => !n.perms || can(...n.perms)).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `touch-target flex items-center gap-3 rounded-xl px-3.5 text-sm font-semibold transition-colors ${
              isActive ? 'bg-primary text-white shadow-sm' : 'text-muted hover:bg-primary-soft hover:text-primary'
            }`
          }
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function handleLogout() {
    setLeaving(true);
    await logout();
    navigate('/login', { replace: true });
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-4 pb-4 pt-5">
      <div className="px-1.5">
        <Logo />
      </div>
      <NavItems onNavigate={() => setOpen(false)} />
      <div className="mt-auto rounded-2xl bg-primary-soft p-4 text-xs text-brand-dark">
        <p className="font-semibold">IPS Centro Odontológico</p>
        <p className="text-brand-dark/75">Nuevo Amanecer del Pacífico SAS</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-72">
      {/* Sidebar desktop */}
      <aside className="pl-safe fixed inset-y-0 left-0 hidden w-72 border-r border-line bg-surface lg:block">{sidebar}</aside>

      {/* Drawer móvil */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-ink/45" onClick={() => setOpen(false)} />
          <aside className="pt-safe pb-safe pl-safe absolute inset-y-0 left-0 w-[min(18rem,85vw)] bg-surface shadow-pop">
            <div className="absolute right-2 top-2 pt-safe">
              <IconButton label="Cerrar menú" icon={X} onClick={() => setOpen(false)} />
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <header className="pt-safe pr-safe sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="flex h-16 items-center gap-2 px-3 md:px-6">
          <IconButton label="Abrir menú" icon={Menu} onClick={() => setOpen(true)} className="lg:hidden" />
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold leading-tight text-text">{user.fullName}</p>
              <p className="text-xs text-muted">{user.role}</p>
            </div>
            <span
              className="grid size-10 place-items-center rounded-full bg-primary text-sm font-bold text-white"
              aria-label={`${user.fullName}, ${user.role}`}
              title={`${user.fullName} · ${user.role}`}
            >
              {initials(user.fullName)}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={leaving}
              className="touch-target inline-flex items-center gap-2 rounded-xl px-3 text-sm font-semibold text-secondary transition-colors hover:bg-secondary-soft disabled:opacity-60"
            >
              <LogOut className="size-5" aria-hidden />
              <span className="hidden md:inline">Cerrar sesión</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-[max(1rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 md:px-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
