import { useState } from 'react';
import { Copy, KeyRound, Lock, LockOpen, Pencil, Power, PowerOff, UserPlus, Users } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  TableWrap,
  td,
  th,
} from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { patch, post } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { PUESTOS, etiquetaPuesto, puestoDe } from '../lib/cargos.js';
import { useResource } from '../lib/useResource.js';

const ROLES = ['Super Admin', 'Gerente', 'Asistente', 'Colaborador'];

function UserModal({ initial, assignableRoles, onClose, onSaved }) {
  const [form, setForm] = useState({
    email: initial?.email ?? '',
    fullName: initial?.fullName ?? '',
    puesto: initial ? puestoDe(initial) : PUESTOS[0].value,
    password: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const p = PUESTOS.find((x) => x.value === form.puesto);
    const rolYCargo = { role: p.role, ...(p.cargo && { cargo: p.cargo }) };
    try {
      if (initial) await patch(`/users/${initial.id}`, { fullName: form.fullName, ...rolYCargo });
      else await post('/users', { email: form.email, fullName: form.fullName, password: form.password, ...rolYCargo });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // El rol actual se muestra aunque no sea asignable (p. ej. Super Admin visto por un Gerente).
  const puestos = PUESTOS.filter((p) => assignableRoles.includes(p.role) || p.value === form.puesto);
  const colaborador = PUESTOS.find((p) => p.value === form.puesto)?.role === 'Colaborador';

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Editar usuario' : 'Nuevo usuario'}
      description={initial ? 'Un cambio de rol cierra las sesiones activas del usuario.' : 'El usuario deberá cambiar la contraseña temporal al ingresar.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form" loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Input label="Nombre completo" required maxLength={200} value={form.fullName} onChange={set('fullName')} />
        <Input label="Correo electrónico" type="email" required disabled={Boolean(initial)} value={form.email} onChange={set('email')} autoComplete="off" />
        <Select
          label="Rol"
          value={form.puesto}
          onChange={set('puesto')}
          disabled={initial?.isSelf}
          hint={
            colaborador
              ? 'Colaborador: ve su progreso y solo los servicios asignados a su cargo.'
              : form.puesto === 'Asistente'
                ? 'Asistente: opera agenda y registro, y también realiza servicios y tiene metas.'
                : undefined
          }
        >
          <optgroup label="Colaboradores">
            {puestos
              .filter((p) => p.role === 'Colaborador')
              .map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Administrativos">
            {puestos
              .filter((p) => p.role !== 'Colaborador')
              .map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
          </optgroup>
        </Select>
        {!initial && (
          <Input
            label="Contraseña temporal"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            hint="Mínimo 12 caracteres. Entréguela por un canal seguro."
            value={form.password}
            onChange={set('password')}
          />
        )}
      </form>
    </Modal>
  );
}

function ResetLinkModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.resetUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Modal open title="Enlace de restablecimiento" description={`Para ${result.user.fullName}`} onClose={onClose} footer={<Button onClick={onClose}>Listo</Button>}>
      <div className="flex flex-col gap-4">
        <Alert tone="success">Las sesiones activas del usuario se cerraron.</Alert>
        <p className="text-sm text-muted">
          Entregue este enlace de un solo uso al usuario por un canal seguro. Vence el {formatDateTime(result.expiresAt)} y no se volverá a mostrar.
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-bg p-2">
          <code className="min-w-0 flex-1 break-all px-1 text-xs">{result.resetUrl}</code>
          <IconButton label={copied ? 'Copiado' : 'Copiar enlace'} icon={Copy} onClick={copy} />
        </div>
        {copied && <p className="text-xs text-success">Enlace copiado al portapapeles.</p>}
      </div>
    </Modal>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const res = useResource('/users');
  const [editing, setEditing] = useState(undefined);
  const [confirm, setConfirm] = useState(null); // { kind, user }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetResult, setResetResult] = useState(null);

  const isSuper = me.role === 'Super Admin';
  const assignableRoles = isSuper ? ROLES : ROLES.filter((r) => r !== 'Super Admin');
  const canManage = (u) => isSuper || u.role !== 'Super Admin';
  const users = res.data?.users ?? [];

  const CONFIRMS = {
    status: (u) => ({
      title: u.status === 'active' ? 'Desactivar usuario' : 'Activar usuario',
      message: u.status === 'active' ? `${u.fullName} no podrá ingresar y sus sesiones se cerrarán.` : `${u.fullName} podrá volver a ingresar.`,
      label: u.status === 'active' ? 'Desactivar' : 'Activar',
      tone: u.status === 'active' ? 'danger' : 'primary',
      run: () => patch(`/users/${u.id}/status`, { status: u.status === 'active' ? 'inactive' : 'active' }),
    }),
    unlock: (u) => ({
      title: 'Desbloquear cuenta',
      message: `Se reiniciarán los intentos fallidos de ${u.fullName}.`,
      label: 'Desbloquear',
      run: () => post(`/users/${u.id}/unlock`),
    }),
    reset: (u) => ({
      title: 'Restablecer contraseña',
      message: `Se generará un enlace de un solo uso para ${u.fullName} y se cerrarán todas sus sesiones activas.`,
      label: 'Generar enlace',
      tone: 'danger',
      run: async () => setResetResult({ ...(await post(`/users/${u.id}/reset-password`)), user: u }),
    }),
  };
  const c = confirm && CONFIRMS[confirm.kind](confirm.user);

  async function runConfirm() {
    setBusy(true);
    setError('');
    try {
      await c.run();
      setConfirm(null);
      res.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const rowActions = (u) => {
    if (!canManage(u)) return <span className="text-xs text-muted">Solo Super Admin</span>;
    const self = u.id === me.id;
    return (
      <div className="flex flex-wrap gap-1">
        <IconButton label="Editar" icon={Pencil} onClick={() => setEditing({ ...u, isSelf: self })} />
        {u.lockedUntil && <IconButton label="Desbloquear cuenta" icon={LockOpen} onClick={() => setConfirm({ kind: 'unlock', user: u })} className="text-secondary" />}
        {!self && u.status === 'active' && <IconButton label="Restablecer contraseña" icon={KeyRound} onClick={() => setConfirm({ kind: 'reset', user: u })} />}
        {!self && (
          <IconButton
            label={u.status === 'active' ? 'Desactivar' : 'Activar'}
            icon={u.status === 'active' ? PowerOff : Power}
            onClick={() => setConfirm({ kind: 'status', user: u })}
            className={u.status === 'active' ? 'hover:text-secondary' : 'hover:text-success'}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Cuentas del personal de la clínica."
        actions={
          <Button icon={UserPlus} onClick={() => setEditing(null)}>
            Nuevo usuario
          </Button>
        }
      />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !res.data ? (
        <Spinner />
      ) : users.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No hay usuarios" />
        </Card>
      ) : (
        <Card flush>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Usuario</th>
                <th className={th}>Rol</th>
                <th className={th}>Estado</th>
                <th className={th}>Último ingreso</th>
                <th className={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-bg/60">
                  <td className={td}>
                    <p className="font-semibold">
                      {u.fullName} {u.id === me.id && <span className="text-xs font-normal text-muted">(usted)</span>}
                    </p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td className={td}>
                    <Badge tone={u.role === 'Super Admin' ? 'secondary' : u.role === 'Colaborador' ? 'teal' : 'primary'}>{etiquetaPuesto(u)}</Badge>
                    {u.role === 'Colaborador' && <p className="mt-1 text-xs text-muted">Colaborador</p>}
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={u.status} />
                      {u.lockedUntil && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-1 text-xs font-semibold text-secondary">
                          <Lock className="size-3" aria-hidden /> Bloqueada
                        </span>
                      )}
                      {u.mustChangePassword && <Badge tone="muted">Clave temporal</Badge>}
                    </div>
                  </td>
                  <td className={`${td} text-muted`}>{formatDateTime(u.lastLoginAt)}</td>
                  <td className={td}>{rowActions(u)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {editing !== undefined && (
        <UserModal
          initial={editing}
          assignableRoles={assignableRoles}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            res.reload();
          }}
        />
      )}
      <ConfirmModal
        open={Boolean(c)}
        title={c?.title}
        message={c?.message}
        confirmLabel={c?.label}
        tone={c?.tone}
        loading={busy}
        error={error}
        onConfirm={runConfirm}
        onClose={() => {
          setConfirm(null);
          setError('');
        }}
      />
      {resetResult && <ResetLinkModal result={resetResult} onClose={() => setResetResult(null)} />}
    </>
  );
}
