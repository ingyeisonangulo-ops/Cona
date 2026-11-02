import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { get } from '../lib/api.js';
import { IconButton, Spinner } from './ui.jsx';

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const MEDIOS_ORIGEN = ['Redes Sociales', 'Televisión', 'Referido', 'Otro'];
export const MOTIVOS_AUSENCIA = ['Imprevisto', 'Falta de dinero', 'Tiempo', 'No recordaba', 'Otros'];
export const CANALES_CONTACTO = ['Llamada', 'WhatsApp'];

// Fechas de calendario en la zona de la clínica.
export function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fechaLarga = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fechaCorta = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const formatFechaLarga = (ymd) => (ymd ? fechaLarga.format(new Date(`${ymd}T12:00:00Z`)) : '—');
export const formatFecha = (ymd) => (ymd ? fechaCorta.format(new Date(`${ymd}T12:00:00Z`)) : '—');

export function usePeriodo() {
  const [y, m] = todayBogota().split('-').map(Number);
  const [periodo, setPeriodo] = useState({ anio: y, mes: m });
  const move = (delta) =>
    setPeriodo(({ anio, mes }) => {
      const idx = anio * 12 + (mes - 1) + delta;
      return { anio: Math.floor(idx / 12), mes: (idx % 12) + 1 };
    });
  return [periodo, move];
}

export function MonthPicker({ periodo, onMove }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5">
      <IconButton label="Mes anterior" icon={ChevronLeft} onClick={() => onMove(-1)} />
      <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite">
        {MESES[periodo.mes - 1]} {periodo.anio}
      </span>
      <IconButton label="Mes siguiente" icon={ChevronRight} onClick={() => onMove(1)} />
    </div>
  );
}

// Colores de alerta de citas (amarillo 2 días, naranja 1 día / hoy, rojo vencida).
export const ALERTA_STYLES = {
  amarillo: { ring: 'border-l-[3px] border-l-amber-400', badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', label: 'En 2 días' },
  naranja: { ring: 'border-l-[3px] border-l-orange-500', badge: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', label: 'Mañana / hoy' },
  rojo: { ring: 'border-l-[3px] border-l-secondary', badge: 'bg-secondary-soft text-secondary ring-1 ring-secondary/20', label: 'Vencida' },
};

export function AlertaBadge({ alerta }) {
  const s = ALERTA_STYLES[alerta];
  if (!s) return null;
  return <span className={`inline-flex whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-medium ${s.badge}`}>{s.label}</span>;
}

const ESTADO_STYLES = {
  Pendiente: 'bg-subtle text-muted ring-1 ring-line',
  Confirmado: 'bg-primary-soft text-primary',
  Aplazado: 'bg-warning-soft text-warning',
  Cumplida: 'bg-success-soft text-success',
  Ausente: 'bg-secondary-soft text-secondary',
};
export function EstadoBadge({ estado }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-medium ${ESTADO_STYLES[estado] ?? ''}`}><span className="size-1.5 rounded-full bg-current" aria-hidden />{estado}</span>;
}

/** Selector de fecha + slots de 30 min; deshabilita ocupados y pasados. */
export function SlotPicker({ value, onChange, minDate = todayBogota() }) {
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const fecha = value?.fecha ?? '';

  useEffect(() => {
    if (!fecha) return;
    let alive = true;
    setSlots(null);
    setError('');
    get(`/citas/disponibilidad?fecha=${fecha}`)
      .then((d) => alive && setSlots(d.slots))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [fecha]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Fecha
        <input
          type="date"
          min={minDate}
          value={fecha}
          onChange={(e) => onChange({ fecha: e.target.value, hora: '' })}
          className="touch-target rounded-xl border border-line bg-surface px-3.5 text-base focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 md:text-sm"
        />
      </label>
      {fecha && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Hora disponible</legend>
          {error && <p className="text-sm text-secondary">{error}</p>}
          {!slots && !error ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-3 gap-2 xs:grid-cols-4 md:grid-cols-6">
              {slots?.map((s) => {
                const disabled = s.ocupado || s.pasado;
                const selected = value?.hora === s.hora;
                return (
                  <button
                    key={s.hora}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => onChange({ fecha, hora: s.hora })}
                    title={s.ocupado ? 'Ocupado' : s.pasado ? 'Hora pasada' : 'Disponible'}
                    className={`touch-target rounded-xl border text-sm font-semibold transition-colors ${
                      selected
                        ? 'border-primary bg-primary text-white'
                        : disabled
                          ? 'cursor-not-allowed border-line bg-bg text-muted/50 line-through'
                          : 'border-line bg-surface hover:border-primary hover:text-primary'
                    }`}
                  >
                    {s.hora}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}

export function ProgressBar({ value, max, tone = 'primary', label }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const color = tone === 'secondary' ? 'bg-secondary' : tone === 'success' ? 'bg-success' : 'bg-primary';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-subtle ring-1 ring-inset ring-line/60" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full ${color} transition-[width]`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Listas de selección compartidas (colaboradores, servicios, convenios).
export function useCatalogos({ convenios = true } = {}) {
  const [data, setData] = useState({ colaboradores: [], servicios: [], convenios: [], loading: true, error: '' });
  useEffect(() => {
    let alive = true;
    Promise.all([get('/colaboradores'), get('/servicios?status=active'), convenios ? get('/convenios?status=active') : Promise.resolve({ convenios: [] })])
      .then(([c, s, v]) => alive && setData({ colaboradores: c.colaboradores, servicios: s.servicios, convenios: v.convenios, loading: false, error: '' }))
      .catch((e) => alive && setData((d) => ({ ...d, loading: false, error: e.message })));
    return () => {
      alive = false;
    };
  }, [convenios]);
  return data;
}
