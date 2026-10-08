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
  it('limits snapshots to bounded revision counts and content sizes', () => {
    const oversized = Array.from({ length: 65 }, (_, i) => ({ ...history[1], id: `demo:v${i}` }));
    expect(recover(oversized, '<main>編集済み</main>')).toBeUndefined();
    expect(recover([{ ...history[1], content: 'X'.repeat(1_000_001) }], '<main>編集済み</main>')).toBeUndefined();
  });
});
