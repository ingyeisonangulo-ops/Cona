import { useState } from 'react';
import { PenLine } from 'lucide-react';
import { addDays, colaboradoresPara, formatFecha, nombreConCargo, todayBogota, useCatalogos } from '../../components/business.jsx';
import { Alert, Badge, Button, Card, EmptyState, IconButton, Input, Modal, Select, Spinner, TableWrap, td, th } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { patch, put } from '../../lib/api.js';
import { formatCOP, formatDateTime } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';

// Botón explícito para activar "Otros" (valor manual).
export function CheckboxNote({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="touch-target mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:underline">
      <PenLine className="size-4" aria-hidden /> Otros (ingresar valor manual)
    </button>
  );
}

function EditModal({ sr, onClose, onSaved }) {
  const cat = useCatalogos();
  const [form, setForm] = useState({
    servicioId: sr.servicioId,
    colaboradorId: sr.colaboradorId,
    convenioId: sr.convenioId ?? '',
    fecha: sr.fecha,
    otros: sr.valorManual ? { valor: String(sr.valorCobrado), motivo: sr.motivoValorManual ?? '' } : null,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await put(`/servicios-realizados/${sr.id}`, {
        ...form,
        convenioId: form.convenioId || null,
        otros: form.otros ? { valor: Number(form.otros.valor), motivo: form.otros.motivo } : null,
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
      onClose={onClose}
      title="Editar servicio realizado"
      description={`${sr.paciente.nombre} · la edición queda en el historial inmutable.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="sr-edit" loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="sr-edit" onSubmit={save} className="grid gap-4 md:grid-cols-2">
        {error && <Alert className="md:col-span-2">{error}</Alert>}
        <Select label="Servicio" value={form.servicioId} onChange={set('servicioId')}>
          {cat.servicios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </Select>
        <Select label="Colaborador" required value={form.colaboradorId} onChange={set('colaboradorId')}>
          <option value="">Seleccione…</option>
          {colaboradoresPara(form.servicioId, cat.servicios, cat.colaboradores).map((c) => (
            <option key={c.id} value={c.id}>
              {nombreConCargo(c)}
            </option>
          ))}
        </Select>
        <Select label="Convenio" value={form.convenioId} disabled={Boolean(form.otros)} onChange={set('convenioId')}>
          <option value="">Sin convenio</option>
          {cat.convenios.filter((c) => c.tipo !== 'cumpleanos' || c.id === sr.convenioId).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Select>
        <Input label="Fecha" type="date" max={todayBogota()} value={form.fecha} onChange={set('fecha')} />
        {form.otros ? (
          <>
            <Input label="Valor manual (COP)" type="number" min="0" value={form.otros.valor} onChange={(e) => setForm((f) => ({ ...f, otros: { ...f.otros, valor: e.target.value } }))} />
            <Input label="Motivo" value={form.otros.motivo} onChange={(e) => setForm((f) => ({ ...f, otros: { ...f.otros, motivo: e.target.value } }))} />
            <Button variant="ghost" onClick={() => setForm((f) => ({ ...f, otros: null }))} className="md:col-span-2 md:justify-self-start">
              Usar valor del catálogo
            </Button>
          </>
        ) : (
          <div className="md:col-span-2">
            <CheckboxNote onClick={() => setForm((f) => ({ ...f, otros: { valor: '', motivo: '' }, convenioId: '' }))} />
          </div>
        )}
      </form>
    </Modal>
  );
}

function HistorialModal({ sr, onClose }) {
  const res = useResource(`/servicios-realizados/${sr.id}/historial`);
  return (
    <Modal open size="lg" onClose={onClose} title="Historial de cambios" description="Registro inmutable de quién y cuándo agregó o modificó el servicio.">
      {res.loading ? (
        <Spinner />
      ) : res.error ? (
        <Alert>{res.error}</Alert>
      ) : (
        <ol className="flex flex-col gap-3">
          {res.data.historial.map((h) => (
            <li key={h.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={h.operacion === 'INSERT' ? 'primary' : 'secondary'}>{h.operacion === 'INSERT' ? 'Registro' : 'Modificación'}</Badge>
                <span className="text-xs text-muted">{formatDateTime(h.fecha)}</span>
              </div>
              <p className="mt-2">
                <strong>{h.usuario ?? '—'}</strong> · {formatFecha(h.fechaServicio)} · {formatCOP(h.valorCobrado)}
                {h.valorManual && ' (valor manual)'} · {h.estado}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function AnularModal({ sr, onClose, onSaved }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError('');
    try {
      await patch(`/servicios-realizados/${sr.id}/anular`, { motivo });
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
      onClose={onClose}
      title="Anular servicio realizado"
      description="El registro se conserva para auditoría y deja de contar en métricas y puntos."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="secondary" loading={saving} disabled={motivo.trim().length < 5} onClick={save}>
            Anular
          </Button>
        </>
      }
    >
      {error && <Alert className="mb-4">{error}</Alert>}
      <Input label="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} hint="Mínimo 5 caracteres." />
    </Modal>
  );
}

export function RegistrosRecientes({ reloadKey, icons }) {
  const { can } = useAuth();
  const desde = addDays(todayBogota(), -7);
  const res = useResource(`/servicios-realizados?desde=${desde}&estado=all&_=${reloadKey}`);
  const [modal, setModal] = useState(null); // { kind, sr }
  const list = res.data?.servicios ?? [];
  const close = () => setModal(null);
  const saved = () => {
    setModal(null);
    res.reload();
  };
  const { Pencil, History, Ban } = icons;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold">Registros de los últimos 7 días</h2>
      {res.error && <Alert className="mb-3">{res.error}</Alert>}
      {res.loading && !res.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState title="Aún no hay registros recientes" />
        </Card>
      ) : (
        <Card flush>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Fecha</th>
                <th className={th}>Paciente</th>
                <th className={th}>Servicio</th>
                <th className={th}>Colaborador</th>
                <th className={`${th} text-right`}>Valor</th>
                <th className={th}>Registró</th>
                <th className={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.map((sr) => (
                <tr key={sr.id} className={sr.estado === 'anulado' ? 'opacity-60' : 'hover:bg-bg/60'}>
                  <td className={`${td} whitespace-nowrap`}>{formatFecha(sr.fecha)}</td>
                  <td className={td}>
                    <p className="font-semibold">{sr.paciente.nombre}</p>
                    <p className="text-xs text-muted">{sr.paciente.cedula}</p>
                  </td>
                  <td className={td}>
                    {sr.servicio}
                    {sr.convenio && <p className="text-xs text-muted">{sr.convenio}</p>}
                  </td>
                  <td className={td}>{sr.colaborador}</td>
                  <td className={`${td} text-right font-semibold`}>
                    {formatCOP(sr.valorCobrado)}
                    {sr.valorManual && <p className="text-xs font-normal text-secondary">Manual</p>}
                    {sr.estado === 'anulado' && <p className="text-xs font-normal text-secondary">Anulado</p>}
                  </td>
                  <td className={`${td} text-xs text-muted`}>{sr.registradoPor}</td>
                  <td className={td}>
                    <div className="flex gap-1">
                      {sr.estado !== 'anulado' && <IconButton label="Editar" icon={Pencil} onClick={() => setModal({ kind: 'edit', sr })} />}
                      <IconButton label="Historial" icon={History} onClick={() => setModal({ kind: 'hist', sr })} />
                      {sr.estado !== 'anulado' && can('MANAGE_SERVICES') && (
                        <IconButton label="Anular" icon={Ban} className="hover:text-secondary" onClick={() => setModal({ kind: 'anular', sr })} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {modal?.kind === 'edit' && <EditModal sr={modal.sr} onClose={close} onSaved={saved} />}
      {modal?.kind === 'hist' && <HistorialModal sr={modal.sr} onClose={close} />}
      {modal?.kind === 'anular' && <AnularModal sr={modal.sr} onClose={close} onSaved={saved} />}
    </section>
  );
}
