// Genera las variantes web del logo oficial y los íconos de la PWA a partir de
// frontend/branding/logo-cona-original.png (no se publica: pesa ~1,5 MB).
//
//   npm --prefix frontend run icons
//
// Salidas:
//   public/brand/logo-completo.png     logo con nombre y lema (login)
//   public/brand/logo-marca.png        "cona" + diente (barra lateral)
//   public/brand/isotipo.png               solo el diente (encabezado compacto)
//   public/favicon.png, public/icons/*     favicon e íconos de instalación
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../branding/logo-cona-original.png', import.meta.url));
const out = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
mkdirSync(out('brand'), { recursive: true });
mkdirSync(out('icons'), { recursive: true });

// Regiones del original (2492×1268 px).
const COMPLETO = { left: 65, top: 168, width: 2306, height: 1001 };
const MARCA = { left: 65, top: 168, width: 2306, height: 712 }; // sin nombre ni lema
const DIENTE = { left: 1560, top: 168, width: 820, height: 700 };

// El diente toca la letra "a": se retiran los grises/negros de esa zona.
async function isotipo() {
  const { data, info } = await sharp(SRC).extract(DIENTE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const gx = DIENTE.left + x;
      const gy = DIENTE.top + y;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (gx < 1720 && gy > 380 && gy < 800 && sat < 45 && (r + g + b) / 3 < 235) data[i + 3] = 0;
    }
  }
  return sharp(data, { raw: info }).trim().png().toBuffer();
}

async function variante(region, name, width) {
  // sharp aplica trim antes que extract en un mismo pipeline: se hace en dos pasos.
  const recorte = await sharp(SRC).extract(region).png().toBuffer();
  const base = sharp(recorte).trim().resize({ width, withoutEnlargement: true });
  await base.clone().png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out(`brand/${name}.png`));
  console.log(`brand/${name}.png`);
}

// Ícono cuadrado: isotipo centrado sobre blanco con margen (padding = fracción del lado).
async function icono(diente, size, padding, file, background = '#ffffff') {
  const inner = Math.round(size * (1 - padding * 2));
  const img = await sharp(diente).resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: img, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(out(file));
  console.log(file);
}

await variante(COMPLETO, 'logo-completo', 960);
await variante(MARCA, 'logo-marca', 640);
const diente = await isotipo();
await sharp(diente).resize({ width: 256 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out('brand/isotipo.png'));
console.log('brand/isotipo.png');

await icono(diente, 192, 0.1, 'icons/icon-192.png');
await icono(diente, 512, 0.1, 'icons/icon-512.png');
await icono(diente, 512, 0.2, 'icons/maskable-512.png'); // zona segura de íconos "maskable"
await icono(diente, 180, 0.12, 'icons/apple-touch-icon-180.png');
await icono(diente, 64, 0.04, 'favicon.png', { r: 0, g: 0, b: 0, alpha: 0 });
