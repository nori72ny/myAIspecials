export type VisualRasterPresetV15 = 'square' | 'portrait' | 'story' | 'landscape';

export const VISUAL_PRESET_DIMENSIONS_V15: Record<VisualRasterPresetV15, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 630 },
};

const MAX_SVG_BYTES = 512 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 12_000_000;
const SHA256 = /^[a-f0-9]{64}$/i;

export class LocalVisualExportErrorV15 extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'LocalVisualExportErrorV15';
  }
}

export function pngFilenameFromSvg(filename: string): string {
  const tail = filename.trim().split(/[\\/]/).pop() || 'origin-creative.svg';
  const stem = tail.replace(/\.svg$/i, '').trim() || 'origin-creative';
  return `${stem}.png`;
}

function assertSvgBlob(svgBlob: Blob) {
  if (!(svgBlob instanceof Blob) || svgBlob.size <= 0 || svgBlob.size > MAX_SVG_BYTES) {
    throw new LocalVisualExportErrorV15('INVALID_LOCAL_SVG_BLOB');
  }
  if (!svgBlob.type.toLowerCase().includes('image/svg+xml')) {
    throw new LocalVisualExportErrorV15('INVALID_LOCAL_SVG_MIME');
  }
}

function assertRasterInput(svgBlob: Blob, preset: VisualRasterPresetV15) {
  assertSvgBlob(svgBlob);
  const dimensions = VISUAL_PRESET_DIMENSIONS_V15[preset];
  if (!dimensions
    || dimensions.width <= 0
    || dimensions.height <= 0
    || dimensions.width > MAX_DIMENSION
    || dimensions.height > MAX_DIMENSION
    || dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new LocalVisualExportErrorV15('INVALID_LOCAL_RASTER_DIMENSIONS');
  }
  return dimensions;
}

export async function sha256SvgBlobV15(svgBlob: Blob): Promise<string> {
  assertSvgBlob(svgBlob);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new LocalVisualExportErrorV15('LOCAL_SHA256_UNAVAILABLE');
  const digest = await subtle.digest('SHA-256', await svgBlob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyVisualBlobSha256V15(svgBlob: Blob, expectedSha256: string): Promise<boolean> {
  if (!SHA256.test(expectedSha256)) return false;
  return (await sha256SvgBlobV15(svgBlob)) === expectedSha256.toLowerCase();
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new LocalVisualExportErrorV15('LOCAL_SVG_DECODE_FAILED'));
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size <= 0 || blob.type !== 'image/png') {
        reject(new LocalVisualExportErrorV15('LOCAL_PNG_ENCODE_FAILED'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

export async function rasterizeVerifiedSvgToPng(
  svgBlob: Blob,
  preset: VisualRasterPresetV15,
): Promise<Blob> {
  const { width, height } = assertRasterInput(svgBlob, preset);
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = await loadSvgImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new LocalVisualExportErrorV15('LOCAL_CANVAS_UNAVAILABLE');
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await canvasToPng(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
