import { describe, expect, it } from 'vitest';
import { recoverPersistedArtifactRevisions as recover } from './recoverPersistedArtifactRevisions.js';

const history = [
  { id: 'demo:v1', content: '<main>初版</main>', createdAt: 0, source: 'generated' },
  { id: 'demo:v2', content: '<main>編集済み</main>', createdAt: 12, source: 'direct-touch' },
] as const;

describe('PWA durable artifact revisions', () => {
  it('retains all original revisions and source metadata after a successful reload', () => {
    const restored = recover(history, '<main>編集済み</main>');
    expect(restored).toEqual(history);
    expect(restored?.[0]?.content).toBe('<main>初版</main>');
    expect(restored?.[1]?.source).toBe('direct-touch');
  });
  it('rejects stale revision histories without discarding the artifact body', () => {
    expect(recover(history, '<main>新しい未反映版</main>')).toBeUndefined();
  });
  it('rejects corrupted revision objects, unknown sources, and duplicate revisions', () => {
    for (const value of [
      null, [], [null], [false], [{ ...history[1], createdAt: Infinity }],
      [{ ...history[1], source: 'external' }],
      [{ ...history[0], content: 9 }],
      [history[0], history[0]], 
    ]) {
      expect(recover(value, '<main>編集済み</main>')).toBeUndefined();
    }
  });
  it('retains only the newest 64 entries from an older oversized saved history', () => {
    const legacy = Array.from({ length: 101 }, (_, i) => ({
      ...history[1], id: `demo:v${i + 1}`, content: i === 100 ? '<main>最新</main>' : '<main>過去</main>',
    }));
    const restored = recover(legacy, '<main>最新</main>');
    expect(restored).toHaveLength(64);
    expect(restored?.[0].id).toBe('demo:v38');
    expect(restored?.at(-1)?.id).toBe('demo:v101');
  });
  it('restores recent revisions when a legacy 64-entry journal exceeds the aggregate size cap', () => {
    const big = '日'.repeat(900_000);
    const legacy = Array.from({ length: 15 }, (_, i) => ({
      id: `large:v${i + 1}`, content: big,
      createdAt: i, source: 'direct-touch' as const,
    }));
    const restored = recover(legacy, big);
    expect(restored).toHaveLength(11);
    expect(restored?.[0].id).toBe('large:v5');
    expect(restored?.at(-1)?.id).toBe('large:v15');
    expect(restored?.reduce((total, v) => total + v.content.length, 0)).toBeLessThanOrEqual(10_000_000);
  });

  it('ignores an oversized old version but never accepts an oversized latest version', () => {
    const tooLarge = { ...history[0], content: 'x'.repeat(1_000_001) };
    const restored = recover([tooLarge, history[1]], '<main>編集済み</main>');
    expect(restored).toEqual([history[1]]);
    expect(recover([history[0], tooLarge], tooLarge.content)).toBeUndefined();
  });

  it('rejects oversized individual revisions and invalid last content', () => {
    expect(recover([{ ...history[1], content: 'X'.repeat(1_000_001) }], '<main>編集済み</main>')).toBeUndefined();
    expect(recover(history, 'different')).toBeUndefined();
  });
});
