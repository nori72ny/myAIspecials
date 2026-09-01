import { describe, expect, it } from 'vitest';
import {
  decideRepair,
  fingerprintRepairFailure,
  classifyRepairFailure,
  MAX_REPAIR_ATTEMPTS,
} from './repositoryRepairPolicy.js';

const failure = {
  kind: 'typecheck' as const,
  exitCode: 2,
  timedOut: false,
  stdout: '',
  stderr: 'src/example.ts(10,5): TypeScript error 2322',
};

describe('repository repair policy', () => {
  it('classifies explicit verification failures', () => {
    expect(classifyRepairFailure(failure)).toBe('typecheck');
  });

  it('returns a stable normalized fingerprint', () => {
    const a = fingerprintRepairFailure(failure);
    const b = fingerprintRepairFailure({ ...failure, stderr: 'src/other.ts(11,6): TypeScript error 2322' });
    expect(a).toBe(b);
  });

  it('permits a bounded repair for a new failure', () => {
    expect(decideRepair(failure, 1).action).toBe('repair');
  });

  it('stops on a repeated failure', () => {
    const fp = fingerprintRepairFailure(failure);
    const decision = decideRepair(failure, 2, [fp]);
    expect(decision.action).toBe('stop');
    expect(decision.reason).toContain('repeated');
  });

  it('stops at the maximum attempt count', () => {
    expect(decideRepair(failure, MAX_REPAIR_ATTEMPTS).action).toBe('stop');
  });

  it('fails closed on timeout', () => {
    expect(decideRepair({ ...failure, timedOut: true }, 1).action).toBe('stop');
  });
});
