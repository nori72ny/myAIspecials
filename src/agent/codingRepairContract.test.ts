import { describe, expect, it } from 'vitest';
import { createRepairPlan } from './codingRepairContract.js';

const failure = {
  kind: 'test' as const,
  exitCode: 1,
  timedOut: false,
  stdout: 'test failed',
  stderr: 'AssertionError: expected 1 to be 2',
};

describe('coding repair contract', () => {
  it('creates bounded repair instructions without executing anything', () => {
    const plan = createRepairPlan(failure, 1);
    expect(plan.decision.action).toBe('repair');
    expect(plan.constraints.length).toBeGreaterThan(3);
  });

  it('fails closed when the failure repeats', () => {
    const plan = createRepairPlan(failure, 2, [planFingerprint(failure)]);
    expect(plan.decision.action).toBe('stop');
  });
});

function planFingerprint(failure: typeof failure) {
  return createRepairPlan(failure, 1).fingerprint;
}
