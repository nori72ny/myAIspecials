import { describe, expect, it } from 'vitest';
import {
  CODING_CHECK_TIMEOUT_MS,
  CODING_WORKER_LEASE_SECONDS,
  CODING_WORKER_RECOVERY_WAIT_SECONDS,
} from './codingWorkerTimingV14.js';
import { CODING_JOB_MAX_LEASE_SECONDS } from './supabaseCodingJobStoreV14.js';

describe('hosted Coding verification time budgets', () => {
  it('uses a bounded check deadline below the DB maximum lease, with margin for durable proof', () => {
    expect(CODING_CHECK_TIMEOUT_MS).toBeGreaterThanOrEqual(225_000); // measured 222.50s
    expect(CODING_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(270_000);
    expect(CODING_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(CODING_WORKER_LEASE_SECONDS * 1000 - 30_000);
    expect(CODING_WORKER_LEASE_SECONDS).toBeLessThanOrEqual(CODING_JOB_MAX_LEASE_SECONDS);
    expect(CODING_WORKER_RECOVERY_WAIT_SECONDS).toBeGreaterThan(CODING_WORKER_LEASE_SECONDS);
    expect(CODING_WORKER_RECOVERY_WAIT_SECONDS).toBeLessThanOrEqual(CODING_WORKER_LEASE_SECONDS + 10);
  });
});
