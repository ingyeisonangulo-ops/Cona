import { Check, Minus, ShieldCheck } from 'lucide-react';
import { Alert, Badge, Card, PageHeader, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { PERMISSION_LABELS } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

// Vista de solo lectura generada dinámicamente desde matrix.json (vía /api/roles).
export default function RolesPage() {
  const res = useResource('/roles');
  const roles = res.data?.roles ?? [];
  const permissions = res.data?.permissions ?? [];

  return (
    <>
      <PageHeader
        title="Roles y permisos"
        description="Matriz de permisos vigente (solo lectura). La fuente única es matrix.json en el servidor."
      />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !res.data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {roles.map((r) => (
              <Card key={r.name} className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-white">
                  <ShieldCheck className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-bold">{r.name}</p>
                  <p className="text-xs text-muted">{r.all ? 'Acceso total' : `${r.permissions.length} permisos`}</p>
                </div>
              </Card>
            ))}
          </div>
          <Card flush>
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Permiso</th>
                  {roles.map((r) => (
                    <th key={r.name} className={`${th} text-center`}>
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((p) => (
                  <tr key={p}>
                    <td className={td}>
                      <p className="font-medium">{PERMISSION_LABELS[p] ?? p}</p>
                      <p className="font-mono text-[11px] text-muted">{p}</p>
                    </td>
                    {roles.map((r) => (
                      <td key={r.name} className={`${td} text-center`}>
                        {r.permissions.includes(p) ? (
                          <Check className="mx-auto size-5 text-primary" aria-label="Permitido" />
                        ) : (
                          <Minus className="mx-auto size-4 text-line" aria-label="No permitido" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <p className="mt-3 text-xs text-muted">
            <Badge tone="muted">Nota</Badge> Para modificar permisos se edita matrix.json y se despliega una nueva versión; el cambio queda versionado.
          </p>
        </>
      )}
    </>
  );
}
