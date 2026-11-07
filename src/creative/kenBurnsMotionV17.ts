/**
 * Ken Burns (pan / zoom) motion for the on-device "video-lite" feature.
 *
 * Everything in this module is pure and runs entirely on the user's device:
 * no network access, no server API, no external service. It only computes
 * animation frames and recording capability so that KenBurnsVideoDialog can
 * render and optionally record a short WebM clip locally.
 */

export const KEN_BURNS_DURATION_MS = 6_000;
export const KEN_BURNS_MAX_LONG_EDGE = 1_024;

export type KenBurnsVariant = 'zoom-in' | 'zoom-out' | 'pan-right' | 'pan-left';

export const KEN_BURNS_VARIANTS: readonly KenBurnsVariant[] = [
  'zoom-in',
  'zoom-out',
  'pan-right',
  'pan-left',
] as const;

export type KenBurnsFrame = {
  /** Multiplier applied on top of the cover-fit base scale. Always >= 1. */
  scale: number;
  /** Horizontal shift as a fraction of the horizontal overflow, in [-0.5, 0.5]. */
  offsetX: number;
  /** Vertical shift as a fraction of the vertical overflow, in [-0.5, 0.5]. */
  offsetY: number;
};

const ZOOM_MIN = 1.02;
const ZOOM_MAX = 1.14;
const PAN_SCALE = 1.12;
const PAN_RANGE = 0.5;

/** Deterministically pick a motion variant from an arbitrary seed string. */
export function pickKenBurnsVariant(seed: string): KenBurnsVariant {
  const text = typeof seed === 'string' ? seed : '';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  const picked = KEN_BURNS_VARIANTS[Math.abs(hash) % KEN_BURNS_VARIANTS.length];
  return picked ?? 'zoom-in';
}

export function easeInOutCubic(progress: number): number {
  const clamped = clampProgress(progress);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return progress;
}

/** Frame (scale + offset) for a variant at a given progress in [0, 1]. */
export function kenBurnsFrameAt(variant: KenBurnsVariant, progress: number): KenBurnsFrame {
  const eased = easeInOutCubic(progress);
  switch (variant) {
    case 'zoom-out':
      return { scale: ZOOM_MAX - (ZOOM_MAX - ZOOM_MIN) * eased, offsetX: 0, offsetY: 0 };
    case 'pan-right':
      return { scale: PAN_SCALE, offsetX: -PAN_RANGE + 2 * PAN_RANGE * eased, offsetY: 0 };
    case 'pan-left':
      return { scale: PAN_SCALE, offsetX: PAN_RANGE - 2 * PAN_RANGE * eased, offsetY: 0 };
    case 'zoom-in':
    default:
      return { scale: ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * eased, offsetX: 0, offsetY: 0 };
  }
}

export type KenBurnsOutputSize = { width: number; height: number };

/**
 * Output pixel size for the animation canvas / recording: preserve the
 * source aspect ratio, never upscale, and cap the long edge. Dimensions are
 * rounded to even numbers because VP8/VP9 encoders require them. Returns
 * null when the source dimensions are unusable.
 */
export function computeKenBurnsOutputSize(
  naturalWidth: number,
  naturalHeight: number,
  maxLongEdge: number = KEN_BURNS_MAX_LONG_EDGE,
): KenBurnsOutputSize | null {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null;
  if (!Number.isFinite(maxLongEdge) || maxLongEdge < 2) return null;
  if (naturalWidth < 1 || naturalHeight < 1) return null;
  const cap = Math.floor(maxLongEdge);
  const longEdge = Math.max(naturalWidth, naturalHeight);
  const ratio = longEdge > cap ? cap / longEdge : 1;
  const toEven = (value: number) => Math.max(2, Math.round((value * ratio) / 2) * 2);
  return { width: toEven(naturalWidth), height: toEven(naturalHeight) };
}

