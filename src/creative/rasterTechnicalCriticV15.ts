export type RasterTechnicalQualityMetricsV15 = {
  width: number;
  height: number;
  sampledPixels: number;
  opaqueCoverage: number;
  meanLuminance: number;
  luminanceStdDev: number;
  darkClipRatio: number;
  brightClipRatio: number;
  edgeEnergy: number;
  histogramEntropy: number;
};

export type RasterTechnicalQualityResultV15 = {
  version: 'raster-technical-critic-v1';
  passed: boolean;
  score: number;
  checks: readonly string[];
  issues: readonly string[];
  metrics: RasterTechnicalQualityMetricsV15;
};

export type RasterQualityCandidateV15<T> = {
  value: T;
  quality: RasterTechnicalQualityResultV15;
};

export type RasterCandidatePolicyV15 = {
  version: 'raster-candidate-policy-v1';
  recommendedCandidates: 1 | 2;
  activeCandidates: 1;
  reason: string;
  bestOfNEnabled: false;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function normalizedEntropy(histogram: readonly number[], total: number): number {
  if (total <= 0) return 0;
  let entropy = 0;
  for (const count of histogram) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(histogram.length);
}

export function scoreRasterPixelsV15(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): RasterTechnicalQualityResultV15 {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || rgba.length !== width * height * 4) {
    throw new Error('RASTER_TECHNICAL_CRITIC_INPUT_INVALID');
  }

  const luminance = new Float32Array(width * height);
  const histogram = new Array<number>(16).fill(0);
  let opaque = 0;
  let sum = 0;
  let sumSquares = 0;
  let dark = 0;
  let bright = 0;

  for (let index = 0; index < width * height; index += 1) {
    const base = index * 4;
    const alpha = rgba[base + 3] / 255;
    const value = (0.2126 * rgba[base] + 0.7152 * rgba[base + 1] + 0.0722 * rgba[base + 2]) / 255;
    luminance[index] = value;
    if (alpha >= 0.05) opaque += 1;
    sum += value;
    sumSquares += value * value;
    if (value <= 0.015) dark += 1;
    if (value >= 0.985) bright += 1;
    histogram[Math.min(15, Math.floor(value * 16))] += 1;
  }

  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width) {
        edgeSum += Math.abs(luminance[index] - luminance[index + 1]);
        edgeCount += 1;
      }
      if (y + 1 < height) {
        edgeSum += Math.abs(luminance[index] - luminance[index + width]);
        edgeCount += 1;
      }
    }
  }

  const total = width * height;
  const mean = sum / total;
  const variance = Math.max(0, sumSquares / total - mean * mean);
  const stdDev = Math.sqrt(variance);
  const edgeEnergy = edgeCount ? edgeSum / edgeCount : 0;
  const entropy = normalizedEntropy(histogram, total);
  const opaqueCoverage = opaque / total;
  const darkClipRatio = dark / total;
  const brightClipRatio = bright / total;

  const checks: string[] = [];
  const issues: string[] = [];
  if (opaqueCoverage >= 0.05) checks.push('non-empty-alpha');
  else issues.push('near-empty-alpha');

  if (stdDev >= 0.012 || edgeEnergy >= 0.006 || entropy >= 0.08) checks.push('non-uniform-content');
  else issues.push('near-uniform-image');

  if (darkClipRatio < 0.995) checks.push('not-fully-black');
  else issues.push('near-total-black-clipping');

  if (brightClipRatio < 0.995) checks.push('not-fully-white');
  else issues.push('near-total-white-clipping');

  if (entropy >= 0.04 || edgeEnergy >= 0.004) checks.push('minimum-information-density');
  else issues.push('insufficient-visual-information');

  const coverageScore = clamp01(opaqueCoverage / 0.95);
  const variationScore = clamp01(Math.max(stdDev / 0.18, edgeEnergy / 0.08, entropy / 0.65));
  const clippingScore = clamp01(1 - Math.max(darkClipRatio, brightClipRatio));
  const informationScore = clamp01(Math.max(entropy / 0.65, edgeEnergy / 0.08));
  const score = Math.round(100 * (
    coverageScore * 0.20
    + variationScore * 0.35
    + clippingScore * 0.20
    + informationScore * 0.25
  ));

  return {
    version: 'raster-technical-critic-v1',
    passed: issues.length === 0,
    score,
    checks,
    issues,
    metrics: {
      width,
      height,
      sampledPixels: total,
      opaqueCoverage: round4(opaqueCoverage),
      meanLuminance: round4(mean),
      luminanceStdDev: round4(stdDev),
      darkClipRatio: round4(darkClipRatio),
      brightClipRatio: round4(brightClipRatio),
      edgeEnergy: round4(edgeEnergy),
      histogramEntropy: round4(entropy),
    },
  };
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('RASTER_TECHNICAL_CRITIC_DECODE_FAILED'));
    image.src = url;
  });
}

export async function inspectRasterBlobV15(blob: Blob): Promise<RasterTechnicalQualityResultV15> {
  if (!(blob instanceof Blob) || blob.size <= 0 || !/^image\/(?:png|jpeg|webp)$/i.test(blob.type)) {
    throw new Error('RASTER_TECHNICAL_CRITIC_BLOB_INVALID');
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('RASTER_TECHNICAL_CRITIC_BROWSER_REQUIRED');
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await decodeImage(url);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) throw new Error('RASTER_TECHNICAL_CRITIC_DIMENSIONS_INVALID');

    const longest = Math.max(naturalWidth, naturalHeight);
    const scale = Math.min(1, 96 / longest);
    const width = Math.max(2, Math.round(naturalWidth * scale));
    const height = Math.max(2, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('RASTER_TECHNICAL_CRITIC_CANVAS_UNAVAILABLE');
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    return scoreRasterPixelsV15(pixels, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function candidatePolicyForRasterRequestV15(input: string, purpose?: string): RasterCandidatePolicyV15 {
  const normalized = input.normalize('NFKC');
  const qualityCriticalPurpose = new Set(['advertisement', 'product', 'poster', 'thumbnail', 'portrait']);
  const asksForQuality = /(?:最高|高品質|最高品質|premium|best|professional|広告品質|商用品質|プロ品質)/i.test(normalized);
  const recommendedCandidates: 1 | 2 = asksForQuality || (purpose ? qualityCriticalPurpose.has(purpose) : false) ? 2 : 1;
  return {
    version: 'raster-candidate-policy-v1',
    recommendedCandidates,
    activeCandidates: 1,
    reason: recommendedCandidates === 2
      ? 'Quality-critical requests benefit from comparison, but multi-candidate execution remains disabled until live zero-cost quota and latency are verified.'
      : 'A single verified candidate is appropriate for the current request.',
    bestOfNEnabled: false,
  };
}

export function selectBestTechnicalCandidateV15<T>(candidates: readonly RasterQualityCandidateV15<T>[]): RasterQualityCandidateV15<T> | null {
  const eligible = candidates.filter((candidate) => candidate.quality.passed);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => b.quality.score - a.quality.score)[0] ?? null;
}
