export const RASTER_REFERENCE_MAX_DIMENSION_V15 = 511 as const;
export const RASTER_REFERENCE_MAX_BYTES_V15 = 768 * 1024;

const SOURCE_MAX_BYTES = 12 * 1024 * 1024;
const SOURCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type RasterReferencePreparedV15 = {
  dataUrl: string;
  mimeType: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
};

export function rasterReferenceTargetSizeV15(
  width: number,
  height: number,
  maxDimension = RASTER_REFERENCE_MAX_DIMENSION_V15,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0
    || !Number.isInteger(maxDimension) || maxDimension < 64 || maxDimension > RASTER_REFERENCE_MAX_DIMENSION_V15) {
    throw new Error('REFERENCE_IMAGE_CLIENT_DIMENSIONS_INVALID');
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function decodedRasterDataUrlBytesV15(dataUrl: string): number {
  const match = /^data:image\/(?:webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('REFERENCE_IMAGE_CLIENT_DATA_URL_INVALID');
  const encoded = match[1];
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
}

function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof URL === 'undefined') {
      reject(new Error('REFERENCE_IMAGE_CLIENT_BROWSER_REQUIRED'));
      return;
    }
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('REFERENCE_IMAGE_CLIENT_DECODE_FAILED'));
    };
    image.src = url;
  });
}

function canvasDataUrl(
  image: HTMLImageElement,
  width: number,
  height: number,
  mimeType: RasterReferencePreparedV15['mimeType'],
  quality: number,
): string {
  if (typeof document === 'undefined') throw new Error('REFERENCE_IMAGE_CLIENT_BROWSER_REQUIRED');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('REFERENCE_IMAGE_CLIENT_CANVAS_UNAVAILABLE');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL(mimeType, quality);
  if (!dataUrl.startsWith(`data:${mimeType};base64,`)) return '';
  return dataUrl;
}

export async function prepareRasterReferenceDataUrlV15(blob: Blob): Promise<RasterReferencePreparedV15> {
  if (!(blob instanceof Blob)
    || blob.size < 64
    || blob.size > SOURCE_MAX_BYTES
    || !SOURCE_MIME_TYPES.has(blob.type)) {
    throw new Error('REFERENCE_IMAGE_CLIENT_SOURCE_INVALID');
  }

  const image = await imageFromBlob(blob);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!Number.isInteger(naturalWidth) || !Number.isInteger(naturalHeight) || naturalWidth < 1 || naturalHeight < 1) {
    throw new Error('REFERENCE_IMAGE_CLIENT_DIMENSIONS_INVALID');
  }

  const attempts = [
    { maxDimension: 511, quality: 0.88 },
    { maxDimension: 448, quality: 0.82 },
    { maxDimension: 384, quality: 0.76 },
    { maxDimension: 320, quality: 0.70 },
  ] as const;

  for (const attempt of attempts) {
    const size = rasterReferenceTargetSizeV15(naturalWidth, naturalHeight, attempt.maxDimension);
    for (const mimeType of ['image/webp', 'image/jpeg'] as const) {
      const dataUrl = canvasDataUrl(image, size.width, size.height, mimeType, attempt.quality);
      if (!dataUrl) continue;
      const bytes = decodedRasterDataUrlBytesV15(dataUrl);
      if (bytes >= 64 && bytes <= RASTER_REFERENCE_MAX_BYTES_V15) {
        return { dataUrl, mimeType, width: size.width, height: size.height, bytes };
      }
    }
  }

  throw new Error('REFERENCE_IMAGE_CLIENT_PREP_FAILED');
}
