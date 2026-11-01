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
        <Route path="usuarios" element={<RequirePermission perms={['MANAGE_USERS']}><UsersPage /></RequirePermission>} />
        <Route path="roles" element={<RequirePermission perms={['MANAGE_USERS']}><RolesPage /></RequirePermission>} />
        <Route path="auditoria" element={<RequirePermission perms={['VIEW_AUDIT_LOGS']}><AuditPage /></RequirePermission>} />
        <Route path="perfil" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
