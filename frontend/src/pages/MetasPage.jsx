import { useEffect, useState } from 'react';
import { Pencil, Repeat, Target } from 'lucide-react';
import { MonthPicker, usePeriodo } from '../components/business.jsx';
import { Alert, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, TableWrap, td, th } from '../components/ui.jsx';
import { get, put } from '../lib/api.js';
import { formatCOP, formatNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

function MetaModal({ row, periodo, onClose, onSaved }) {
  const m = row.meta;
  const [form, setForm] = useState({
    metaPuntos: m ? String(m.metaPuntos) : '',
    metaDinero: m ? String(m.metaDinero) : '',
    valorPuntoAdicional: m ? String(m.valorPuntoAdicional) : '',
  });
  const [ajustar, setAjustar] = useState(Boolean(m?.distribucionSemanal));
  const [semanas, setSemanas] = useState((m?.distribucionSemanal ?? m?.propuestaSemanal ?? ['', '', '', '']).map(String));
  const [propuesta, setPropuesta] = useState(m?.propuestaSemanal ?? null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Propuesta automática del servidor al cambiar la meta mensual.
  useEffect(() => {
    const n = Number(form.metaPuntos);
    if (!Number.isInteger(n) || n < 1) return setPropuesta(null);
    const t = setTimeout(() => {
      get(`/metas/propuesta?anio=${periodo.anio}&mes=${periodo.mes}&metaPuntos=${n}`)
        .then((d) => {
          setPropuesta(d.semanas);
          if (!ajustar) setSemanas(d.semanas.map(String));
        })
        .catch(() => setPropuesta(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form.metaPuntos, periodo.anio, periodo.mes, ajustar]);

  const suma = semanas.reduce((a, b) => a + Number(b || 0), 0);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await put('/metas', {
        colaboradorId: row.colaboradorId,
        ...periodo,
        metaPuntos: Number(form.metaPuntos),
        metaDinero: Number(form.metaDinero),
        valorPuntoAdicional: Number(form.valorPuntoAdicional),
        distribucionSemanal: ajustar ? semanas.map(Number) : null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Meta de ${row.nombre}`}
      description="La comisión solo aplica si se cumple la meta en puntos: (puntos logrados − meta) × valor del punto adicional."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="meta-form" loading={saving} disabled={ajustar && suma !== Number(form.metaPuntos)}>
            Guardar meta
          </Button>
        </>
      }
    >
      <form id="meta-form" onSubmit={save} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 md:grid-cols-3">
          <Input label="Meta en puntos" type="number" min="1" step="1" required value={form.metaPuntos} onChange={set('metaPuntos')} />
          <Input label="Meta en dinero (COP)" type="number" min="0" step="1" required value={form.metaDinero} onChange={set('metaDinero')} />
          <Input label="Valor punto adicional (COP)" type="number" min="0" step="1" required value={form.valorPuntoAdicional} onChange={set('valorPuntoAdicional')} />
        </div>
        <fieldset className="rounded-2xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Distribución semanal (puntos)</legend>
          <p className="mb-3 text-xs text-muted">Semanas: 1–7, 8–14, 15–21 y 22–fin de mes (los días 29–31 se suman a la semana 4).</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {semanas.map((v, i) => (
              <Input
                key={i}
                label={`Semana ${i + 1}`}
                type="number"
                min="0"
                step="1"
                disabled={!ajustar}
                value={v}
                hint={propuesta ? `Propuesta: ${propuesta[i]}` : undefined}
                onChange={(e) => setSemanas((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
          </div>
          <label className="touch-target mt-3 flex items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={ajustar}
              onChange={(e) => {
                setAjustar(e.target.checked);
                if (!e.target.checked && propuesta) setSemanas(propuesta.map(String));
              }}
            />
            <span className="text-sm font-semibold">Ajustar manualmente la propuesta</span>
          </label>
          {ajustar && suma !== Number(form.metaPuntos) && (
            <p className="text-xs text-secondary">
              La suma ({suma}) debe ser igual a la meta ({form.metaPuntos || 0}).
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

function RecurrenciaCard() {
  const res = useResource('/configuracion/recurrencia');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const [saving, setSaving] = useState(false);
  const cfg = form ?? (res.data ? { puntosNivel60: String(res.data.configuracion.puntosNivel60), puntosNivel80: String(res.data.configuracion.puntosNivel80) } : null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg({ error: '', ok: '' });
    try {
      await put('/configuracion/recurrencia', { puntosNivel60: Number(cfg.puntosNivel60), puntosNivel80: Number(cfg.puntosNivel80) });
      setMsg({ error: '', ok: 'Configuración guardada.' });
      res.reload();
      setForm(null);
    } catch (err) {
      setMsg({ error: err.message, ok: '' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-bold">
        <Repeat className="size-5 text-primary" aria-hidden /> Puntos por recurrencia
      </h2>
      <p className="mt-1 text-sm text-muted">Se otorgan automáticamente a los colaboradores con meta cuando la tasa global de pacientes que vuelven alcanza el nivel.</p>
      {!cfg ? (
        <Spinner />
      ) : (
        <form onSubmit={save} className="mt-4 grid gap-3 md:grid-cols-3 md:items-end">
          <Input label="Puntos nivel ≥ 60%" type="number" min="0" value={cfg.puntosNivel60} onChange={(e) => setForm({ ...cfg, puntosNivel60: e.target.value })} />
          <Input label="Puntos nivel ≥ 80%" type="number" min="0" value={cfg.puntosNivel80} onChange={(e) => setForm({ ...cfg, puntosNivel80: e.target.value })} />
          <Button type="submit" loading={saving}>
            Guardar
          </Button>
          {msg.error && <Alert className="md:col-span-3">{msg.error}</Alert>}
          {msg.ok && <Alert tone="success" className="md:col-span-3">{msg.ok}</Alert>}
        </form>
      )}
    </Card>
  );
}

export default function MetasPage() {
  const [periodo, move] = usePeriodo();
  const res = useResource(`/metas?anio=${periodo.anio}&mes=${periodo.mes}`);
  const [editing, setEditing] = useState(null);
  const rows = res.data?.metas ?? [];

  return (
    <>
      <PageHeader title="Metas y comisiones" description="Asignación mensual por colaborador y propuesta en 4 semanas." actions={<MonthPicker periodo={periodo} onMove={move} />} />
      {res.error && <Alert className="mb-4">{res.error}</Alert>}
      {res.loading && !res.data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Target} title="No hay colaboradores activos">
            Cree usuarios con rol Colaborador para asignarles metas.
          </EmptyState>
        </Card>
      ) : (
        <Card flush>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Colaborador</th>
                <th className={`${th} text-right`}>Meta puntos</th>
                <th className={th}>Semanas (1–4)</th>
                <th className={`${th} text-right`}>Meta dinero</th>
                <th className={`${th} text-right`}>Valor punto adic.</th>
                <th className={th}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.colaboradorId} className="hover:bg-bg/60">
                  <td className={td}>
                    <p className="font-semibold">{r.nombre}</p>
                    {r.cargo && <p className="text-xs text-muted">{r.cargo}</p>}
                  </td>
                  {r.meta ? (
                    <>
                      <td className={`${td} text-right font-bold text-primary`}>{formatNumber(r.meta.metaPuntos)}</td>
                      <td className={`${td} whitespace-nowrap text-muted`}>
                        {(r.meta.distribucionSemanal ?? r.meta.propuestaSemanal).join(' · ')}
                        {r.meta.distribucionSemanal && <span className="ml-1 text-xs text-secondary">(ajustada)</span>}
                      </td>
                      <td className={`${td} text-right`}>{formatCOP(r.meta.metaDinero)}</td>
                      <td className={`${td} text-right`}>{formatCOP(r.meta.valorPuntoAdicional)}</td>
                    </>
                  ) : (
                    <td className={`${td} text-muted`} colSpan={4}>
                      Sin meta asignada
                    </td>
                  )}
                  <td className={td}>
                    <Button variant={r.meta ? 'outline' : 'primary'} icon={Pencil} className="px-3" onClick={() => setEditing(r)}>
                      {r.meta ? 'Editar' : 'Asignar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
      <div className="mt-6">
        <RecurrenciaCard />
      </div>
      {editing && (
        <MetaModal
          row={editing}
          periodo={periodo}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            res.reload();
          }}
        />
      )}
    </>
  );
}
