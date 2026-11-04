import { useRef, useState } from 'react';
import { Ban, Check, CheckCircle2, History, Pencil, Plus, Search, Trash2, UserCheck } from 'lucide-react';
import { CheckboxNote, RegistrosRecientes } from './registro/Recientes.jsx';
import { MEDIOS_ORIGEN, colaboradoresPara, formatFecha, nombreConCargo, porcentajeUnico, todayBogota, useCatalogos } from '../components/business.jsx';
import { Alert, Button, Card, IconButton, Input, PageHeader, Select } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { formatCOP } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';

const EMPTY_PACIENTE = { nombre: '', apellido: '', telefono: '', fechaNacimiento: '', medioOrigen: '' };
const newItem = () => ({ key: crypto.randomUUID(), servicioId: '', colaboradorId: '', convenioId: '', otros: null });

// Estimado en pantalla; el valor definitivo lo calcula el servidor.
function previewValor(item, servicios, convenios) {
  if (item.otros) return Number(item.otros.valor || 0);
  const s = servicios.find((x) => x.id === item.servicioId);
  if (!s) return null;
  const c = convenios.find((x) => x.id === item.convenioId);
  const pct = c?.tipo === 'cumpleanos' ? (porcentajeUnico(c.porcentajeDescuentoCategoria) ?? 0) : Number(c?.porcentajeDescuentoCategoria?.[s.categoriaId] ?? 0);
  return Math.round(s.valorPublico * (100 - pct)) / 100;
}

const PASOS = ['Paciente', 'Servicios', 'Confirmar'];

