import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public');
mkdirSync(OUT, { recursive: true });

const BRAND = Object.freeze({
  midnight: [11, 16, 39],
  border: [188, 52, 124],
  orange: [255, 170, 83],
  coral: [255, 142, 73],
  pink: [241, 75, 110],
  magenta: [214, 56, 124],
  white: [255, 253, 246],
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, rgb) {
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    scanlines[row] = 0;
    rgb.copy(scanlines, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND'),
  ]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insideCircle(x, y, cx, cy, radius) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insideEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function sampleBrand(x, y, { maskable = false } = {}) {
  let color = BRAND.midnight;

  if (!maskable) {
    const outer = insideRoundedRect(x, y, 22, 22, 490, 490, 112);
    const inner = insideRoundedRect(x, y, 25, 25, 487, 487, 109);
    if (outer && !inner) color = BRAND.border;
  }

  const cx = 256;
  const cy = maskable ? 250 : 246;
  const radius = maskable ? 112 : 124;
  if (insideCircle(x, y, cx, cy, radius)) {
    if (y < cy - 12) color = BRAND.orange;
    else if (x < cx - 18) color = BRAND.magenta;
    else if (x > cx + 18) color = BRAND.pink;
    else color = BRAND.coral;

    if (y >= cy + 12 && insideEllipse(x, y, cx, cy + 172, 118, 160)) {
      color = BRAND.midnight;
    }
  }

  const star = [
    [cx, cy - 52], [cx + 15, cy - 15], [cx + 52, cy], [cx + 15, cy + 15],
    [cx, cy + 52], [cx - 15, cy + 15], [cx - 52, cy], [cx - 15, cy - 15],
  ];
  if (insidePolygon(x, y, star)) color = BRAND.white;
  return color;
}

function render(size, options = {}) {
  const rgb = Buffer.alloc(size * size * 3);
  const samples = 4;
  const inv = 1 / (samples * samples);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = ((px + (sx + 0.5) / samples) / size) * 512;
          const y = ((py + (sy + 0.5) / samples) / size) * 512;
          const color = sampleBrand(x, y, options);
          sum[0] += color[0];
          sum[1] += color[1];
          sum[2] += color[2];
        }
      }
      const offset = (py * size + px) * 3;
      rgb[offset] = Math.round(sum[0] * inv);
      rgb[offset + 1] = Math.round(sum[1] * inv);
      rgb[offset + 2] = Math.round(sum[2] * inv);
    }
  }
  return encodePng(size, size, rgb);
}

const targets = [
  ['pwa-192.png', 192, false],
  ['pwa-512.png', 512, false],
  ['pwa-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];

for (const [name, size, maskable] of targets) {
  const path = resolve(OUT, name);
  const png = render(size, { maskable });
  writeFileSync(path, png, { mode: 0o644 });
  process.stdout.write(`generated ${name} ${size}x${size} (${png.length} bytes)\n`);
}
