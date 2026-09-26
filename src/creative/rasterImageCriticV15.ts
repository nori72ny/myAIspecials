export type RasterStructuralCriticResultV15 = {
  version: 'raster-structural-critic-v1';
  passed: boolean;
  score: number;
  actualWidth: number | null;
  actualHeight: number | null;
  expectedWidth: number;
  expectedHeight: number;
  checks: readonly string[];
  issues: readonly string[];
};

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (SOF_MARKERS.has(marker)) {
      if (segmentLength < 7 || offset + 6 >= bytes.length) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunk = bytes.subarray(12, 16).toString('ascii');

  if (chunk === 'VP8X') {
    const width = 1 + readUInt24LE(bytes, 24);
    const height = 1 + readUInt24LE(bytes, 27);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f || bytes.length < 25) return null;
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = bytes.readUInt16LE(26) & 0x3fff;
    const height = bytes.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

export function readRasterDimensionsV15(
  bytes: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
): { width: number; height: number } | null {
  if (mimeType === 'image/png') return pngDimensions(bytes);
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes);
  if (mimeType === 'image/webp') return webpDimensions(bytes);
  return null;
}

export function critiqueRasterStructureV15(
  bytes: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  expectedWidth: number,
  expectedHeight: number,
): RasterStructuralCriticResultV15 {
  const dimensions = readRasterDimensionsV15(bytes, mimeType);
  const checks: string[] = [];
  const issues: string[] = [];

  if (dimensions) checks.push('decodable-dimensions');
  else issues.push('dimensions-unreadable');

  const boundsPass = Boolean(dimensions
    && dimensions.width >= 256 && dimensions.width <= 1536
    && dimensions.height >= 256 && dimensions.height <= 1536);
  if (boundsPass) checks.push('dimensions-within-origin-bounds');
  else issues.push('dimensions-out-of-bounds');

  const exactMatch = Boolean(dimensions
    && dimensions.width === expectedWidth
    && dimensions.height === expectedHeight);
  if (exactMatch) checks.push('requested-dimensions-match');
  else issues.push('requested-dimensions-mismatch');

  const minimumPayload = bytes.length >= 64;
  if (minimumPayload) checks.push('nontrivial-image-payload');
  else issues.push('image-payload-too-small');

  const passed = issues.length === 0;
  const score = Math.round((checks.length / 4) * 100);
  return {
    version: 'raster-structural-critic-v1',
    passed,
    score,
    actualWidth: dimensions?.width ?? null,
    actualHeight: dimensions?.height ?? null,
    expectedWidth,
    expectedHeight,
    checks,
    issues,
  };
}
