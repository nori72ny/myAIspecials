// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  CREATIVE_HISTORY_LIMIT_V15,
  isCreativeHistoryEntryShapeV15,
  selectNewestCreativeHistoryV15,
  type CreativeHistoryEntryV15,
} from './localVisualHistoryV15';

function entry(index: number): CreativeHistoryEntryV15 {
  const sha = index.toString(16).padStart(64, '0');
  return {
    version: 1,
    id: sha,
    sha256: sha,
    title: `Visual ${index}`,
    preset: 'portrait',
    downloadName: `visual-${index}.svg`,
    createdAt: 1_700_000_000_000 + index,
    svgBlob: new Blob([`<svg xmlns="http://www.w3.org/2000/svg"><text>${index}</text></svg>`], { type: 'image/svg+xml' }),
  };
}

describe('localVisualHistoryV15', () => {
  it('accepts only bounded, local SVG history records', () => {
    expect(isCreativeHistoryEntryShapeV15(entry(1))).toBe(true);
    expect(isCreativeHistoryEntryShapeV15({ ...entry(2), downloadName: '../escape.svg' })).toBe(false);
    expect(isCreativeHistoryEntryShapeV15({ ...entry(3), svgBlob: new Blob(['x'], { type: 'text/plain' }) })).toBe(false);
    expect(isCreativeHistoryEntryShapeV15({ ...entry(4), sha256: 'bad' })).toBe(false);
  });

  it('accepts bounded provenance and lineage metadata without breaking legacy entries', () => {
    const base = entry(5);
    expect(isCreativeHistoryEntryShapeV15({
      ...base,
      generationId: `visual-${'a'.repeat(24)}`,
      visualBrainVersion: 'visual-brain-v1',
      providerId: 'origin-local-svg',
      planSha256: 'b'.repeat(64),
      relation: 'generated',
    })).toBe(true);
    expect(isCreativeHistoryEntryShapeV15({ ...base, planSha256: 'bad' })).toBe(false);
    expect(isCreativeHistoryEntryShapeV15({ ...base, relation: 'unknown' })).toBe(false);
    expect(isCreativeHistoryEntryShapeV15({ ...base, parentId: '../bad' })).toBe(false);
  });

  it('keeps only the newest bounded history entries', () => {
    const entries = Array.from({ length: CREATIVE_HISTORY_LIMIT_V15 + 5 }, (_, index) => entry(index + 1));
    const selected = selectNewestCreativeHistoryV15(entries);
    expect(selected).toHaveLength(CREATIVE_HISTORY_LIMIT_V15);
    expect(selected[0]?.title).toBe(`Visual ${CREATIVE_HISTORY_LIMIT_V15 + 5}`);
    expect(selected.at(-1)?.title).toBe('Visual 6');
  });
});
