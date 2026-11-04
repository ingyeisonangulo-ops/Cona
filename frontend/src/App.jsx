import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import { useAuth } from './context/AuthContext.jsx';
import AuditPage from './pages/AuditPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import RolesPage from './pages/RolesPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import AgendaPage from './pages/AgendaPage.jsx';
import CumpleanerosPage from './pages/CumpleanerosPage.jsx';
import InasistenciasPage from './pages/InasistenciasPage.jsx';
import MetasPage from './pages/MetasPage.jsx';
import MiProgresoPage from './pages/MiProgresoPage.jsx';
import PacientesPage from './pages/PacientesPage.jsx';
import RegistroPage from './pages/RegistroPage.jsx';

function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner label="Cargando…" />
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // Contraseña temporal: solo se permite el perfil hasta cambiarla.
  if (user.mustChangePassword && location.pathname !== '/perfil') return <Navigate to="/perfil" replace />;
  return children;
}

// La UI oculta lo no permitido; el backend valida cada endpoint igualmente.
function RequirePermission({ perms, children }) {
  const { can } = useAuth();
  return can(...perms) ? children : <NotFoundPage />;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/recuperar" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      <Route path="/restablecer" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route
          path="catalogo"
          element={
            <RequirePermission perms={['MANAGE_SERVICES', 'REGISTER_SERVICES', 'VIEW_ROLE_SERVICES']}>
              <CatalogPage />
            </RequirePermission>
          }
        />
        <Route path="registro" element={<RequirePermission perms={['REGISTER_SERVICES']}><RegistroPage /></RequirePermission>} />
        <Route path="pacientes" element={<RequirePermission perms={['SEARCH_PATIENTS']}><PacientesPage /></RequirePermission>} />
        <Route path="cumpleaneros" element={<RequirePermission perms={['SEARCH_PATIENTS']}><CumpleanerosPage /></RequirePermission>} />
        <Route path="agenda" element={<RequirePermission perms={['MANAGE_APPOINTMENTS']}><AgendaPage /></RequirePermission>} />
        <Route path="inasistencias" element={<RequirePermission perms={['CLOSE_ABSENCES']}><InasistenciasPage /></RequirePermission>} />
        <Route path="metas" element={<RequirePermission perms={['MANAGE_COLLABORATORS']}><MetasPage /></RequirePermission>} />
        <Route path="mi-progreso" element={<RequirePermission perms={['VIEW_PERSONAL_PROGRESS']}><MiProgresoPage /></RequirePermission>} />
        <Route path="usuarios" element={<RequirePermission perms={['MANAGE_USERS']}><UsersPage /></RequirePermission>} />
        <Route path="roles" element={<RequirePermission perms={['MANAGE_USERS']}><RolesPage /></RequirePermission>} />
        <Route path="auditoria" element={<RequirePermission perms={['VIEW_AUDIT_LOGS']}><AuditPage /></RequirePermission>} />
        <Route path="perfil" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
