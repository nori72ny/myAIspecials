import { describe, expect, it } from 'vitest';
import { compactAgentContext } from './contextCompaction';

describe('compactAgentContext', () => {
  it('keeps only bounded decision-relevant history', () => {
    const records = Array.from({ length: 30 }, (_, index) => ({
      stepId: `step-${index}`,
      outcome: 'success' as const,
      summary: `completed ${index}`,
      details: 'large tool output that should not be replayed',
    }));
    const summary = compactAgentContext(' build app ', records, 'run tests');
    expect(summary.goal).toBe('build app');
    expect(summary.completedSteps).toHaveLength(20);
    expect(summary.completedSteps[0]).toContain('step-10');
    expect(summary.failures).toEqual([]);
    expect(summary.nextAction).toBe('run tests');
    expect(JSON.stringify(summary)).not.toContain('large tool output');
  });

  it('preserves recent failures separately from successful progress', () => {
    const summary = compactAgentContext('fix bug', [
      { stepId: 'a', outcome: 'success', summary: 'read files' },
      { stepId: 'b', outcome: 'failure', summary: 'type error' },
      { stepId: 'c', outcome: 'blocked', summary: 'unsafe command' },
    ], 'repair');
    expect(summary.completedSteps).toEqual(['a: read files']);
    expect(summary.failures).toEqual(['b: type error', 'c: unsafe command']);
  });
});
