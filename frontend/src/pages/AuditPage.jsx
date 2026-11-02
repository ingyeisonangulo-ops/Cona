import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { get } from '../lib/api.js';
import { ACTION_LABELS, formatDateTime } from '../lib/format.js';

const DANGER = new Set(['LOGIN_FAILED', 'ACCOUNT_LOCKED', 'IP_LOCKED', 'LOGIN_BLOCKED', 'REFRESH_TOKEN_REUSE', 'USER_DEACTIVATED']);

function summary(log) {
  const m = log.metadata ?? {};
  if (log.action === 'ROLE_CHANGED') return `${m.from} → ${m.to}`;
  if (m.from && m.to) return `${m.from} → ${m.to}`;
  if (m.email) return m.email;
  if (m.after?.nombre) return m.after.nombre;
  if (m.nombre) return m.nombre;
  return '';
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [logs, setLogs] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(before) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (before) params.set('before', before);
      if (action) params.set('action', action);
      const d = await get(`/audit-logs?${params}`);
      setLogs((prev) => (before ? [...prev, ...d.logs] : d.logs));
      setNext(d.nextBefore);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [action]);

  return (
    <>
      <PageHeader
        title="Bitácora de auditoría"
        description="Registro inmutable de accesos y operaciones de la organización."
        actions={
          <select
            aria-label="Filtrar por acción"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="touch-target rounded-xl border border-line bg-surface px-3 text-base focus:border-primary focus:outline-none md:text-sm"
          >
            <option value="">Todas las acciones</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      />
      {error && <Alert className="mb-4">{error}</Alert>}
      {loading && logs.length === 0 ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="Sin registros" />
        </Card>
      ) : (
        <Card flush>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Fecha</th>
                <th className={th}>Acción</th>
                <th className={th}>Usuario</th>
                <th className={th}>Detalle</th>
                <th className={th}>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDateTime(l.createdAt)}</td>
                  <td className={td}>
                    <Badge tone={DANGER.has(l.action) ? 'secondary' : 'primary'}>{ACTION_LABELS[l.action] ?? l.action}</Badge>
                  </td>
                  <td className={td}>{l.actor ? l.actor.fullName : <span className="text-muted">—</span>}</td>
                  <td className={`${td} max-w-xs truncate text-muted`} title={summary(l)}>
                    {l.entityType && <span className="mr-1 font-medium text-text">{l.entityType}</span>}
                    {summary(l)}
                  </td>
                  <td className={`${td} font-mono text-xs text-muted`}>{l.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {next && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" loading={loading} onClick={() => load(next)}>
            Cargar más
          </Button>
        </div>
      )}
    </>
  );
}
