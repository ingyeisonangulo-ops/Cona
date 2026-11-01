import { useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');

const BUTTON_VARIANTS = {
  primary: 'bg-primary text-white hover:bg-primary-hover shadow-sm',
  secondary: 'bg-secondary text-white hover:brightness-95 shadow-sm',
  outline: 'border border-line bg-surface text-text hover:bg-bg',
  ghost: 'text-muted hover:bg-bg hover:text-text',
  danger: 'border border-secondary/30 bg-secondary-soft text-secondary hover:bg-secondary hover:text-white',
};

export function Button({ variant = 'primary', loading = false, className, children, icon: Icon, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'touch-target inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
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
      className={cx('touch-target inline-grid place-items-center rounded-xl text-muted transition-colors hover:bg-bg hover:text-text', className)}
      {...props}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

export function Field({ label, hint, error, children, className }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
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

const inputBase =
  'touch-target w-full rounded-xl border border-line bg-surface px-3.5 text-base text-text placeholder:text-muted/70 transition-colors focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 md:text-sm';

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

export function Alert({ tone = 'error', children, className }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  const styles = tone === 'error' ? 'border-secondary/25 bg-secondary-soft text-secondary' : 'border-success/25 bg-success-soft text-success';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm', styles, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
      {label}
    </div>
  );
}

export function StatusBadge({ status }) {
  const active = status === 'active';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        active ? 'bg-success-soft text-success' : 'bg-bg text-muted',
      )}
    >
      <span className={cx('size-1.5 rounded-full', active ? 'bg-success' : 'bg-muted')} aria-hidden />
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}

export function Badge({ children, tone = 'primary' }) {
  const tones = {
    primary: 'bg-primary-soft text-primary',
    secondary: 'bg-secondary-soft text-secondary',
    muted: 'bg-bg text-muted',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function Card({ className, children }) {
  return <section className={cx('rounded-card border border-line/70 bg-surface p-4 shadow-card md:p-6', className)}>{children}</section>;
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:mb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-text md:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {Icon && (
        <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <p className="font-semibold text-text">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

// Tabla con scroll horizontal contenido (no desborda la página en móvil).
export function TableWrap({ children }) {
  return (
    <div className="-mx-4 overflow-x-auto overscroll-x-contain md:mx-0">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">{children}</table>
    </div>
  );
}
export const th = 'sticky top-0 border-b border-line bg-surface px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted';
export const td = 'border-b border-line/70 px-4 py-3 align-middle';

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
        'm-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-card bg-surface p-0 text-text shadow-pop backdrop:bg-ink/45 backdrop:backdrop-blur-[2px] md:m-auto md:rounded-card',
        widths[size],
      )}
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 pb-4 pt-5">
            <div>
              <h2 id="modal-title" className="text-lg font-bold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
            <IconButton label="Cerrar" icon={X} onClick={onClose} className="-mr-2 -mt-2" />
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="pb-safe flex flex-col-reverse gap-2 border-t border-line bg-bg/50 px-5 py-4 md:flex-row md:justify-end">{footer}</footer>}
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
