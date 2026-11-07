import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public');
const SOURCE_DIR = resolve(ROOT, 'scripts/brand');
mkdirSync(OUT, { recursive: true });

// Platform icons are rasterized from the approved ribbon-O artwork stored in
// scripts/brand/. The source PNGs are written with filter type 0 on every row
// so this dependency-free decoder stays small and auditable; the decoder
// refuses anything else instead of guessing.

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

function decodeSourcePng(path) {
  const png = readFileSync(path);
  if (png.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error(`BRAND_ICON_SOURCE_NOT_PNG: ${path}`);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new Error(`BRAND_ICON_SOURCE_UNSUPPORTED: ${path}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 3;
  if (raw.length !== stride * height) throw new Error(`BRAND_ICON_SOURCE_SIZE_MISMATCH: ${path}`);
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * stride] !== 0) throw new Error(`BRAND_ICON_SOURCE_FILTERED: ${path}`);
    raw.copy(rgb, y * width * 3, y * stride + 1, (y + 1) * stride);
  }
  return { width, height, rgb };
}

// Area-average downscale: each destination pixel averages the source box it
// covers, which keeps the ribbon edges smooth at favicon sizes.
function resizeArea(source, size) {
  const { width, height, rgb } = source;
  const out = Buffer.alloc(size * size * 3);
  const scaleX = width / size;
  const scaleY = height / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let sy = y0; sy < y1 && sy < height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < width; sx += 1) {
          const at = (sy * width + sx) * 3;
          r += rgb[at];
          g += rgb[at + 1];
          b += rgb[at + 2];
          count += 1;
        }
      }
      const at = (y * size + x) * 3;
      out[at] = Math.round(r / count);
      out[at + 1] = Math.round(g / count);
      out[at + 2] = Math.round(b / count);
    }
  }
  return { width: size, height: size, rgb: out };
}

// Maskable icons keep the artwork inside the safe zone (center 80%) over the
// artwork's own midnight-blue background, sampled from its corner pixel.
function renderMaskable(source, size) {
  const bg = [source.rgb[0], source.rgb[1], source.rgb[2]];
  const innerSize = Math.round(size * 0.8);
  const inner = resizeArea(source, innerSize);
  const offset = Math.floor((size - innerSize) / 2);
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 3;
      const ix = x - offset;
      const iy = y - offset;
      if (ix >= 0 && iy >= 0 && ix < innerSize && iy < innerSize) {
        const from = (iy * innerSize + ix) * 3;
        rgb[at] = inner.rgb[from];
        rgb[at + 1] = inner.rgb[from + 1];
        rgb[at + 2] = inner.rgb[from + 2];
      } else {
        rgb[at] = bg[0];
        rgb[at + 1] = bg[1];
        rgb[at + 2] = bg[2];
      }
    }
  }
  return { width: size, height: size, rgb };
}

const master = decodeSourcePng(resolve(SOURCE_DIR, 'origin-ribbon-o-source.png'));
const small = decodeSourcePng(resolve(SOURCE_DIR, 'origin-ribbon-o-small-source.png'));
const mono = decodeSourcePng(resolve(SOURCE_DIR, 'origin-ribbon-o-mono-source.png'));

const targets = [
  ['pwa-192.png', resizeArea(master, 192)],
  ['pwa-512.png', resizeArea(master, 512)],
  ['pwa-maskable-512.png', renderMaskable(master, 512)],
  ['apple-touch-icon.png', resizeArea(master, 180)],
  ['favicon.png', resizeArea(small, 64)],
  ['favicon-dark.png', resizeArea(mono, 64)],
];

for (const [name, image] of targets) {
  const path = resolve(OUT, name);
  const png = encodePng(image.width, image.height, image.rgb);
  writeFileSync(path, png, { mode: 0o644 });
  process.stdout.write(`generated ${name} ${image.width}x${image.height} (${png.length} bytes)\n`);
}
