import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Alert, Button, Input } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { post } from '../lib/api.js';
import { AuthShell } from './LoginPage.jsx';

// El token llega en el fragmento (#token=…), que el navegador no envía al
// servidor. Se lee una vez (idempotente ante el doble render de StrictMode)
// y se elimina de la barra de direcciones.
let capturedToken = null;
function takeTokenFromHash() {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromHash) {
    capturedToken = fromHash;
    window.history.replaceState(null, '', window.location.pathname);
  }
  return capturedToken ?? '';
}

export default function ResetPasswordPage() {
  const { endSession } = useAuth();
  const [token] = useState(takeTokenFromHash);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const mismatch = confirm && password !== confirm;

  async function onSubmit(e) {
    e.preventDefault();
    if (password !== confirm) return;
    setLoading(true);
    setError('');
    try {
      await post('/auth/reset-password', { token, password });
      await endSession();
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-bold tracking-tight">Nueva contraseña</h2>
      {!token ? (
        <Alert className="mt-6">El enlace no es válido. Solicite uno nuevo a un administrador.</Alert>
      ) : done ? (
        <div className="mt-6 flex flex-col gap-4">
          <Alert tone="success">Contraseña actualizada. Todas las sesiones anteriores se cerraron.</Alert>
          <Link to="/login" className="touch-target inline-flex items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">
            Ir a iniciar sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          {error && <Alert>{error}</Alert>}
          <Input label="Nueva contraseña" type="password" autoComplete="new-password" hint="Mínimo 12 caracteres." value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input
            label="Confirmar contraseña"
            type="password"
            autoComplete="new-password"
            value={confirm}
            error={mismatch ? 'Las contraseñas no coinciden' : undefined}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button type="submit" icon={KeyRound} loading={loading} disabled={password.length < 12 || password !== confirm}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
