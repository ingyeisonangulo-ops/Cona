import { useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, Loader2, TrendingDown, TrendingUp, X } from 'lucide-react';

export const cx = (...c) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- Botones
const BUTTON_VARIANTS = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  dark: 'bg-ink text-white hover:bg-ink/85',
  dashed: 'border border-dashed border-primary-line bg-primary-soft/50 text-primary hover:bg-primary-soft',
  secondary: 'bg-secondary text-white shadow-sm hover:brightness-95',
  outline: 'border border-line bg-surface text-text hover:border-faint/60 hover:bg-subtle',
  ghost: 'text-muted hover:bg-subtle hover:text-text',
  soft: 'bg-primary-soft text-primary hover:bg-primary hover:text-white',
  danger: 'bg-secondary-soft text-secondary hover:bg-secondary hover:text-white',
};

export function Button({ variant = 'primary', loading = false, className, children, icon: Icon, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'touch-target inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ label, icon: Icon, className, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('touch-target inline-grid place-items-center rounded-xl text-muted transition-colors hover:bg-subtle hover:text-text', className)}
      {...props}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------- Formularios
export function Field({ label, hint, error, children, className }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-text">
        {label}
      </label>
      {children(id, error ? `${id}-err` : hint ? `${id}-hint` : undefined)}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-secondary">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export const inputBase =
  'touch-target w-full rounded-xl border border-line bg-subtle px-3.5 text-base text-text placeholder:text-faint transition-colors hover:border-faint/50 focus:border-primary focus:bg-surface focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-70 md:text-sm';

export function Input({ label, hint, error, className, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => <input id={id} aria-describedby={describedBy} aria-invalid={Boolean(error)} className={inputBase} {...props} />}
    </Field>
  );
}

export function Textarea({ label, hint, error, className, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={3} className={cx(inputBase, 'py-2.5')} {...props} />}
    </Field>
  );
}

export function Select({ label, hint, error, className, children, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <select id={id} aria-describedby={describedBy} className={cx(inputBase, 'pr-8')} {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}

/** Control segmentado (Todos / Pendiente / …, Año / Mes / Día). */
export function Segmented({ value, onChange, options, label, size = 'md', className }) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex gap-1 overflow-x-auto rounded-full bg-subtle p-1', className)}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors',
              size === 'sm' ? 'min-h-9' : 'min-h-10',
              active ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
            )}
          >
            {opt.icon && <opt.icon className="size-4" aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Feedback
export function Alert({ tone = 'error', children, className }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  const styles = tone === 'error' ? 'bg-secondary-soft text-secondary ring-secondary/15' : 'bg-success-soft text-success ring-success/15';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm ring-1', styles, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
      {label}
    </div>
  );
}

// ---------------------------------------------------------------- Pastillas y avatares
const TONES = {
  primary: 'bg-primary-soft text-primary',
  secondary: 'bg-secondary-soft text-secondary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  teal: 'bg-teal-soft text-[#0f766e]',
  violet: 'bg-violet-soft text-[#6d28d9]',
  muted: 'bg-subtle text-soft-text',
};
export const toneClass = (tone) => TONES[tone] ?? TONES.muted;

export function Badge({ children, tone = 'primary', dot = false, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', toneClass(tone), className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  return (
    <Badge tone={status === 'active' ? 'success' : 'muted'} dot>
      {status === 'active' ? 'Activo' : 'Inactivo'}
    </Badge>
  );
}

const AVATAR_TONES = ['bg-primary', 'bg-[#0f766e]', 'bg-[#7c3aed]', 'bg-[#c2410c]', 'bg-[#0369a1]', 'bg-[#be185d]'];
export function initials(name = '') {
  return name
    .replace(/^Dra?\.\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
export function Avatar({ name, size = 'md', className }) {
  const tone = AVATAR_TONES[[...(name ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  const sizes = { sm: 'size-8 text-[11px]', md: 'size-9 text-xs', lg: 'size-11 text-sm' };
  return (
    <span className={cx('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', tone, sizes[size], className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------- Tarjetas
/** Tarjeta con encabezado opcional (título, descripción, acciones). */
export function Card({ className, children, compact = false, flush = false, title, description, actions, icon: Icon, bodyClassName }) {
  return (
    <section className={cx('min-w-0 rounded-card border border-line bg-surface shadow-card', flush ? 'p-0' : compact ? 'p-4' : 'p-5 md:p-6', className)}>
      {(title || actions) && (
        <header className={cx('mb-4 flex items-start justify-between gap-3', flush && 'px-5 pt-5 md:px-6')}>
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon className="size-[18px]" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="truncate text-base font-bold text-text">{title}</h2>}
              {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * KPI: etiqueta, cifra grande, variación y un ícono en cuadro con tinte.
 * delta: número (positivo sube) o texto; tone del ícono: primary | success | warning | secondary | teal | violet.
 * highlight: tarjeta destacada en azul noche (una por pantalla); children va debajo (p. ej. mini tendencia).
 */
export function StatCard({ label, value, hint, delta, icon: Icon, tone = 'primary', highlight = false, className, children }) {
  const up = typeof delta === 'number' ? delta >= 0 : null;
  return (
    <section
      className={cx(
        'flex min-w-0 flex-col gap-3 rounded-card p-5',
        highlight ? 'bg-night text-white' : 'border border-line bg-surface shadow-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cx('text-[13px] font-medium', highlight ? 'text-night-muted' : 'text-muted')}>{label}</p>
          <p className={cx('tabular mt-2 truncate font-display text-[1.75rem] font-bold leading-tight tracking-tight', highlight ? 'text-white' : 'text-text')}>{value}</p>
          {(delta != null || hint) && (
            <p className={cx('mt-1.5 flex flex-wrap items-center gap-1 text-xs', highlight ? 'text-night-muted' : 'text-muted')}>
              {up != null && (
                <span
                  className={cx(
                    'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-semibold',
                    highlight ? 'bg-white/10 text-white' : up ? 'bg-success-soft text-success' : 'bg-secondary-soft text-secondary-ink',
                  )}
                >
                  {up ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
                  {Math.abs(delta)}%
                </span>
              )}
              {typeof delta === 'string' && <span className={cx('font-semibold', highlight ? 'text-white' : 'text-text')}>{delta}</span>}
              {hint}
            </p>
          )}
        </div>
        {Icon && (
          <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', highlight ? 'bg-white/10 text-night-accent' : toneClass(tone))}>
            <Icon className="size-5" aria-hidden />
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** Mini tendencia (sparkline) para la tarjeta destacada. Decorativa: el valor ya está en la cifra. */
export function Sparkline({ values, className, color = 'var(--color-night-accent)' }) {
  if (!values?.length || values.length < 2) return null;
  const w = 240;
  const h = 44;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - (v / max) * (h - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cx('h-11 w-full', className)} aria-hidden>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} opacity="0.14" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-[13px] font-medium text-muted">{eyebrow}</p>}
        <h1 className="text-[1.625rem] font-bold leading-tight tracking-tight text-text md:text-[1.875rem]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {Icon && (
        <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <p className="font-display font-bold text-text">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Tablas
// Encabezado en "píldora" gris claro y filas separadas por líneas finas.
// El scroll horizontal queda contenido en la tarjeta (móvil).
// fixed: anchos de columna estables (los <th> definen su ancho; el resto se reparte por igual).
export function TableWrap({ children, fixed = false, minWidth = 'min-w-[640px]' }) {
  return (
    <div className="overflow-x-auto overscroll-x-contain p-2">
      <table className={cx('w-full border-separate border-spacing-0 text-left text-sm', minWidth, fixed && 'table-fixed')}>{children}</table>
    </div>
  );
}
export const th = 'bg-subtle px-4 py-2.5 text-xs font-medium text-muted first:rounded-l-xl last:rounded-r-xl whitespace-nowrap';
export const td = 'border-b border-line/70 px-4 py-3 align-middle';

// ---------------------------------------------------------------- Modales
export function Modal({ open, title, description, onClose, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const widths = { md: 'md:max-w-lg', lg: 'md:max-w-2xl' };
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        'm-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[20px] bg-surface p-0 text-text shadow-pop backdrop:bg-ink/40 backdrop:backdrop-blur-[2px] md:m-auto md:rounded-[20px]',
        widths[size],
      )}
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-start justify-between gap-3 px-6 pb-2 pt-6">
            <div>
              <h2 id="modal-title" className="text-lg font-bold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
            <IconButton label="Cerrar" icon={X} onClick={onClose} className="-mr-2 -mt-2" />
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
          {footer && (
            <footer className="flex flex-col-reverse gap-3 border-t border-line px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 md:flex-row md:justify-end">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmModal({ open, title, message, confirmLabel = 'Confirmar', tone = 'primary', loading, error, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={tone === 'danger' ? 'secondary' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
      {error && <Alert className="mt-4">{error}</Alert>}
    </Modal>
  );
}
