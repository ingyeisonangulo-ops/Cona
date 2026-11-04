import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Table2 } from 'lucide-react';
import { formatNumber } from '../lib/format.js';
import { cx } from './ui.jsx';

// Colores de estado (reservados: siempre acompañados de su etiqueta).
export const STATUS_COLORS = {
  good: 'var(--color-success)',
  warning: '#d97706',
  critical: 'var(--color-secondary)',
};
// Orden categórico fijo (validado: daltonismo y separación). "Otro" va en gris.
export const SERIES = ['#1e65d6', '#14b8a6', '#8b5cf6', '#f59e0b'];
export const OTHER = '#94a3b8';

const compact = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
export const formatCompact = (v) => compact.format(v);

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// Curva monótona suave (sin sobrepasar los datos).
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  const d = [`M${pts[0][0]},${pts[0][1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx1 = x0 + (x1 - x0) / 2;
    d.push(`C${cx1},${y0} ${cx1},${y1} ${x1},${y1}`);
  }
  return d.join(' ');
}

/** Botón "Tabla" + tabla accesible equivalente a la gráfica. */
function useTableToggle() {
  const [tabla, setTabla] = useState(false);
  const button = (
    <button
      type="button"
      onClick={() => setTabla((t) => !t)}
      aria-pressed={tabla}
      className="touch-target -my-2 inline-flex items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted hover:text-primary"
    >
      <Table2 className="size-4" aria-hidden /> {tabla ? 'Gráfica' : 'Tabla'}
    </button>
  );
  return [tabla, button];
}

function ChartFrame({ title, description, extra, button, children, className }) {
  const id = useId();
  return (
    <figure className={cx('flex h-full min-w-0 flex-col rounded-card border border-line bg-surface p-5 shadow-card md:p-6', className)} aria-labelledby={`${id}-t`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <figcaption className="min-w-0">
          <h3 id={`${id}-t`} className="text-base font-bold text-text">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </figcaption>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          {button}
        </div>
      </div>
      {children}
    </figure>
  );
}

function Legend({ items }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

// =========================================================================
// Área / línea suavizada (serie temporal)
// data: [{ label, values: { [key]: number } }]; series: [{ key, label, color }]
// =========================================================================
export function AreaChart({ title, description, data, series, format = formatNumber, height = 220, className }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const [tabla, button] = useTableToggle();
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const W = width;
  const H = height;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0))));
  const x = (i) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(data.length / Math.max(4, Math.floor(iw / 56))));

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = data.map((d, i) => [x(i), y(d.values[s.key] ?? 0)]);
        const line = smoothPath(pts);
        const area = pts.length ? `${line} L${pts.at(-1)[0]},${pad.t + ih} L${pts[0][0]},${pad.t + ih} Z` : '';
        return { ...s, line, area };
      }),
    [data, series, W, H, max],
  );

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  const gid = useId().replace(/:/g, '');
  return (
    <ChartFrame title={title} description={description} button={button} extra={series.length > 1 && <Legend items={series} />} className={className}>
      {data.length === 0 ? (
        <p className="grid flex-1 place-items-center py-10 text-sm text-muted">Sin datos en el periodo</p>
      ) : tabla ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-1 font-medium">Periodo</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-t border-line">
                  <td className="py-1.5">{d.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1.5 text-right font-medium">
                      {format(d.values[s.key] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            role="img"
            aria-label={`${title}. Use el botón Tabla para ver los valores.`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            className="block touch-none"
          >
            <defs>
              {paths.map((s) => (
                <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.16" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)">
                  {formatCompact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % every === 0 || i === data.length - 1 ? (
                <text key={d.label} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-faint)">
                  {d.short ?? d.label}
                </text>
              ) : null,
            )}
            {paths.map((s) => (
              <g key={s.key}>
                <path d={s.area} fill={`url(#${gid}-${s.key})`} />
                <path d={s.line} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ))}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--color-faint)" strokeWidth="1" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(data[hover].values[s.key] ?? 0)} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>
          {hover != null && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-pop"
              style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 70px), calc(100% - 150px))` }}
            >
              <p className="mb-1 font-semibold">{data[hover].label}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.label}: <strong>{format(data[hover].values[s.key] ?? 0)}</strong>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </ChartFrame>
  );
}

// =========================================================================
// Dona: proporciones de un todo (≤ 5 partes), valor central y leyenda.
// data: [{ label, value, color }]
// =========================================================================
export function DonutChart({ title, description, data, centerValue, centerLabel, format = formatNumber, className, size = 168 }) {
  const [tabla, button] = useTableToggle();
  const [hover, setHover] = useState(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && data.filter((d) => d.value > 0).length > 1 ? 3 : 0;
  let acc = 0;
  const pct = (v) => (total ? Math.round((v / total) * 1000) / 10 : 0);

  return (
    <ChartFrame title={title} description={description} button={button} className={className}>
      {total === 0 ? (
        <p className="grid flex-1 place-items-center py-10 text-sm text-muted">Sin datos en el periodo</p>
      ) : tabla ? (
        <LegendTable data={data} format={format} pct={pct} />
      ) : (
        <div className="flex flex-1 flex-col items-center gap-5 xs:flex-row xs:justify-center">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${pct(d.value)}%`).join(', ')}`}>
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-subtle)" strokeWidth="16" />
              {data.map((d, i) => {
                const len = (d.value / total) * c;
                const dash = Math.max(0, len - gap);
                const el = (
                  <circle
                    key={d.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={d.color}
                    strokeWidth={hover === i ? 20 : 16}
                    strokeDasharray={`${dash} ${c - dash}`}
                    strokeDashoffset={-acc}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    style={{ transition: 'stroke-width 120ms' }}
                  />
                );
                acc += len;
                return d.value > 0 ? el : null;
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="tabular text-2xl font-semibold tracking-tight text-text">
                  {hover != null ? `${pct(data[hover].value)}%` : (centerValue ?? format(total))}
                </p>
                <p className="max-w-24 text-[11px] leading-tight text-muted">{hover != null ? data[hover].label : (centerLabel ?? 'Total')}</p>
              </div>
            </div>
          </div>
          <ul className="flex w-full max-w-60 flex-col gap-2.5 text-sm">
            {data.map((d, i) => (
              <li key={d.label} className="flex items-center justify-between gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <span className="flex min-w-0 items-center gap-2 text-muted">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden />
                  <span className="truncate">{d.label}</span>
                </span>
                <span className="tabular whitespace-nowrap font-medium text-text">
                  {format(d.value)} <span className="text-xs font-normal text-faint">· {pct(d.value)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartFrame>
  );
}

function LegendTable({ data, format, pct }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-muted">
          <th className="py-1 font-medium">Categoría</th>
          <th className="py-1 text-right font-medium">Cantidad</th>
          <th className="py-1 text-right font-medium">%</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.label} className="border-t border-line">
            <td className="py-1.5">{d.label}</td>
            <td className="py-1.5 text-right font-medium">{format(d.value)}</td>
            <td className="py-1.5 text-right text-muted">{pct(d.value)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// =========================================================================
// Columnas finas con pista de fondo (conteos por categoría, una serie).
// data: [{ label, value, color? }]
// =========================================================================
export function ColumnChart({ title, description, data, height = 150, unit = 'casos', format = formatNumber, className }) {
  const [hover, setHover] = useState(null);
  const [tabla, button] = useTableToggle();
  const total = data.reduce((a, d) => a + d.value, 0);
  const max = Math.max(1, ...data.map((d) => d.value));
  const pct = (v) => (total ? Math.round((v / total) * 1000) / 10 : 0);

  return (
    <ChartFrame title={title} description={description} button={button} className={className}>
      {total === 0 ? (
        <p className="grid flex-1 place-items-center py-8 text-sm text-muted">Sin datos en el periodo</p>
      ) : tabla ? (
        <LegendTable data={data} format={format} pct={pct} />
      ) : (
        <div className="mt-auto">
          <div className="flex items-end justify-around gap-1 md:gap-3" style={{ height }} role="list">
            {data.map((d, i) => {
              const h = d.value ? Math.max(6, (d.value / max) * (height - 24)) : 0;
              return (
                <div
                  key={d.label}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${d.label}: ${format(d.value)} ${unit} (${pct(d.value)}%)`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
                >
                  <span className="tabular mb-1.5 text-xs font-semibold text-text">{format(d.value)}</span>
                  <span className="relative flex w-full max-w-5 flex-1 items-end overflow-hidden rounded-t-[6px] bg-subtle" style={{ maxHeight: height - 24 }}>
                    <span
                      className="w-full rounded-t-[6px] transition-[height,opacity] group-hover:opacity-85 group-focus-visible:ring-2 group-focus-visible:ring-primary/40"
                      style={{ height: h, background: d.color ?? 'var(--color-primary)' }}
                    />
                  </span>
                  {hover === i && (
                    <span role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-pop">
                      <strong>{d.label}</strong>: {format(d.value)} {unit} · {pct(d.value)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-around gap-1 border-t border-line pt-2 md:gap-3">
            {data.map((d) => (
              <span key={d.label} className="flex min-w-0 flex-1 items-start justify-center gap-1 text-center text-[11px] leading-tight text-muted">
                {d.color && <span className="mt-0.5 size-2 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden />}
                {d.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </ChartFrame>
  );
}

/** Barra de progreso fina con pista. */
export function Meter({ value, max, color = 'var(--color-primary)', label, className }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-subtle ring-1 ring-inset ring-line/60', className)} role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
