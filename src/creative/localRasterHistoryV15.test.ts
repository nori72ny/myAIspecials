// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  deleteRasterAssetV15,
  isRasterAssetEntryShapeV15,
  listRasterAssetsV15,
  loadRasterAssetV15,
  saveRasterAssetV15,
  type RasterAssetEntryV15,
} from './localRasterHistoryV15';

function entry(overrides: Partial<RasterAssetEntryV15> = {}): RasterAssetEntryV15 {
  const sha = 'a'.repeat(64);
  return {
    version: 1,
    id: sha,
    sha256: sha,
    createdAt: 1_790_000_000_000,
    prompt: '夕焼けの海',
    mimeType: 'image/png',
    downloadName: 'origin-image.png',
    providerId: 'pollinations-zero-cost',
    model: 'tomdacatto/sana',
    generationId: `raster-${'b'.repeat(24)}`,
    visualBrainVersion: 'visual-brain-v1',
    planVersion: 'raster-visual-plan-v1',
    planSha256: 'd'.repeat(64),
    purpose: 'photograph',
    typographyOverlay: false,
    sourceCriticVersion: 'raster-structural-critic-v1',
    sourceQualityScore: 100,
    technicalCriticVersion: 'raster-technical-critic-v1',
    technicalQualityScore: 87,
    relation: 'generated',
    width: 1024,
    height: 1024,
    blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
    ...overrides,
  };
}

describe('localRasterHistoryV15', () => {
  it('accepts only bounded raster asset graph records', () => {
    expect(isRasterAssetEntryShapeV15(entry())).toBe(true);
    expect(isRasterAssetEntryShapeV15(entry({ downloadName: '../escape.png' }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ sha256: 'bad' }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ providerId: 'other' as never }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ relation: 'unknown' as never }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ parentId: '../bad' }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ mimeType: 'image/jpeg', blob: new Blob(['x'], { type: 'image/png' }) }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ width: 2048 }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ planSha256: 'bad' }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ visualBrainVersion: 'other' as never }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ planVersion: 'other' as never }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ typographyOverlay: 'yes' as never }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ sourceCriticVersion: 'other' as never }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ sourceQualityScore: 101 }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ technicalCriticVersion: 'other' as never }))).toBe(false);
    expect(isRasterAssetEntryShapeV15(entry({ technicalQualityScore: 101 }))).toBe(false);
  });

  it('supports verified lineage metadata for future variation and editing flows', () => {
    const parent = 'c'.repeat(64);
    expect(isRasterAssetEntryShapeV15(entry({ relation: 'variation', parentId: parent }))).toBe(true);
    expect(isRasterAssetEntryShapeV15(entry({ relation: 'edited-from', parentId: parent }))).toBe(true);
  });

  it('fails closed without IndexedDB rather than pretending local visual memory was saved', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    try {
      const base = entry();
      await expect(saveRasterAssetV15({
        sha256: base.sha256,
        createdAt: base.createdAt,
        prompt: base.prompt,
        mimeType: base.mimeType,
        downloadName: base.downloadName,
        providerId: base.providerId,
        model: base.model,
        generationId: base.generationId,
        visualBrainVersion: base.visualBrainVersion,
        planVersion: base.planVersion,
        planSha256: base.planSha256,
        purpose: base.purpose,
        typographyOverlay: base.typographyOverlay,
        sourceCriticVersion: base.sourceCriticVersion,
        sourceQualityScore: base.sourceQualityScore,
        technicalCriticVersion: base.technicalCriticVersion,
        technicalQualityScore: base.technicalQualityScore,
        relation: base.relation,
        width: base.width,
        height: base.height,
        blob: base.blob,
      })).resolves.toBe('unavailable');
      await expect(loadRasterAssetV15(base.id)).resolves.toEqual({ status: 'unavailable', entry: null });
      await expect(listRasterAssetsV15()).resolves.toEqual({ status: 'unavailable', entries: [] });
      await expect(deleteRasterAssetV15(base.id)).resolves.toBe('unavailable');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
      else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    }
  });
});
