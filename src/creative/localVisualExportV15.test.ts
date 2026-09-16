// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  pngFilenameFromSvg,
  rasterizeVerifiedSvgToPng,
  verifyVisualBlobSha256V15,
  VISUAL_PRESET_DIMENSIONS_V15,
} from './localVisualExportV15';

describe('localVisualExportV15', () => {
  it('maps all supported presets to the production artifact dimensions', () => {
    expect(VISUAL_PRESET_DIMENSIONS_V15).toEqual({
      square: { width: 1080, height: 1080 },
      portrait: { width: 1080, height: 1350 },
      story: { width: 1080, height: 1920 },
      landscape: { width: 1200, height: 630 },
    });
  });

  it('derives a safe PNG filename from an SVG filename', () => {
    expect(pngFilenameFromSvg('日本語-portrait.svg')).toBe('日本語-portrait.png');
    expect(pngFilenameFromSvg('../nested/creative.SVG')).toBe('creative.png');
    expect(pngFilenameFromSvg('')).toBe('origin-creative.png');
  });

  it('fails closed before rasterization for an empty or non-SVG blob', async () => {
    await expect(rasterizeVerifiedSvgToPng(new Blob([], { type: 'image/svg+xml' }), 'portrait'))
      .rejects.toMatchObject({ code: 'INVALID_LOCAL_SVG_BLOB' });
    await expect(rasterizeVerifiedSvgToPng(new Blob(['not-svg'], { type: 'text/plain' }), 'portrait'))
      .rejects.toMatchObject({ code: 'INVALID_LOCAL_SVG_MIME' });
  });

  it('rejects a malformed expected SHA before hashing', async () => {
    const blob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/svg+xml' });
    await expect(verifyVisualBlobSha256V15(blob, 'not-a-sha')).resolves.toBe(false);
  });
});
