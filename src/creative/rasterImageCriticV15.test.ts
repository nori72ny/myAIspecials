import { describe, expect, it } from 'vitest';

import {
  critiqueRasterStructureV15,
  readRasterDimensionsV15,
} from './rasterImageCriticV15.js';

function png(width: number, height: number, size = 96): Buffer {
  const bytes = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  Buffer.from('IHDR', 'ascii').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe('rasterImageCriticV15', () => {
  it('accepts a nontrivial raster only when its decoded dimensions exactly match the request', () => {
    const bytes = png(768, 1024);
    const result = critiqueRasterStructureV15(bytes, 'image/png', 768, 1024);

    expect(result).toEqual(expect.objectContaining({
      version: 'raster-structural-critic-v1',
      passed: true,
      score: 100,
      actualWidth: 768,
      actualHeight: 1024,
      expectedWidth: 768,
      expectedHeight: 1024,
    }));
    expect(result.checks).toEqual([
      'decodable-dimensions',
      'dimensions-within-origin-bounds',
      'requested-dimensions-match',
      'nontrivial-image-payload',
    ]);
    expect(result.issues).toEqual([]);
  });

  it('fails closed when dimensions are unreadable, mismatched, outside bounds, or payload is trivial', () => {
    const malformed = critiqueRasterStructureV15(Buffer.from([1, 2, 3]), 'image/png', 1024, 1024);
    expect(malformed.passed).toBe(false);
    expect(malformed.issues).toEqual(expect.arrayContaining([
      'dimensions-unreadable',
      'dimensions-out-of-bounds',
      'requested-dimensions-mismatch',
      'image-payload-too-small',
    ]));

    const mismatch = critiqueRasterStructureV15(png(512, 512), 'image/png', 1024, 1024);
    expect(mismatch.passed).toBe(false);
    expect(mismatch.issues).toContain('requested-dimensions-mismatch');

    const outOfBounds = critiqueRasterStructureV15(png(2048, 2048), 'image/png', 2048, 2048);
    expect(outOfBounds.passed).toBe(false);
    expect(outOfBounds.issues).toContain('dimensions-out-of-bounds');
  });

  it('reads PNG dimensions without decoding or executing image content', () => {
    expect(readRasterDimensionsV15(png(864, 1536), 'image/png')).toEqual({ width: 864, height: 1536 });
    expect(readRasterDimensionsV15(Buffer.from('not-an-image'), 'image/png')).toBeNull();
  });
});
