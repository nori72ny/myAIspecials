// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  KEN_BURNS_DURATION_MS,
  KEN_BURNS_VARIANTS,
  clampProgress,
  computeKenBurnsOutputSize,
  detectWebmRecordingSupport,
  drawKenBurnsFrame,
  easeInOutCubic,
  kenBurnsFrameAt,
  pickKenBurnsVariant,
  webmDownloadName,
  type KenBurnsDrawable,
} from './kenBurnsMotionV17';

describe('computeKenBurnsOutputSize', () => {
  it('keeps small images at their natural size (never upscales)', () => {
    expect(computeKenBurnsOutputSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('caps the long edge at 1024 while preserving the aspect ratio', () => {
    expect(computeKenBurnsOutputSize(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(computeKenBurnsOutputSize(3000, 4000)).toEqual({ width: 768, height: 1024 });
  });

  it('rounds dimensions to even numbers for VP8/VP9 encoders', () => {
    const size = computeKenBurnsOutputSize(1023, 767);
    expect(size).not.toBeNull();
    expect(size!.width % 2).toBe(0);
    expect(size!.height % 2).toBe(0);
  });

  it('respects a custom max long edge', () => {
    expect(computeKenBurnsOutputSize(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
  });

  it('returns null for unusable source dimensions', () => {
    expect(computeKenBurnsOutputSize(0, 600)).toBeNull();
    expect(computeKenBurnsOutputSize(800, 0)).toBeNull();
    expect(computeKenBurnsOutputSize(-10, 600)).toBeNull();
    expect(computeKenBurnsOutputSize(Number.NaN, 600)).toBeNull();
    expect(computeKenBurnsOutputSize(800, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('pickKenBurnsVariant', () => {
  it('is deterministic for the same seed', () => {
    expect(pickKenBurnsVariant('origin-image-123')).toBe(pickKenBurnsVariant('origin-image-123'));
  });

  it('always returns a known variant', () => {
    for (const seed of ['', 'a', '富士山', 'sha256:deadbeef', 'x'.repeat(500)]) {
      expect(KEN_BURNS_VARIANTS).toContain(pickKenBurnsVariant(seed));
    }
  });

  it('spreads different seeds across multiple variants', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => pickKenBurnsVariant(`seed-${i}`)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('progress helpers', () => {
  it('clamps progress into [0, 1]', () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(0.25)).toBe(0.25);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  it('easeInOutCubic hits the endpoints and the symmetric midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe('kenBurnsFrameAt', () => {
  it('zoom-in grows the scale monotonically and stays centered', () => {
    const start = kenBurnsFrameAt('zoom-in', 0);
    const mid = kenBurnsFrameAt('zoom-in', 0.5);
    const end = kenBurnsFrameAt('zoom-in', 1);
    expect(start.scale).toBeLessThan(mid.scale);
    expect(mid.scale).toBeLessThan(end.scale);
    expect(start.offsetX).toBe(0);
    expect(end.offsetY).toBe(0);
  });

  it('zoom-out shrinks the scale', () => {
    expect(kenBurnsFrameAt('zoom-out', 0).scale).toBeGreaterThan(kenBurnsFrameAt('zoom-out', 1).scale);
  });

  it('pan variants keep a constant scale and sweep the offset across the full range', () => {
    const rightStart = kenBurnsFrameAt('pan-right', 0);
    const rightEnd = kenBurnsFrameAt('pan-right', 1);
    expect(rightStart.scale).toBe(rightEnd.scale);
    expect(rightStart.offsetX).toBeCloseTo(-0.5, 10);
    expect(rightEnd.offsetX).toBeCloseTo(0.5, 10);
    const leftStart = kenBurnsFrameAt('pan-left', 0);
    const leftEnd = kenBurnsFrameAt('pan-left', 1);
    expect(leftStart.offsetX).toBeCloseTo(0.5, 10);
    expect(leftEnd.offsetX).toBeCloseTo(-0.5, 10);
  });

  it('clamps out-of-range progress to the endpoints', () => {
    expect(kenBurnsFrameAt('zoom-in', -3)).toEqual(kenBurnsFrameAt('zoom-in', 0));
    expect(kenBurnsFrameAt('zoom-in', 7)).toEqual(kenBurnsFrameAt('zoom-in', 1));
  });

  it('never returns a scale below 1, so the frame always covers the canvas', () => {
    for (const variant of KEN_BURNS_VARIANTS) {
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        expect(kenBurnsFrameAt(variant, progress).scale).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('drawKenBurnsFrame', () => {
  const makeCtx = () => {
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const ctx = { drawImage, clearRect } as unknown as CanvasRenderingContext2D;
    return { ctx, drawImage, clearRect };
  };
  const drawable: KenBurnsDrawable = {
    source: {} as CanvasImageSource,
    width: 1000,
    height: 500,
  };

  it('draws the image covering the whole canvas, centered at rest', () => {
    const { ctx, drawImage, clearRect } = makeCtx();
    drawKenBurnsFrame(ctx, drawable, 500, 500, { scale: 1, offsetX: 0, offsetY: 0 });
    expect(clearRect).toHaveBeenCalledWith(0, 0, 500, 500);
    expect(drawImage).toHaveBeenCalledTimes(1);
    const [, x, y, drawnWidth, drawnHeight] = drawImage.mock.calls[0] as [unknown, number, number, number, number];
    // Cover fit for a 1000x500 source on a 500x500 canvas: height fits, width overflows by 500.
    expect(drawnHeight).toBe(500);
    expect(drawnWidth).toBe(1000);
    expect(x).toBe(-250);
    expect(y).toBe(0);
  });

  it('shifts the visible window with the pan offsets', () => {
    const { ctx, drawImage } = makeCtx();
    drawKenBurnsFrame(ctx, drawable, 500, 500, { scale: 1, offsetX: 0.5, offsetY: 0 });
    const [, x] = drawImage.mock.calls[0] as [unknown, number];
    expect(x).toBe(0);
  });

  it('does not draw when the source has no usable size', () => {
    const { ctx, drawImage } = makeCtx();
    drawKenBurnsFrame(ctx, { source: {} as CanvasImageSource, width: 0, height: 0 }, 500, 500, { scale: 1, offsetX: 0, offsetY: 0 });
    expect(drawImage).not.toHaveBeenCalled();
  });
});

describe('webmDownloadName', () => {
  it('replaces the image extension with .webm', () => {
    expect(webmDownloadName('origin-image.png')).toBe('origin-image.webm');
    expect(webmDownloadName('photo.JPEG')).toBe('photo.webm');
  });

  it('appends .webm when there is no extension', () => {
    expect(webmDownloadName('origin-image')).toBe('origin-image.webm');
  });

  it('strips directories and falls back for empty names', () => {
    expect(webmDownloadName('a/b/c.webp')).toBe('c.webm');
    expect(webmDownloadName('')).toBe('origin-video.webm');
    expect(webmDownloadName('   ')).toBe('origin-video.webm');
  });
});

describe('detectWebmRecordingSupport', () => {
  it('reports unsupported when MediaRecorder is missing', () => {
    expect(detectWebmRecordingSupport({ canvasCaptureStream: true })).toEqual({ canRecord: false, mimeType: null });
  });

  it('reports unsupported when canvas captureStream is unavailable', () => {
    expect(detectWebmRecordingSupport({
      mediaRecorder: { isTypeSupported: () => true },
      canvasCaptureStream: false,
    })).toEqual({ canRecord: false, mimeType: null });
  });

  it('prefers vp9, then vp8, then plain webm', () => {
    const all = detectWebmRecordingSupport({
      mediaRecorder: { isTypeSupported: () => true },
      canvasCaptureStream: true,
    });
    expect(all).toEqual({ canRecord: true, mimeType: 'video/webm;codecs=vp9' });
    const vp8Only = detectWebmRecordingSupport({
      mediaRecorder: { isTypeSupported: (mime) => mime.includes('vp8') },
      canvasCaptureStream: true,
    });
    expect(vp8Only).toEqual({ canRecord: true, mimeType: 'video/webm;codecs=vp8' });
  });

  it('reports unsupported when no WebM mime type is supported', () => {
    expect(detectWebmRecordingSupport({
      mediaRecorder: { isTypeSupported: () => false },
      canvasCaptureStream: true,
    })).toEqual({ canRecord: false, mimeType: null });
  });

  it('never throws when isTypeSupported throws', () => {
    expect(detectWebmRecordingSupport({
      mediaRecorder: {
        isTypeSupported: () => {
          throw new Error('boom');
        },
      },
      canvasCaptureStream: true,
    })).toEqual({ canRecord: false, mimeType: null });
  });

  it('uses the real environment by default and stays safe under jsdom', () => {
    const support = detectWebmRecordingSupport();
    expect(typeof support.canRecord).toBe('boolean');
    if (!support.canRecord) expect(support.mimeType).toBeNull();
  });
});

describe('constants', () => {
  it('records about six seconds of motion', () => {
    expect(KEN_BURNS_DURATION_MS).toBe(6_000);
  });
});
