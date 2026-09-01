import { describe, expect, it } from 'vitest';
import { appendCheckpoint, createCheckpoint } from '../src/agent/checkpointStore.js';

describe('checkpoint store', () => {
  it('redacts secret-like values and bounds history', () => {
    let history = [] as ReturnType<typeof createCheckpoint>[];
    for (let i = 1; i <= 25; i += 1) {
      history = appendCheckpoint(history, createCheckpoint('task-1', i, 'completed', `step ${i} token=super-secret`));
    }
    expect(history).toHaveLength(20);
    expect(history[0].summary).not.toContain('super-secret');
  });

  it('creates deterministic checkpoint ids for identical state', () => {
    const a = createCheckpoint('task-1', 1, 'pending', 'reading repository');
    const b = createCheckpoint('task-1', 1, 'pending', 'reading repository');
    expect(a.id).toBe(b.id);
  });
});
