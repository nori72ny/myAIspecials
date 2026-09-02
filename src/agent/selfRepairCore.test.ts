import { describe, expect, it } from 'vitest';
import { createRepairState, decideRepair, fingerprintFailure } from './selfRepairCore';
import type { VerificationResult } from './verificationRunner';

const failure = (overrides: Partial<VerificationResult> = {}): VerificationResult => ({
  ok: false,
  kind: 'typecheck',
  exitCode: 1,
  timedOut: false,
  stdout: '',
  stderr: 'Type error: missing property',
  durationMs: 10,
  ...overrides,
});

describe('selfRepairCore', () => {
  it('allows the first distinct failure to trigger repair', () => {
    const state = createRepairState();
    const decision = decideRepair(state, failure());
    expect(decision.action).toBe('repair');
    expect(state.attempts).toBe(1);
  });

  it('stops immediately when the same failure fingerprint repeats', () => {
    const state = createRepairState();
    decideRepair(state, failure());
    const decision = decideRepair(state, failure());
    expect(decision).toEqual({ action: 'stop', reason: 'repeated_failure' });
    expect(state.stopped).toBe(true);
  });

  it('allows distinct failures up to the bounded attempt limit', () => {
    const state = createRepairState(3);
    expect(decideRepair(state, failure({ stderr: 'error A' })).action).toBe('repair');
    expect(decideRepair(state, failure({ stderr: 'error B' })).action).toBe('repair');
    expect(decideRepair(state, failure({ stderr: 'error C' })).action).toBe('repair');
    expect(decideRepair(state, failure({ stderr: 'error D' }))).toEqual({ action: 'stop', reason: 'max_attempts' });
  });

  it('fingerprints timeout separately from ordinary failures', () => {
    const normal = fingerprintFailure(failure());
    const timeout = fingerprintFailure(failure({ timedOut: true, exitCode: null }));
    expect(normal.class).toBe('typecheck');
    expect(timeout.class).toBe('timeout');
    expect(timeout.key).not.toBe(normal.key);
  });
});
