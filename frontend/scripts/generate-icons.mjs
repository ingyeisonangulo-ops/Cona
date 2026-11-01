// Genera los íconos PNG de la PWA sin dependencias (codificador PNG mínimo).
// Motivo: amanecer (sol blanco con trazo rojo) sobre azul institucional.
// Reemplazar por el logo oficial cuando esté disponible (ver DECISIONES.md).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BLUE = [0x1e, 0x65, 0xd6];
const DARK = [0x00, 0x4a, 0xad];
const WHITE = [0xff, 0xff, 0xff];
const RED = [0xd9, 0x04, 0x29];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size);
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// scale < 1 deja margen de seguridad para íconos "maskable".
function art(scale) {
  return (x, y, s) => {
    const u = (x / s - 0.5) / scale;
    const v = (y / s - 0.5) / scale;
    const horizon = 0.12;
    const r = Math.hypot(u, v - horizon);
    if (v > horizon + 0.03 && v < horizon + 0.09 && Math.abs(u) < 0.36) return RED;
    if (v <= horizon && r < 0.26) return WHITE;
    if (v <= horizon && r < 0.32 && r > 0.29) return WHITE;
    if (v > horizon + 0.14 && v < horizon + 0.18 && Math.abs(u) < 0.26) return WHITE;
    return v > 0.42 ? DARK : BLUE;
  };
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const icons = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['maskable-512.png', 512, 0.72],
  ['apple-touch-icon-180.png', 180, 0.9],
];
for (const [name, size, scale] of icons) {
  writeFileSync(new URL(name, out), png(size, art(scale)));
  console.log(`icons/${name}`);
}