export type KenBurnsDrawable = {
  source: CanvasImageSource;
  /** Natural (intrinsic) pixel width of the source image. */
  width: number;
  /** Natural (intrinsic) pixel height of the source image. */
  height: number;
};

/**
 * Draw one frame: scale the image so it always covers the whole canvas
 * (cover fit), apply the frame scale, then shift by the frame offsets.
 */
export function drawKenBurnsFrame(
  ctx: CanvasRenderingContext2D,
  drawable: KenBurnsDrawable,
  canvasWidth: number,
  canvasHeight: number,
  frame: KenBurnsFrame,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  if (drawable.width < 1 || drawable.height < 1 || canvasWidth < 1 || canvasHeight < 1) return;
  const baseScale = Math.max(canvasWidth / drawable.width, canvasHeight / drawable.height);
  const scale = baseScale * Math.max(1, frame.scale);
  const drawnWidth = drawable.width * scale;
  const drawnHeight = drawable.height * scale;
  const overflowX = Math.max(0, drawnWidth - canvasWidth);
  const overflowY = Math.max(0, drawnHeight - canvasHeight);
  const offsetX = Math.min(PAN_RANGE, Math.max(-PAN_RANGE, frame.offsetX));
  const offsetY = Math.min(PAN_RANGE, Math.max(-PAN_RANGE, frame.offsetY));
  const x = -overflowX / 2 + offsetX * overflowX;
  const y = -overflowY / 2 + offsetY * overflowY;
  ctx.drawImage(drawable.source, x, y, drawnWidth, drawnHeight);
}

/** Derive the WebM download file name from an image file name. */
export function webmDownloadName(imageDownloadName: string): string {
  const fallback = 'origin-video.webm';
  if (typeof imageDownloadName !== 'string') return fallback;
  const tail = imageDownloadName.trim().split(/[\\/]/).pop() ?? '';
  const stem = tail.replace(/\.[a-z0-9]+$/i, '').trim();
  return stem ? `${stem}.webm` : fallback;
}

export type WebmRecordingSupport = {
  canRecord: boolean;
  mimeType: string | null;
};

export type RecordingEnvironment = {
  mediaRecorder?: {
    isTypeSupported?: (mimeType: string) => boolean;
  };
  canvasCaptureStream: boolean;
};

export const WEBM_MIME_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

function defaultRecordingEnvironment(): RecordingEnvironment {
  try {
    const mediaRecorderCtor = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    let canvasCaptureStream = false;
    if (typeof document !== 'undefined') {
      const probe = document.createElement('canvas') as HTMLCanvasElement & {
        captureStream?: unknown;
      };
      canvasCaptureStream = typeof probe.captureStream === 'function';
    }
    return {
      mediaRecorder: typeof mediaRecorderCtor === 'function'
        ? (mediaRecorderCtor as RecordingEnvironment['mediaRecorder'])
        : undefined,
      canvasCaptureStream,
    };
  } catch {
    return { canvasCaptureStream: false };
  }
}

/**
 * Feature detection for local WebM recording. Recording is only offered
 * when MediaRecorder exists, the canvas can be captured, and at least one
 * WebM mime type is supported. Any doubt resolves to "cannot record" so
 * the UI can fall back to animation-only instead of failing.
 */
export function detectWebmRecordingSupport(env?: RecordingEnvironment): WebmRecordingSupport {
  const resolved = env ?? defaultRecordingEnvironment();
  const recorder = resolved.mediaRecorder;
  if (!recorder || typeof recorder.isTypeSupported !== 'function') {
    return { canRecord: false, mimeType: null };
  }
  if (!resolved.canvasCaptureStream) {
    return { canRecord: false, mimeType: null };
  }
  for (const mimeType of WEBM_MIME_CANDIDATES) {
    try {
      if (recorder.isTypeSupported(mimeType)) {
        return { canRecord: true, mimeType };
      }
    } catch {
      // A throwing isTypeSupported means we cannot trust this candidate.
    }
  }
  return { canRecord: false, mimeType: null };
}
