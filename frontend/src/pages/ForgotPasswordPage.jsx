import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { Alert, Button, Input } from '../components/ui.jsx';
import { post } from '../lib/api.js';
import { AuthShell } from './LoginPage.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const d = await post('/auth/forgot-password', { email });
      setMessage(d.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-bold tracking-tight">Recuperar contraseña</h2>
      <p className="mt-1 text-sm text-muted">
        Por seguridad, el restablecimiento lo autoriza un administrador de la clínica, quien le entregará un enlace de un solo uso.
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {message && <Alert tone="success">{message}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Input label="Correo electrónico" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" loading={loading} icon={Send} disabled={!email || Boolean(message)}>
          Enviar solicitud
        </Button>
        <Link to="/login" className="touch-target inline-flex items-center justify-center gap-2 text-sm font-semibold text-white underline-offset-4 hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Volver al inicio de sesión
        </Link>
      </form>
    </AuthShell>
  );
}
