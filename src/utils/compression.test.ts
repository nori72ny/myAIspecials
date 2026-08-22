// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressText, decompressText, isGzipCompressed } from './compression';

const nativeCompression = globalThis.CompressionStream;
const nativeDecompression = globalThis.DecompressionStream;

afterEach(() => {
  vi.stubGlobal('CompressionStream', nativeCompression);
  vi.stubGlobal('DecompressionStream', nativeDecompression);
});

describe('transparent text compression', () => {
  it.each([
    '',
    'ORIGIN',
    '日本語と絵文字 🚀 を含む成果物',
    '<main>' + '繰り返し可能な成果物'.repeat(4_000) + '</main>',
  ])('round-trips UTF-8 text without loss', async (text) => {
    const compressed = await compressText(text);
    await expect(decompressText(compressed)).resolves.toBe(text);
  });

  it('uses the gzip signature when native streams are available', async () => {
    if (typeof nativeCompression !== 'function' || typeof nativeDecompression !== 'function') return;
    expect(isGzipCompressed(await compressText('compressible '.repeat(200)))).toBe(true);
  });

  it('falls back transparently to UTF-8 bytes when compression is unsupported', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    const text = '非対応ブラウザーでも失われない';
    const stored = await compressText(text);
    expect(isGzipCompressed(stored)).toBe(false);
    await expect(decompressText(stored)).resolves.toBe(text);
  });
});
