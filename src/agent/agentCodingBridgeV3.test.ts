import { describe, expect, it, vi } from 'vitest';

import { AgentCodingBridgeV3 } from './agentCodingBridgeV3.js';
import type { CodingJobResultV14 } from './codingJobResultV14.js';
import type { CodingJobPublicRecordV14 } from './supabaseCodingJobStoreV14.js';

const env = {
  ORIGIN_AGENT_APPROVAL_SECRET: 'a'.repeat(48),
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: 'b'.repeat(48),
} as NodeJS.ProcessEnv;

function record(status: CodingJobPublicRecordV14['status']): CodingJobPublicRecordV14 {
  const now = Date.now();
  return {
    jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
    targetKey: 'origin:self',
    status,
    attempt: status === 'queued' ? 0 : 1,
    version: 1,
    cancelRequested: false,
    resultCode: status === 'verified' ? 'CODING_VERIFIED' : null,
    changedPaths: status === 'verified' ? ['src/example.ts'] : [],
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 60_000,
  };
}

function verifiedResult(): CodingJobResultV14 {
  return {
    schemaVersion: 1,
    sessionStatus: 'verified',
    repairRounds: 1,
    diffs: [{
      path: 'src/example.ts',
      kind: 'created',
      before: null,
      after: 'export const value = 1;\n',
      beforeTruncated: false,
      afterTruncated: false,
      previewAvailable: true,
    }],
    verificationChecks: ['typecheck', 'lint', 'test', 'build'].map(kind => ({
      kind: kind as 'typecheck' | 'lint' | 'test' | 'build',
      ok: true,
      exitCode: 0,
      timedOut: false,
      attempt: 1,
    })),
    freeOnly: true,
    costUsd: 0,
    gitPublished: false,
    deployed: false,
  };
}

