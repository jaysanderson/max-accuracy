// Generates PWA PNG icons with zero dependencies (hand-rolled PNG encoder on
// node:zlib). Ruler motif: dark field, amber bar with white ticks.
// Run: node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const u = size / 64; // design units on a 64-grid
  // bg: near-black with rounded corners
  const radius = 12 * u;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const cy = Math.max(radius - y, y - (size - 1 - radius), 0);
      if (Math.hypot(cx, cy) > radius) { set(x, y, 0, 0, 0, 0); continue; }
      set(x, y, 9, 9, 11);
    }
  }
  // amber ruler bar across the middle
  const barTop = Math.round(26 * u);
  const barBot = Math.round(38 * u);
  for (let y = barTop; y < barBot; y++)
    for (let x = Math.round(8 * u); x < Math.round(56 * u); x++) set(x, y, 92, 229, 0);
  // white ticks
  for (let t = 0; t <= 8; t++) {
    const tx = Math.round((10 + t * 5.5) * u);
    const tall = t % 2 === 0;
    for (let y = barTop; y < barTop + Math.round((tall ? 8 : 5) * u); y++)
      for (let x = tx; x < tx + Math.max(1, Math.round(1.2 * u)); x++) set(x, y, 255, 255, 255);
  }
  // green end-caps (the datum handles)
  for (let y = Math.round(20 * u); y < Math.round(44 * u); y++) {
    for (let x = Math.round(5 * u); x < Math.round(8 * u); x++) set(x, y, 138, 255, 79);
    for (let x = Math.round(56 * u); x < Math.round(59 * u); x++) set(x, y, 138, 255, 79);
  }
  return encodePng(px, size, size);
}

mkdirSync(join(root, 'public'), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(root, 'public', `icon-${size}.png`), drawIcon(size));
  console.log(`icon-${size}.png`);
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#09090b"/><rect x="8" y="26" width="48" height="12" fill="#5ce500"/><g fill="#fff">${Array.from({ length: 9 }, (_, t) => `<rect x="${10 + t * 5.5}" y="26" width="1.2" height="${t % 2 === 0 ? 8 : 5}"/>`).join('')}</g><rect x="5" y="20" width="3" height="24" fill="#8aff4f"/><rect x="56" y="20" width="3" height="24" fill="#8aff4f"/></svg>`;
writeFileSync(join(root, 'public', 'icon.svg'), svg);
console.log('icon.svg');
