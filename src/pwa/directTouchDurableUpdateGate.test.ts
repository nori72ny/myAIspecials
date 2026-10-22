import { describe, expect, it } from 'vitest';
import { directTouchRevisionDurablySaved } from './directTouchDurableUpdateGate.js';

describe('Direct Touch durable PWA update gate', () => {
  const committed = 'commit:artifact-1:v2';
  const artifacts = [{ revisions: [{ id: 'artifact-1:v1' }, { id: 'artifact-1:v2' }] }];
  it('unlocks only after the exact latest revision was actually saved', () => {
    expect(directTouchRevisionDurablySaved(committed, committed, artifacts, 'saved')).toBe(true);
  });
  it.each(['quota-exceeded', 'failed', 'unavailable', 'saving'])(
    'keeps updates blocked when IndexedDB reports %s', result => {
      expect(directTouchRevisionDurablySaved(committed, committed, artifacts, result)).toBe(false);
    },
  );
  it('rejects uncommitted, outdated, or superseded edits', () => {
    expect(directTouchRevisionDurablySaved('editing', 'editing', artifacts, 'saved')).toBe(false);
    expect(directTouchRevisionDurablySaved(committed, 'editing', artifacts, 'saved')).toBe(false);
    expect(directTouchRevisionDurablySaved(committed, 'commit:artifact-1:v3', artifacts, 'saved')).toBe(false);
    expect(directTouchRevisionDurablySaved('commit:artifact-1:v1', 'commit:artifact-1:v1', artifacts, 'saved')).toBe(false);
    expect(directTouchRevisionDurablySaved(committed, committed, [], 'saved')).toBe(false);
    expect(directTouchRevisionDurablySaved(undefined, undefined, artifacts, 'saved')).toBe(false);
  });
  it('rejects bogus and oversized markers even on successful writes', () => {
    for (const candidate of ['commit:', 'commit:' + 'x'.repeat(400), 'true', 'false']) {
      expect(directTouchRevisionDurablySaved(candidate, candidate, artifacts, 'saved')).toBe(false);
    }
  });
});
