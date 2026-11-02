// Logo oficial de CONA (IPS Centro Odontológico Nuevo Amanecer del Pacífico SAS).
// Las imágenes se generan con `npm --prefix frontend run icons` a partir de
// frontend/branding/logo-cona-original.png.
const ALT = 'CONA · IPS Centro Odontológico Nuevo Amanecer del Pacífico SAS';

// Isotipo (diente): favicon, encabezado compacto.
export function LogoMark({ className = 'size-10' }) {
  return <img src="/brand/isotipo.png" alt={ALT} className={`object-contain ${className}`} width={40} height={40} />;
}

/**
 * variant:
 *  - "marca"    "cona" + diente (barra lateral). Por defecto.
 *  - "completo" con nombre de la IPS y lema (login).
 * compact: solo el isotipo.
 * El logo tiene texto oscuro: sobre fondos de color se muestra en una placa blanca.
 */
export function Logo({ variant = 'marca', compact = false, onDark = false, className = '' }) {
  if (compact) return <LogoMark className="size-10 shrink-0" />;
  const src = variant === 'completo' ? '/brand/logo-completo.png' : '/brand/logo-marca.png';
  const img = (
    <img
      src={src}
      alt={ALT}
      className={`h-auto w-full object-contain ${className}`}
      width={variant === 'completo' ? 960 : 640}
      height={variant === 'completo' ? 417 : 197}
    />
  );
  return onDark ? <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">{img}</div> : img;
}
