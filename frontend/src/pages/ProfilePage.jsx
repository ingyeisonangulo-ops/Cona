import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, Mail, ShieldCheck, UserCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, ConfirmModal, Input, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { post } from '../lib/api.js';
import { PERMISSION_LABELS } from '../lib/format.js';

export default function ProfilePage() {
  const { user, endSession } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [askLogoutAll, setAskLogoutAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mismatch = form.confirm && form.newPassword !== form.confirm;

  // Ambas operaciones invalidan todas las sesiones: se vuelve al login.
  async function finish(message) {
    await endSession();
    navigate('/login', { replace: true, state: { message } });
  }

  async function onChangePassword(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      await finish('Contraseña actualizada. Inicie sesión nuevamente.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function onLogoutAll() {
    setBusy(true);
    try {
      await post('/auth/logout-all');
    } finally {
      await finish('Se cerraron todas las sesiones.');
    }
  }

  return (
    <>
      <PageHeader title="Mi perfil" description="Datos de la cuenta y seguridad." />
      {user.mustChangePassword && (
        <Alert className="mb-5">Está usando una contraseña temporal. Debe cambiarla para continuar.</Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-full bg-primary text-white">
              <UserCircle className="size-8" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{user.fullName}</p>
              <Badge tone={user.role === 'Super Admin' ? 'secondary' : 'primary'}>{user.role}</Badge>
            </div>
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-muted" aria-hidden />
              <dt className="sr-only">Correo</dt>
              <dd className="break-all">{user.email}</dd>
            </div>
          </dl>
          <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" aria-hidden /> Permisos de su rol
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {user.permissions.map((p) => (
              <li key={p}>
                <Badge tone="muted">{PERMISSION_LABELS[p] ?? p}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-5 lg:col-span-3">
          <Card>
            <h2 className="flex items-center gap-2 font-bold">
              <KeyRound className="size-5 text-primary" aria-hidden /> Cambiar contraseña
            </h2>
            <p className="mt-1 text-sm text-muted">Al cambiarla se cerrarán todas sus sesiones, incluida esta.</p>
            <form onSubmit={onChangePassword} className="mt-5 grid gap-4 md:grid-cols-2">
              {error && <Alert className="md:col-span-2">{error}</Alert>}
              <Input label="Contraseña actual" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={set('currentPassword')} className="md:col-span-2" />
              <Input label="Nueva contraseña" type="password" autoComplete="new-password" required hint="Mínimo 12 caracteres." value={form.newPassword} onChange={set('newPassword')} />
              <Input
                label="Confirmar nueva contraseña"
                type="password"
                autoComplete="new-password"
                required
                error={mismatch ? 'Las contraseñas no coinciden' : undefined}
                value={form.confirm}
                onChange={set('confirm')}
              />
              <div className="md:col-span-2">
                <Button type="submit" loading={saving} disabled={!form.currentPassword || form.newPassword.length < 12 || form.newPassword !== form.confirm}>
                  Actualizar contraseña
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <h2 className="flex items-center gap-2 font-bold">
              <LogOut className="size-5 text-secondary" aria-hidden /> Sesiones activas
            </h2>
            <p className="mt-1 text-sm text-muted">Cierre la sesión en todos los dispositivos donde haya ingresado.</p>
            <Button variant="danger" className="mt-4" onClick={() => setAskLogoutAll(true)}>
              Cerrar todas las sesiones
            </Button>
          </Card>
        </div>
      </div>
      <ConfirmModal
        open={askLogoutAll}
        title="Cerrar todas las sesiones"
        message="Se cerrará la sesión en todos sus dispositivos, incluido este."
        confirmLabel="Cerrar sesiones"
        tone="danger"
        loading={busy}
        onConfirm={onLogoutAll}
        onClose={() => setAskLogoutAll(false)}
      />
    </>
  );
}
