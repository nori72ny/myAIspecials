import { describe, expect, it } from 'vitest';
import { appendOriginArtifactRevision as append, ORIGIN_ARTIFACT_HISTORY_LIMIT as MAX } from './artifactRevisionLedger';

const sample = (id: string, revision?: number) => ({
  id, content: '<main>v1</main>', revision,
});

describe('PWA bounded version ledger', () => {
  it('starts at v2 and keeps the first generated version', () => {
    const next = append(sample('abc'), '<main>edit</main>', 'direct-touch', 100);
    expect(next.revision).toBe(2);
    expect(next.latest).toEqual({
      id: 'abc:v2', content: '<main>edit</main>', createdAt: 100, source: 'direct-touch',
    });
    expect(next.revisions.map(x => x.id)).toEqual(['abc:v1', 'abc:v2']);
  });

  it('retains only the latest 64 edits while maintaining unique sequential version IDs', () => {
    let artifact = sample('abc');
    const ids = new Set<string>();
    for (let version = 2; version <= 102; version++) {
      const next = append(artifact, `<main>v${version}</main>`, 'direct-touch', version);
      expect(next.revision).toBe(version);
      expect(ids.has(next.latest.id)).toBe(false);
      ids.add(next.latest.id);
      artifact = { ...artifact, ...next, content: next.latest.content };
      expect(next.revisions.length).toBeLessThanOrEqual(MAX);
    }
    const final = artifact as typeof artifact & { revisions: { id: string }[] };
    expect(final.revisions).toHaveLength(64);
    expect(final.revisions.at(-1)?.id).toBe('abc:v102');
    expect(final.revisions[0].id).toBe('abc:v39');
  });

  it('does not reuse a version number after restoring a truncated history', () => {
    const history = Array.from({ length: 64 }, (_, i) => ({
      id: `abc:v${39 + i}`, content: `v${39 + i}`,
      createdAt: i, source: 'direct-touch' as const,
    }));
    const next = append({ ...sample('abc', 102), revisions: history }, 'recovered', 'restore', 300);
    expect(next.revision).toBe(103);
    expect(next.latest.id).toBe('abc:v103');
    expect(next.revisions[0].id).toBe('abc:v40');
    expect(next.revisions.at(-1)?.source).toBe('restore');
  });

  it('keeps a reloadable 10-million-character suffix after repeated large edits', () => {
    const big = 'x'.repeat(900_000);
    let state = { id: 'budget', content: big, revision: 1 };
    let history: ReturnType<typeof append>['revisions'] = [];
    for (let i = 2; i <= 16; i++) {
      const next = append({ ...state, ...(history.length ? { revisions: history } : {}) }, big, 'direct-touch', i);
      state = { id: state.id, content: big, revision: next.revision };
      history = next.revisions;
      expect(history.reduce((chars, item) => chars + item.content.length, 0)).toBeLessThanOrEqual(10_000_000);
    }
    expect(state.revision).toBe(16);
    expect(history).toHaveLength(11);
    expect(history.at(-1)?.id).toBe('budget:v16');
    expect(history[0].id).toBe('budget:v6');
  });

  it('does not fabricate a truncated revision when the newest content exceeds the persistence cap', () => {
    const content = 'x'.repeat(1_000_001);
    const next = append(sample('too-large'), content, 'direct-touch', 1);
    expect(next.latest.content).toBe(content);
    expect(next.revisions).toEqual([]);
  });

  it('infers the next sequence from the latest stored version ID when counter is missing', () => {
    const base = { ...sample('abc'), revisions: [
      { id: 'abc:v77', content: 'old', createdAt: 1, source: 'generated' as const },
    ] };
    expect(append(base, 'new', 'direct-touch').revision).toBe(78);
  });
});
