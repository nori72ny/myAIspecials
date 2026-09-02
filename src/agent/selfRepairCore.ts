import type { VerificationResult } from './verificationRunner';

export type FailureClass = 'test' | 'typecheck' | 'build' | 'timeout' | 'unknown';

export type FailureFingerprint = {
  class: FailureClass;
  key: string;
};

export type RepairState = {
  attempts: number;
  maxAttempts: number;
  lastFingerprint: FailureFingerprint | null;
  stopped: boolean;
  stopReason: 'max_attempts' | 'repeated_failure' | null;
};

export type RepairDecision =
  | { action: 'repair'; attempt: number; fingerprint: FailureFingerprint }
  | { action: 'stop'; reason: 'max_attempts' | 'repeated_failure' };

const DEFAULT_MAX_ATTEMPTS = 3;

function normalizeOutput(result: VerificationResult): string {
  return `${result.kind}|${result.exitCode ?? 'null'}|${result.timedOut ? 'timeout' : ''}|${result.stderr}|${result.stdout}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4096);
}

export function classifyFailure(result: VerificationResult): FailureClass {
  if (result.timedOut) return 'timeout';
  if (result.kind === 'test') return 'test';
  if (result.kind === 'typecheck') return 'typecheck';
  if (result.kind === 'build') return 'build';
  return 'unknown';
}

export function fingerprintFailure(result: VerificationResult): FailureFingerprint {
  const normalized = normalizeOutput(result);
  return {
    class: classifyFailure(result),
    key: `${classifyFailure(result)}:${normalized}`,
  };
}

export function createRepairState(maxAttempts = DEFAULT_MAX_ATTEMPTS): RepairState {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > DEFAULT_MAX_ATTEMPTS) {
    throw new Error('INVALID_REPAIR_ATTEMPT_LIMIT');
  }
  return {
    attempts: 0,
    maxAttempts,
    lastFingerprint: null,
    stopped: false,
    stopReason: null,
  };
}

export function decideRepair(state: RepairState, result: VerificationResult): RepairDecision {
  if (result.ok) {
    throw new Error('REPAIR_NOT_NEEDED_FOR_SUCCESS');
  }
  if (state.stopped) {
    return { action: 'stop', reason: state.stopReason ?? 'max_attempts' };
  }

  const fingerprint = fingerprintFailure(result);
  if (state.lastFingerprint?.key === fingerprint.key) {
    state.stopped = true;
    state.stopReason = 'repeated_failure';
    return { action: 'stop', reason: 'repeated_failure' };
  }

  if (state.attempts >= state.maxAttempts) {
    state.stopped = true;
    state.stopReason = 'max_attempts';
    return { action: 'stop', reason: 'max_attempts' };
  }

  state.attempts += 1;
  state.lastFingerprint = fingerprint;
  return { action: 'repair', attempt: state.attempts, fingerprint };
}
