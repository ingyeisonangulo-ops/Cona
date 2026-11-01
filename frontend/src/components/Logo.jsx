// Isotipo provisional (amanecer sobre el Pacífico). Reemplazar por el logo
// oficial en este componente y en public/icons cuando esté disponible.
export function LogoMark({ className = 'size-10', inverted = false }) {
  const bg = inverted ? '#FFFFFF' : '#1E65D6';
  const fg = inverted ? '#1E65D6' : '#FFFFFF';
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Nuevo Amanecer del Pacífico">
      <rect width="64" height="64" rx="16" fill={bg} />
      <path d="M14 38a18 18 0 0 1 36 0z" fill={fg} />
      <rect x="10" y="41" width="44" height="4" rx="2" fill="#D90429" />
      <rect x="18" y="49" width="28" height="3" rx="1.5" fill={fg} />
    </svg>
  );
}

export function Logo({ inverted = false, compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark inverted={inverted} className="size-10 shrink-0" />
      {!compact && (
        <div className="leading-tight">
          <p className={`text-[15px] font-extrabold tracking-tight ${inverted ? 'text-white' : 'text-text'}`}>Nuevo Amanecer</p>
          <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${inverted ? 'text-white/75' : 'text-muted'}`}>
            del Pacífico · IPS
          </p>
        </div>
      )}
    </div>
  );
}
