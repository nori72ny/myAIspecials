import { describe, expect, it } from 'vitest';
import { coordinateRepositoryRepair } from './repositoryRepairCoordinator.js';
import type { RepairFailure } from './repositoryRepairPolicy.js';

const failure: RepairFailure = {
  kind: 'typecheck',
  exitCode: 1,
  timedOut: false,
  stdout: '',
  stderr: 'TS2322: Type mismatch',
};

describe('coordinateRepositoryRepair', () => {
  it('permits a new repair and records its fingerprint', () => {
    const result = coordinateRepositoryRepair(failure, { attempt: 0, fingerprints: [] });
    expect(result.action).toBe('repair');
    expect(result.state.attempt).toBe(1);
    expect(result.state.fingerprints).toHaveLength(1);
  });

  it('stops when the same failure fingerprint repeats', () => {
    const first = coordinateRepositoryRepair(failure, { attempt: 0, fingerprints: [] });
    const result = coordinateRepositoryRepair(failure, first.state);
    expect(result.action).toBe('stop');
    expect(result.plan.decision.reason).toContain('same verification failure');
  });

  it('fails closed on timeout', () => {
    const timeout = { ...failure, timedOut: true };
    const result = coordinateRepositoryRepair(timeout, { attempt: 0, fingerprints: [] });
    expect(result.action).toBe('stop');
    expect(result.plan.decision.reason).toContain('timed out');
  });
});