// Indicador de avance del registro (informativo: el formulario es uno solo).
function Pasos({ actual }) {
  return (
    <ol aria-label="Pasos del registro" className="mb-5 flex flex-wrap gap-2">
      {PASOS.map((p, i) => {
        const hecho = i < actual;
        const activo = i === actual;
        return (
          <li
            key={p}
            aria-current={activo ? 'step' : undefined}
            className={`flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-[13px] font-semibold ${
              hecho ? 'bg-success-soft text-success' : activo ? 'bg-primary-soft text-primary' : 'border border-line bg-surface text-muted'
            }`}
          >
            <span className={`grid size-7 place-items-center rounded-full text-xs ${hecho ? 'bg-success-strong text-white' : activo ? 'bg-primary text-white' : 'bg-subtle'}`}>
              {hecho ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            {p}
            {hecho && <span className="sr-only">(completado)</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default function RegistroPage() {
  const cat = useCatalogos();
  const [cedula, setCedula] = useState('');
  const [lookup, setLookup] = useState(null); // { existe, paciente } | null
  const [buscando, setBuscando] = useState(false);
  const [paciente, setPaciente] = useState(EMPTY_PACIENTE);
  const [fecha, setFecha] = useState(todayBogota());
  const [items, setItems] = useState([newItem()]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const cedulaRef = useRef(null);

  const existe = lookup?.existe === true;
  const personalDisabled = !lookup || existe;

  async function buscar() {
    const value = cedula.trim();
    if (!value) return;
    setBuscando(true);
    setError('');
    setOk(null);
    try {
      const d = await get(`/pacientes/cedula/${encodeURIComponent(value)}`);
      setLookup(d);
      setPaciente(
        d.paciente
          ? { nombre: d.paciente.nombre, apellido: d.paciente.apellido, telefono: d.paciente.telefono, fechaNacimiento: d.paciente.fechaNacimiento ?? '', medioOrigen: d.paciente.medioOrigen }
          : EMPTY_PACIENTE,
      );
    } catch (err) {
      setLookup(null);
      setError(err.message);
    } finally {
      setBuscando(false);
    }
  }

  function resetCedula(value) {
    setCedula(value);
    if (lookup) {
      setLookup(null);
      setPaciente(EMPTY_PACIENTE);
    }
  }

  const setItem = (key, patch) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  // Convenio Cumpleaños: solo en el mes de cumpleaños y en un único día de ese
  // mes, para toda la cuenta (todos los servicios salvo los de valor manual).
  const convenioCumple = cat.convenios.find((c) => c.tipo === 'cumpleanos');
  const cumplePct = porcentajeUnico(convenioCumple?.porcentajeDescuentoCategoria) ?? 0;
  const pacienteId = lookup?.paciente?.id;
  const uso = useResource(pacienteId ? `/pacientes/${pacienteId}/cumpleanos-uso?fecha=${fecha}` : null);
  const usadoEn = pacienteId ? (uso.data?.usadoEn ?? null) : null;
  const enMesCumple = Boolean(lookup) && paciente.fechaNacimiento?.slice(5, 7) === fecha.slice(5, 7);
  const cumpleDisponible = enMesCumple && cumplePct > 0 && (!usadoEn || usadoEn === fecha);
  const conveniosVisibles = cat.convenios.filter((c) => c.tipo !== 'cumpleanos' || cumpleDisponible);
  // Si cambia la fecha o el paciente y deja de aplicar, el servicio queda sin convenio.
  const itemsVigentes = items.map((i) => (i.convenioId && i.convenioId === convenioCumple?.id && !cumpleDisponible ? { ...i, convenioId: '' } : i));
  const cumpleActivo = itemsVigentes.some((i) => i.convenioId && i.convenioId === convenioCumple?.id);

  function setConvenio(key, convenioId) {
    const cambiaCumple = convenioId === convenioCumple?.id || items.find((i) => i.key === key)?.convenioId === convenioCumple?.id;
    if (!cambiaCumple) return setItem(key, { convenioId });
    // El convenio Cumpleaños se pone o se quita en toda la cuenta.
    setItems((list) => list.map((i) => (i.otros ? i : { ...i, convenioId: convenioId === convenioCumple?.id ? convenioId : i.key === key ? convenioId : '' })));
  }

  const total = itemsVigentes.reduce((a, i) => a + (previewValor(i, cat.servicios, cat.convenios) ?? 0), 0);
  const listo = Boolean(lookup) && items.every((i) => i.servicioId && i.colaboradorId);

  async function onSubmit(e) {
    e.preventDefault();
    if (!lookup) return buscar();
    setSaving(true);
    setError('');
    try {
      const body = {
        cedula: cedula.trim(),
        fecha,
        paciente: existe ? undefined : paciente,
        items: itemsVigentes.map((i) => ({
          servicioId: i.servicioId,
          colaboradorId: i.colaboradorId,
          convenioId: i.convenioId || null,
          otros: i.otros ? { valor: Number(i.otros.valor), motivo: i.otros.motivo } : null,
        })),
      };
      const d = await post('/atenciones', body);
      setOk({ nombre: `${d.paciente.nombre} ${d.paciente.apellido}`, cantidad: d.servicios.length, nuevo: d.pacienteNuevo });
      setCedula('');
      setLookup(null);
      setPaciente(EMPTY_PACIENTE);
      setItems([newItem()]);
      setReload((n) => n + 1);
      cedulaRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Operación" title="Registrar servicios" description="Inicie con la cédula del paciente (RF-08)." />
      <Pasos actual={!lookup ? 0 : listo ? 2 : 1} />
      <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-5">
        <Card className="flex flex-col gap-4 lg:col-span-2">
          <h2 className="text-base font-bold">Paciente</h2>
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
              Cédula
              <input
                ref={cedulaRef}
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                value={cedula}
                onChange={(e) => resetCedula(e.target.value)}
                onBlur={() => cedula && !lookup && buscar()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    buscar();
                  }
                }}
                className="h-14 w-full rounded-2xl border border-line bg-subtle px-4 font-display text-xl font-semibold tracking-wider placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal focus:border-primary focus:bg-surface focus:outline-none focus:ring-4 focus:ring-primary-soft"
                placeholder="Número de documento"
              />
            </label>
            <Button variant="dark" icon={Search} loading={buscando} onClick={buscar} aria-label="Buscar cédula" className="h-14 rounded-2xl">
              <span className="hidden md:inline">Buscar</span>
            </Button>
          </div>

          {existe && (
            <Alert tone="success">
              <span className="flex items-center gap-1.5 font-semibold">
                <UserCheck className="size-4" aria-hidden /> El paciente ya está registrado
              </span>
              Solo puede seleccionar los servicios realizados.
            </Alert>
          )}
          {lookup && !existe && <Alert tone="success">Paciente nuevo: complete sus datos.</Alert>}
          {cumpleDisponible && (
            <Alert tone="success">Mes de cumpleaños: puede elegir el convenio Cumpleaños ({cumplePct}%) para toda la cuenta de este día.</Alert>
          )}
          {enMesCumple && usadoEn && usadoEn !== fecha && <Alert>Ya usó el convenio Cumpleaños este mes ({formatFecha(usadoEn)}).</Alert>}

          <fieldset disabled={personalDisabled} className="grid gap-3 disabled:opacity-70 md:grid-cols-2">
            <legend className="sr-only">Datos personales</legend>
            <Input label="Nombre" required={!existe} value={paciente.nombre} onChange={(e) => setPaciente({ ...paciente, nombre: e.target.value })} />
            <Input label="Apellido" required={!existe} value={paciente.apellido} onChange={(e) => setPaciente({ ...paciente, apellido: e.target.value })} />
            <Input label="Teléfono" type="tel" inputMode="tel" required={!existe} value={paciente.telefono} onChange={(e) => setPaciente({ ...paciente, telefono: e.target.value })} />
            <Input label="Fecha de nacimiento" type="date" min="1900-01-01" max={todayBogota()} required={!existe} value={paciente.fechaNacimiento} onChange={(e) => setPaciente({ ...paciente, fechaNacimiento: e.target.value })} />
            <Select label="Medio de origen" className="md:col-span-2" required={!existe} value={paciente.medioOrigen} onChange={(e) => setPaciente({ ...paciente, medioOrigen: e.target.value })}>
              <option value="">Seleccione…</option>
              {MEDIOS_ORIGEN.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </fieldset>
        </Card>

        <Card className="flex flex-col gap-4 lg:col-span-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-base font-bold">Servicios realizados</h2>
            <Input label="Fecha de atención" type="date" max={todayBogota()} value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-44" />
          </div>
          {cat.error && <Alert>{cat.error}</Alert>}
          <fieldset disabled={!lookup} className="flex flex-col gap-3 disabled:opacity-60">
            <legend className="sr-only">Servicios</legend>
            {itemsVigentes.map((item, idx) => {
              const valor = previewValor(item, cat.servicios, cat.convenios);
              return (
                <div key={item.key} className="rounded-2xl border border-line p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2.5 text-sm font-semibold"><span className="tabular grid size-8 place-items-center rounded-xl bg-primary-soft text-xs font-bold text-primary">{String(idx + 1).padStart(2, '0')}</span>Servicio {idx + 1}</span>
                    {items.length > 1 && <IconButton label="Quitar servicio" icon={Trash2} onClick={() => setItems((l) => l.filter((i) => i.key !== item.key))} />}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Select
                      label="Servicio"
                      required
                      value={item.servicioId}
                      onChange={(e) => {
                        const servicioId = e.target.value;
                        const validos = colaboradoresPara(servicioId, cat.servicios, cat.colaboradores);
                        setItem(item.key, { servicioId, ...(!validos.some((c) => c.id === item.colaboradorId) && { colaboradorId: '' }) });
                      }}
                    >
                      <option value="">Seleccione…</option>
                      {cat.servicios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre}
                        </option>
                      ))}
                    </Select>
                    <Select label="Colaborador" required value={item.colaboradorId} onChange={(e) => setItem(item.key, { colaboradorId: e.target.value })}>
                      <option value="">Seleccione…</option>
                      {colaboradoresPara(item.servicioId, cat.servicios, cat.colaboradores).map((c) => (
                        <option key={c.id} value={c.id}>
                          {nombreConCargo(c)}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label="Convenio"
                      value={item.convenioId}
                      disabled={Boolean(item.otros)}
                      selectClassName={item.convenioId && item.convenioId === convenioCumple?.id ? 'bg-yellow-200! font-semibold' : undefined}
                      onChange={(e) => setConvenio(item.key, e.target.value)}
                    >
                      <option value="">Sin convenio</option>
                      {conveniosVisibles.map((c) => (
                        <option key={c.id} value={c.id} className={c.tipo === 'cumpleanos' ? 'bg-yellow-200 font-semibold' : undefined}>
                          {c.nombre}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {item.otros ? (
                    <div className="mt-3 grid gap-3 rounded-xl border border-secondary/30 bg-secondary-soft/40 p-3 md:grid-cols-3">
                      <Input label="Valor manual (COP)" type="number" min="0" step="1" required value={item.otros.valor} onChange={(e) => setItem(item.key, { otros: { ...item.otros, valor: e.target.value } })} />
                      <Input label="Motivo del valor manual" required minLength={5} className="md:col-span-2" value={item.otros.motivo} onChange={(e) => setItem(item.key, { otros: { ...item.otros, motivo: e.target.value } })} />
                      <Button variant="ghost" className="md:col-span-3 md:justify-self-start" onClick={() => setItem(item.key, { otros: null })}>
                        Usar valor del catálogo
                      </Button>
                    </div>
                  ) : (
                    <CheckboxNote onClick={() => setItem(item.key, { otros: { valor: '', motivo: '' }, convenioId: '' })} />
                  )}
                  <p className="mt-2 text-right text-sm">
                    Valor a cobrar: <strong className="text-primary">{valor == null ? '—' : formatCOP(valor)}</strong>
                  </p>
                </div>
              );
            })}
            <Button variant="dashed" icon={Plus} onClick={() => setItems((l) => [...l, { ...newItem(), convenioId: cumpleActivo ? convenioCumple.id : '' }])} className="w-full">
              Agregar servicio
            </Button>
          </fieldset>

          {error && <Alert>{error}</Alert>}
          {ok && (
            <Alert tone="success">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4" aria-hidden />
                {ok.cantidad} servicio(s) registrados para {ok.nombre}
                {ok.nuevo ? ' (paciente nuevo)' : ''}.
              </span>
            </Alert>
          )}
          <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-line pt-4 md:flex-row md:items-center">
            <p className="text-sm text-muted">
              Total estimado <strong className="tabular block font-display text-[1.75rem] font-bold leading-tight tracking-tight text-text">{formatCOP(total)}</strong>
              <span className="block text-xs">El valor definitivo lo calcula el servidor.</span>
            </p>
            <Button type="submit" loading={saving} disabled={!lookup}>
              Registrar atención
            </Button>
          </div>
        </Card>
      </form>

      <RegistrosRecientes reloadKey={reload} icons={{ Pencil, History, Ban }} />
    </>
  );
}
