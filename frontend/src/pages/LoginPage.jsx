import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { Logo } from '../components/Logo.jsx';
import { Alert, Button, Input } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function AuthShell({ children }) {
  return (
    <div className="pt-safe pb-safe grid min-h-dvh place-items-center bg-login-bg px-4 py-6 md:px-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[24px] bg-surface shadow-pop md:grid-cols-2">
        {/* Panel institucional */}
        <aside className="relative flex flex-col justify-between gap-8 overflow-hidden bg-primary p-6 text-white md:p-10">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-white/10" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-brand-dark/40" />
          <div className="relative">
            <Logo inverted />
          </div>
          <div className="relative hidden md:block">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/70">IPS Centro Odontológico</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight">
              Cada sonrisa es un
              <br /> nuevo amanecer.
            </h1>
            <p className="mt-4 max-w-sm text-white/80">
              Plataforma de gestión clínica y tablero gerencial de Nuevo Amanecer del Pacífico SAS.
            </p>
            <div className="mt-5 h-1 w-16 rounded-full bg-secondary" />
          </div>
          <p className="relative flex items-center gap-2 text-xs text-white/75">
            <ShieldCheck className="size-4" aria-hidden /> Acceso exclusivo para personal autorizado
          </p>
        </aside>
        {/* Formulario */}
        <section className="flex flex-col justify-center p-6 md:p-10">{children}</section>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.mustChangePassword ? '/perfil' : (location.state?.from ?? '/'), { replace: true });
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-bold tracking-tight text-text">Iniciar sesión</h2>
      <p className="mt-1 text-sm text-muted">Ingrese con su correo institucional.</p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        {error ? <Alert>{error}</Alert> : location.state?.message && <Alert tone="success">{location.state.message}</Alert>}
        <Input
          label="Correo electrónico"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@nuevoamanecer.co"
        />
        <div className="relative">
          <Input
            label="Contraseña"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="touch-target absolute bottom-0 right-0 grid place-items-center text-muted hover:text-primary"
          >
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        <div className="flex justify-end">
          <Link to="/recuperar" className="touch-target inline-flex items-center text-sm font-semibold text-primary hover:text-primary-hover">
            ¿Olvidó su contraseña?
          </Link>
        </div>
        <Button type="submit" loading={loading} icon={LogIn} disabled={!email || !password}>
          Ingresar
        </Button>
      </form>
    </AuthShell>
  );
}
