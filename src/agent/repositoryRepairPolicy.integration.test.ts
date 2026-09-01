import { describe, expect, it } from 'vitest';
import { createRepairPlan } from './codingRepairContract.js';

const failure = {
  kind: 'build' as const,
  exitCode: 1,
  timedOut: false,
  stdout: '',
  stderr: 'vite build failed: unexpected token',
};

describe('repository repair decision integration', () => {
  it('moves a new build failure into a bounded repair contract', () => {
    const plan = createRepairPlan(failure, 1);
    expect(plan.decision.action).toBe('repair');
    expect(plan.decision.fingerprint).toBe(plan.fingerprint);
  });

  it('does not authorize a repair after a repeated fingerprint', () => {
    const first = createRepairPlan(failure, 1);
    const repeated = createRepairPlan(failure, 2, [first.fingerprint]);
    expect(repeated.decision.action).toBe('stop');
  });
});
