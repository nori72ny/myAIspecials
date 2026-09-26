// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  RasterTypographyOverlayErrorV15,
  planRasterTypographyOverlayV15,
} from './localRasterTypographyV15';

describe('localRasterTypographyV15', () => {
  it('creates a bounded deterministic overlay plan for exact text', () => {
    const plan = planRasterTypographyOverlayV15(
      ['ORIGIN Personal', 'あなた専用のAI OS'],
      1024,
      1280,
    );

    expect(plan.version).toBe('raster-typography-overlay-v1');
    expect(plan.width).toBe(1024);
    expect(plan.height).toBe(1280);
    expect(plan.fontSize).toBeGreaterThanOrEqual(24);
    expect(plan.panelHeight).toBeLessThanOrEqual(Math.round(1280 * 0.42));
    expect(plan.lines.join('')).toContain('ORIGIN Personal');
    expect(plan.lines.join('')).toContain('あなた専用のAI OS');
  });

  it('normalizes and deduplicates exact copy without silently dropping it', () => {
    const plan = planRasterTypographyOverlayV15(
      ['  ORIGIN   Personal  ', 'ORIGIN Personal'],
      1024,
      1024,
    );

    expect(plan.lines.join('')).toBe('ORIGIN Personal');
  });

  it('fails closed when required copy cannot fit the bounded overlay', () => {
    const oversized = Array.from({ length: 8 }, (_, index) => `重要な長文コピー${index + 1}-${'情報'.repeat(55)}`);
    expect(() => planRasterTypographyOverlayV15(oversized, 256, 256))
      .toThrow(RasterTypographyOverlayErrorV15);
  });

  it('rejects invalid raster dimensions instead of attempting an unsafe canvas', () => {
    expect(() => planRasterTypographyOverlayV15(['ORIGIN'], 2048, 1024))
      .toThrow('TYPOGRAPHY_OVERLAY_DIMENSIONS_INVALID');
  });
});
