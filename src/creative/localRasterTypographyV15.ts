export type RasterTypographyOverlayPlanV15 = {
  version: 'raster-typography-overlay-v1';
  width: number;
  height: number;
  safeMargin: number;
  panelHeight: number;
  maxWidth: number;
  fontSize: number;
  lineHeight: number;
  lines: readonly string[];
};

export class RasterTypographyOverlayErrorV15 extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'RasterTypographyOverlayErrorV15';
  }
}

const MAX_TEXT_ITEMS = 8;
const MAX_TEXT_CHARS = 960;
const MIN_FONT_SIZE = 24;

function normalizeExactText(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const raw of values.slice(0, MAX_TEXT_ITEMS)) {
    const value = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (!unique.includes(value)) unique.push(value);
  }
  if (unique.join('').length > MAX_TEXT_CHARS) throw new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_TEXT_TOO_LONG');
  return unique;
}

function approximateUnits(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + (/^[\u0000-\u00ff]$/.test(char) ? 0.55 : 1), 0);
}

function wrapByUnits(value: string, maxUnits: number): string[] {
  const lines: string[] = [];
  let current = '';
  let units = 0;
  for (const char of Array.from(value)) {
    const charUnits = /^[\u0000-\u00ff]$/.test(char) ? 0.55 : 1;
    if (current && units + charUnits > maxUnits) {
      lines.push(current);
      current = char;
      units = charUnits;
    } else {
      current += char;
      units += charUnits;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function planRasterTypographyOverlayV15(
  exactText: readonly string[],
  width: number,
  height: number,
): RasterTypographyOverlayPlanV15 {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256 || width > 1536 || height > 1536) {
    throw new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_DIMENSIONS_INVALID');
  }

  const normalized = normalizeExactText(exactText);
  if (!normalized.length) throw new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_TEXT_REQUIRED');

  const safeMargin = Math.max(24, Math.round(Math.min(width, height) * 0.055));
  const maxWidth = width - safeMargin * 2;
  let fontSize = Math.max(MIN_FONT_SIZE, Math.round(Math.min(width, height) * 0.055));
  let lines: string[] = [];

  while (fontSize >= MIN_FONT_SIZE) {
    const maxUnits = Math.max(8, maxWidth / (fontSize * 0.9));
    lines = normalized.flatMap((value) => wrapByUnits(value, maxUnits));
    const lineHeight = Math.round(fontSize * 1.25);
    const panelHeight = safeMargin * 2 + lineHeight * lines.length;
    if (lines.length <= 8 && panelHeight <= Math.round(height * 0.42)) {
      return {
        version: 'raster-typography-overlay-v1',
        width,
        height,
        safeMargin,
        panelHeight,
        maxWidth,
        fontSize,
        lineHeight,
        lines,
      };
    }
    fontSize -= 2;
  }

  throw new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_OVERFLOW');
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size <= 0 || blob.type !== 'image/png') {
        reject(new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_ENCODE_FAILED'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_IMAGE_DECODE_FAILED'));
    image.src = url;
  });
}

export async function composeRasterTypographyOverlayV15(
  sourceBlob: Blob,
  exactText: readonly string[],
  width: number,
  height: number,
): Promise<{ blob: Blob; plan: RasterTypographyOverlayPlanV15 }> {
  if (!(sourceBlob instanceof Blob) || sourceBlob.size <= 0 || !/^image\/(?:png|jpeg|webp)$/i.test(sourceBlob.type)) {
    throw new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_SOURCE_INVALID');
  }

  const plan = planRasterTypographyOverlayV15(exactText, width, height);
  const url = URL.createObjectURL(sourceBlob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new RasterTypographyOverlayErrorV15('TYPOGRAPHY_OVERLAY_CANVAS_UNAVAILABLE');

    context.drawImage(image, 0, 0, width, height);

    const top = height - plan.panelHeight;
    const gradient = context.createLinearGradient(0, top, 0, height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.22, 'rgba(0,0,0,0.46)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.82)');
    context.fillStyle = gradient;
    context.fillRect(0, top, width, plan.panelHeight);

    context.font = `700 ${plan.fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textBaseline = 'top';
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(0,0,0,0.45)';
    context.shadowBlur = Math.max(2, Math.round(plan.fontSize * 0.08));

    let y = top + plan.safeMargin;
    for (const line of plan.lines) {
      context.fillText(line, plan.safeMargin, y, plan.maxWidth);
      y += plan.lineHeight;
    }

    return { blob: await canvasToPng(canvas), plan };
  } finally {
    URL.revokeObjectURL(url);
  }
}