describe('AgentCodingBridgeV3', () => {
  it('dispatches a durable coding job but never reports dispatch as completion', async () => {
    const created = record('queued');
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => created),
    };
    const resultStore = { get: vi.fn(async () => null) };
    const dispatch = vi.fn(async (jobId: string) => ({
      accepted: true as const,
      jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const bridge = new AgentCodingBridgeV3(env, jobStore, resultStore, dispatch);

    const started = await bridge.start('run-agent-1', 'Fix the failing TypeScript test.');

    expect(started.status).toBe('running');
    expect(started.ok).toBe(true);
    expect(started.jobId).toBe(created.jobId);
    expect(started.costUsd).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(1);

    const polled = await bridge.poll('run-agent-1', started.jobId, started.bridgeToken);
    expect(polled.status).toBe('running');
    expect(polled.verified).toBe(false);
  });

  it('reports completed only after verified coding evidence proves all four checks', async () => {
    const created = record('queued');
    const terminal = record('verified');
    const result = verifiedResult();
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => terminal),
      requestCancel: vi.fn(async () => terminal),
    };
    const resultStore = { get: vi.fn(async () => 'ciphertext') };
    const dispatch = vi.fn(async (jobId: string) => ({
      accepted: true as const,
      jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const decode = vi.fn(() => result);
    const bridge = new AgentCodingBridgeV3(env, jobStore, resultStore, dispatch, decode);

    const started = await bridge.start('run-agent-2', 'Repair the bug and verify it.');
    const polled = await bridge.poll('run-agent-2', started.jobId, started.bridgeToken);

    expect(polled.ok).toBe(true);
    expect(polled.status).toBe('completed');
    expect(polled.verified).toBe(true);
    if (polled.status === 'completed') {
      expect(polled.result.verificationChecks).toHaveLength(4);
      expect(polled.result.verificationChecks.every(check => check.ok)).toBe(true);
    }
  });

  it('fails closed when a verified job has incomplete verification evidence', async () => {
    const created = record('queued');
    const terminal = record('verified');
    const incomplete = verifiedResult();
    incomplete.verificationChecks = incomplete.verificationChecks.slice(0, 3);
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => terminal),
      requestCancel: vi.fn(async () => terminal),
    };
    const resultStore = { get: vi.fn(async () => 'ciphertext') };
    const dispatch = vi.fn(async (jobId: string) => ({
      accepted: true as const,
      jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const bridge = new AgentCodingBridgeV3(env, jobStore, resultStore, dispatch, () => incomplete);

    const started = await bridge.start('run-agent-3', 'Repair the bug.');
    const polled = await bridge.poll('run-agent-3', started.jobId, started.bridgeToken);

    expect(polled.ok).toBe(false);
    expect(polled.status).toBe('blocked');
    if ('code' in polled) expect(polled.code).toBe('AGENT_CODING_VERIFICATION_INCOMPLETE');
  });

  it('binds polling to the exact run and coding job', async () => {
    const created = record('queued');
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => created),
    };
    const resultStore = { get: vi.fn(async () => null) };
    const dispatch = vi.fn(async (jobId: string) => ({
      accepted: true as const,
      jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const bridge = new AgentCodingBridgeV3(env, jobStore, resultStore, dispatch);

    const started = await bridge.start('run-agent-4', 'Inspect and fix the code.');
    const polled = await bridge.poll('run-other', started.jobId, started.bridgeToken);

    expect(polled.ok).toBe(false);
    if ('code' in polled) expect(polled.code).toBe('AGENT_CODING_BRIDGE_TOKEN_INVALID');
    expect(jobStore.getJob).not.toHaveBeenCalled();
  });

  it('requests cancellation if dispatch fails after durable job creation', async () => {
    const created = record('queued');
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => ({ ...created, status: 'cancelled' as const })),
    };
    const resultStore = { get: vi.fn(async () => null) };
    const bridge = new AgentCodingBridgeV3(
      env,
      jobStore,
      resultStore,
      async () => { throw new Error('CODING_DISPATCH_UNAVAILABLE'); },
    );

    await expect(bridge.start('run-agent-5', 'Fix code.')).rejects.toThrow('CODING_DISPATCH_UNAVAILABLE');
    expect(jobStore.requestCancel).toHaveBeenCalledTimes(1);
  });
  it('propagates cancellation to the durable coding job and does not claim completion', async () => {
    const created = record('queued');
    const cancelled = { ...created, status: 'cancelled' as const, cancelRequested: true };
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => cancelled),
    };
    const resultStore = { get: vi.fn(async () => null) };
    const dispatch = vi.fn(async (jobId: string) => ({
      accepted: true as const,
      jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const bridge = new AgentCodingBridgeV3(env, jobStore, resultStore, dispatch);

    const started = await bridge.start('run-agent-cancel', 'Repair code safely.');
    const stopped = await bridge.cancel('run-agent-cancel', started.jobId, started.bridgeToken);

    expect(stopped.ok).toBe(true);
    expect(stopped.status).toBe('cancelled');
    expect(stopped.cancelRequested).toBe(true);
    expect(jobStore.requestCancel).toHaveBeenCalledTimes(1);
  });

  it('does not allow a bridge token from another run to cancel a coding job', async () => {
    const created = record('queued');
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => created),
    };
    const resultStore = { get: vi.fn(async () => null) };
    const dispatch = vi.fn(async (jobId: string) => ({
      accepted: true as const,
      jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const bridge = new AgentCodingBridgeV3(env, jobStore, resultStore, dispatch);

    const started = await bridge.start('run-agent-owner', 'Repair code safely.');
    const stopped = await bridge.cancel('run-agent-other', started.jobId, started.bridgeToken);

    expect(stopped.ok).toBe(false);
    if ('code' in stopped) expect(stopped.code).toBe('AGENT_CODING_BRIDGE_TOKEN_INVALID');
    expect(jobStore.getJob).not.toHaveBeenCalled();
    expect(jobStore.requestCancel).not.toHaveBeenCalled();
  });

});
