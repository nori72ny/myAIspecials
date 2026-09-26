import { describe, expect, it } from 'vitest';

import {
  candidatePolicyForRasterRequestV15,
  scoreRasterPixelsV15,
  selectBestTechnicalCandidateV15,
} from './rasterTechnicalCriticV15';

function pixels(width: number, height: number, make: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = make(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = a;
    }
  }
  return data;
}

describe('rasterTechnicalCriticV15', () => {
  it('passes a nontrivial opaque image and reports bounded technical metrics', () => {
    const width = 32;
    const height = 32;
    const result = scoreRasterPixelsV15(
      pixels(width, height, (x, y) => {
        const value = (x * 17 + y * 11) % 256;
        return [value, (value * 3) % 256, 255 - value, 255];
      }),
      width,
      height,
    );

    expect(result.version).toBe('raster-technical-critic-v1');
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.checks).toEqual(expect.arrayContaining([
      'non-empty-alpha',
      'non-uniform-content',
      'not-fully-black',
      'not-fully-white',
      'minimum-information-density',
    ]));
    expect(result.metrics.sampledPixels).toBe(width * height);
    expect(result.metrics.opaqueCoverage).toBe(1);
  });

  it('fails closed on blank, transparent, all-black, and all-white outputs', () => {
    const transparent = scoreRasterPixelsV15(pixels(8, 8, () => [0, 0, 0, 0]), 8, 8);
    expect(transparent.passed).toBe(false);
    expect(transparent.issues).toContain('near-empty-alpha');

    const black = scoreRasterPixelsV15(pixels(8, 8, () => [0, 0, 0, 255]), 8, 8);
    expect(black.passed).toBe(false);
    expect(black.issues).toContain('near-total-black-clipping');

    const white = scoreRasterPixelsV15(pixels(8, 8, () => [255, 255, 255, 255]), 8, 8);
    expect(white.passed).toBe(false);
    expect(white.issues).toContain('near-total-white-clipping');
  });

  it('rejects malformed pixel buffers instead of inventing a quality score', () => {
    expect(() => scoreRasterPixelsV15(new Uint8ClampedArray(7), 2, 2))
      .toThrow('RASTER_TECHNICAL_CRITIC_INPUT_INVALID');
  });

  it('recommends two candidates for quality-critical work but keeps Best-of-N execution disabled until live evidence exists', () => {
    const premium = candidatePolicyForRasterRequestV15('最高品質の高級腕時計広告を作って', 'advertisement');
    expect(premium).toMatchObject({
      version: 'raster-candidate-policy-v1',
      recommendedCandidates: 2,
      activeCandidates: 1,
      bestOfNEnabled: false,
    });

    const simple = candidatePolicyForRasterRequestV15('青い空の画像を作って', 'photograph');
    expect(simple.recommendedCandidates).toBe(1);
    expect(simple.activeCandidates).toBe(1);
  });

  it('selects the highest-scoring passing candidate and never selects failed output', () => {
    const base = scoreRasterPixelsV15(
      pixels(16, 16, (x, y) => [x * 16, y * 16, (x + y) * 8, 255]),
      16,
      16,
    );
    const baseline = { ...base, score: Math.max(1, Math.min(80, base.score)) };
    const stronger = { ...base, score: Math.min(100, baseline.score + 10) };
    const failed = { ...base, passed: false, score: 100, issues: ['synthetic-failure'] };

    expect(selectBestTechnicalCandidateV15([
      { value: 'a', quality: baseline },
      { value: 'bad', quality: failed },
      { value: 'b', quality: stronger },
    ])?.value).toBe('b');
    expect(selectBestTechnicalCandidateV15([{ value: 'bad', quality: failed }])).toBeNull();
  });
});
