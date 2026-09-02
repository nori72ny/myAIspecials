import { describe, expect, it } from 'vitest';
import { assertVerificationSuccess, shouldAttemptRepair } from '../src/agent/verificationPolicy.js';

describe('verification policy', () => {
  it('accepts only zero-exit successful verification', () => {
    expect(() => assertVerificationSuccess({ ok: true, command: 'npm run test', exitCode: 0, stderr: '' })).not.toThrow();
    expect(() => assertVerificationSuccess({ ok: false, command: 'npm run test', exitCode: 1, stderr: 'failure' })).toThrow('VERIFICATION_FAILED');
  });
  it('never permits more than three repair rounds', () => {
    expect(shouldAttemptRepair({ ok: false, command: 'npm run test', exitCode: 1, stderr: 'x' }, 2)).toBe(true);
    expect(shouldAttemptRepair({ ok: false, command: 'npm run test', exitCode: 1, stderr: 'x' }, 3)).toBe(false);
    expect(shouldAttemptRepair({ ok: false, command: 'npm run test', exitCode: 1, stderr: 'x' }, 1, 99)).toBe(true);
  });
});
