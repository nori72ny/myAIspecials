import { describe, expect, it, vi } from 'vitest';

import { AgentCodingBridgeV3 } from './agentCodingBridgeV3.js';
import { codingAgentTargetKeyForRunV14 } from './codingAgentTargetKeyV14.js';
import type { CodingJobResultV14 } from './codingJobResultV14.js';
import type { CodingJobPublicRecordV14 } from './supabaseCodingJobStoreV14.js';

const env = {
  ORIGIN_AGENT_APPROVAL_SECRET: 'a'.repeat(48),
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: 'b'.repeat(48),
  ORIGIN_RELEASE_SHA: 'a'.repeat(40),
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
    executionEvidence: { sourceRevision: 'a'.repeat(40), workerRunId: '12345', workerRunAttempt: 1 },
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

  it('rejects four green checks when the build kind was replaced by a duplicate test', async () => {
    const created = record('queued');
    const terminal = record('verified');
    const misleading = verifiedResult();
    misleading.verificationChecks[3] = { ...misleading.verificationChecks[2] };
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => terminal),
      requestCancel: vi.fn(async () => terminal),
    };
    const resultStore = { get: vi.fn(async () => 'ciphertext') };
    const dispatch = vi.fn(async () => ({
      accepted: true as const,
      jobId: created.jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const bridge = new AgentCodingBridgeV3(env, jobStore, resultStore, dispatch, () => misleading);
    const started = await bridge.start('run-agent-duplicate', 'Repair the bug.');
    const polled = await bridge.poll('run-agent-duplicate', started.jobId, started.bridgeToken);
    expect(polled.ok).toBe(false);
    expect(polled.status).toBe('blocked');
    if ('code' in polled) expect(polled.code).toBe('AGENT_CODING_VERIFICATION_INCOMPLETE');
  });

  it.each([
    ['missing worker execution provenance', (value: CodingJobResultV14) => { delete value.executionEvidence; }],
    ['wrong source revision', (value: CodingJobResultV14) => { value.executionEvidence = { sourceRevision: 'b'.repeat(40), workerRunId: '12345', workerRunAttempt: 1 }; }],
    ['empty code diff', (value: CodingJobResultV14) => { value.diffs = []; }],
    ['different changed path', (value: CodingJobResultV14) => { value.diffs = [{ ...value.diffs[0], path: 'src/wrong.ts' }]; }],
  ] as const)('rejects apparent final success with %s', async (_name, breakEvidence) => {
    const created = record('queued');
    const terminal = record('verified');
    const bad = verifiedResult();
    breakEvidence(bad);
    const store = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => terminal),
      requestCancel: vi.fn(async () => terminal),
    };
    const results = { get: vi.fn(async () => 'ciphertext') };
    const dispatch = vi.fn(async () => ({
      accepted: true as const,
      jobId: created.jobId,
      repository: 'nori72ny/myAIspecials' as const,
      workflow: 'coding-job-worker-v14.yml' as const,
      ref: 'main' as const,
    }));
    const bridge = new AgentCodingBridgeV3(env, store, results, dispatch, () => bad);
    const started = await bridge.start('run-agent-proof-'+_name.length, 'Repair a bug.');
    const response = await bridge.poll('run-agent-proof-'+_name.length, started.jobId, started.bridgeToken);
    expect(response.status).toBe('blocked');
    expect(response.ok).toBe(false);
    if ('code' in response) expect(response.code).toBe('AGENT_CODING_VERIFICATION_INCOMPLETE');
  });

  it('rejects a verified result when the deployment release SHA cannot be determined', async () => {
    const created = record('queued');
    const terminal = record('verified');
    const deploymentWithoutSha = { ...env, ORIGIN_RELEASE_SHA: undefined, VERCEL_GIT_COMMIT_SHA: undefined };
    const bridge = new AgentCodingBridgeV3(
      deploymentWithoutSha,
      { create: async () => created, getJob: async () => terminal, requestCancel: async () => terminal } as any,
      { get: async () => 'ciphertext' } as any,
      async () => ({ accepted: true as const, jobId: created.jobId, repository: 'nori72ny/myAIspecials' as const, workflow: 'coding-job-worker-v14.yml' as const, ref: 'main' as const }),
      () => verifiedResult(),
    );
    const started = await bridge.start('run-agent-missing-release', 'Repair a bug.');
    const response = await bridge.poll('run-agent-missing-release', started.jobId, started.bridgeToken);
    expect(response.status).toBe('blocked');
    expect(response.ok).toBe(false);
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


  it('rotates a valid polling capability across the original 30-minute deadline without granting an expired token', async () => {
    const created = record('queued');
    const store = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => created),
    };
    const bridge = new AgentCodingBridgeV3(env, store, { get: vi.fn(async () => null) },
      async jobId => ({
        accepted: true as const,
        jobId,
        repository: 'nori72ny/myAIspecials' as const,
        workflow: 'coding-job-worker-v14.yml' as const,
        ref: 'main' as const,
      }));
    const now = Date.now();
    const started = await bridge.start('run-rolling-capability', 'Repair bug safely.', now);
    const renewed = await bridge.poll('run-rolling-capability', started.jobId, started.bridgeToken, now + 29 * 60_000);
    expect(renewed.ok).toBe(true);
    expect(renewed.status).toBe('running');
    if (!renewed.ok || renewed.status !== 'running') throw new Error('EXPECTED_RUNNING');
    expect(renewed.bridgeToken).not.toBe(started.bridgeToken);
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(started.expiresAt));
    const stale = await bridge.poll('run-rolling-capability', started.jobId, started.bridgeToken, now + 31 * 60_000);
    expect(stale.ok).toBe(false);
    if ('code' in stale) expect(stale.code).toBe('AGENT_CODING_BRIDGE_TOKEN_INVALID');
    const continued = await bridge.poll('run-rolling-capability', started.jobId, renewed.bridgeToken, now + 58 * 60_000);
    expect(continued.ok).toBe(true);
    expect(continued.status).toBe('running');
    const wrongRun = await bridge.poll('run-not-authorized', started.jobId, renewed.bridgeToken, now + 58 * 60_000);
    expect(wrongRun.ok).toBe(false);
    if ('code' in wrongRun) expect(wrongRun.code).toBe('AGENT_CODING_BRIDGE_TOKEN_INVALID');
  });

  it('does not extend a rolling bearer capability beyond the original durable Coding job TTL', async () => {
    const created = record('queued');
    const store = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => created),
    };
    const bridge = new AgentCodingBridgeV3(env, store, { get: vi.fn(async () => null) },
      async jobId => ({
        accepted: true as const,
        jobId,
        repository: 'nori72ny/myAIspecials' as const,
        workflow: 'coding-job-worker-v14.yml' as const,
        ref: 'main' as const,
      }));
    const now = Date.now();
    const started = await bridge.start('run-absolute-cap', 'Repair bug safely.', now);
    let token = started.bridgeToken;
    let finalExpiry = Date.parse(started.expiresAt);
    for (let minutes = 25; minutes < 24 * 60; minutes += 25) {
      const state = await bridge.poll('run-absolute-cap', started.jobId, token, now + minutes * 60_000);
      expect(state.ok).toBe(true);
      expect(state.status).toBe('running');
      if (!state.ok || state.status !== 'running') throw new Error('EXPECTED_RUNNING');
      token = state.bridgeToken;
      finalExpiry = Date.parse(state.expiresAt);
      expect(finalExpiry).toBeLessThanOrEqual(now + 24 * 60 * 60_000);
    }
    expect(finalExpiry).toBe(now + 24 * 60 * 60_000);
    const exhausted = await bridge.poll('run-absolute-cap', started.jobId, token, now + 24 * 60 * 60_000);
    expect(exhausted.ok).toBe(false);
    if ('code' in exhausted) expect(exhausted.code).toBe('AGENT_CODING_BRIDGE_TOKEN_INVALID');
  });


  it('validates an already verified job against its immutable creation SHA after the app is updated', async () => {
    const runId = 'run-old-production-release';
    const jobId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';
    const createdSha = 'a'.repeat(40);
    const currentSha = 'c'.repeat(40);
    const terminal = {
      ...record('verified'),
      targetKey: codingAgentTargetKeyForRunV14(runId, createdSha),
    };
    const result = verifiedResult();
    const jobStore = {
      create: vi.fn(async () => terminal),
      getJob: vi.fn(async () => terminal),
      requestCancel: vi.fn(async () => terminal),
    };
    const resultStore = { get: vi.fn(async () => 'ciphertext') };
    const bridge = new AgentCodingBridgeV3({
      ...env, ORIGIN_RELEASE_SHA: currentSha,
    }, jobStore, resultStore,
    async () => { throw new Error('RECOVERY_MUST_NOT_REDISPATCH'); },
    () => result);
    const recovered = await bridge.recover(runId, jobId);
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error('EXPECTED_RECOVERY');
    const polled = await bridge.poll(runId, jobId, recovered.bridgeToken);
    expect(polled).toMatchObject({ ok: true, status: 'completed', verified: true });
    const crossRun = await bridge.recover('run-unrelated', jobId);
    expect(crossRun.ok).toBe(false);

    const forgedResult = { ...result,
      executionEvidence: { ...result.executionEvidence!, sourceRevision: currentSha },
    };
    const forgedBridge = new AgentCodingBridgeV3({ ...env, ORIGIN_RELEASE_SHA: currentSha },
      jobStore, resultStore, async () => { throw new Error('NO_DISPATCH'); }, () => forgedResult);
    const malformed = await forgedBridge.poll(runId, jobId, recovered.bridgeToken);
    expect(malformed).toMatchObject({
      ok: false, status: 'blocked', verified: false, code: 'AGENT_CODING_VERIFICATION_INCOMPLETE',
    });
    expect(jobStore.create).not.toHaveBeenCalled();
    expect(jobStore.requestCancel).not.toHaveBeenCalled();
  });

  it('restores only an owner-bound and run-matched durable job without new dispatch', async () => {
    const runId = 'run-recovery-test';
    const created = { ...record('queued'), targetKey: codingAgentTargetKeyForRunV14(runId) };
    const jobStore = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => created),
    };
    const dispatch = vi.fn(async () => { throw new Error('RECOVERY_MUST_NOT_DISPATCH'); });
    const bridge = new AgentCodingBridgeV3(env, jobStore, { get: vi.fn(async () => null) }, dispatch);
    const restored = await bridge.recover(runId, created.jobId);
    expect(restored).toMatchObject({
      ok: true, status: 'running', runId, jobId: created.jobId,
      freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(jobStore.create).not.toHaveBeenCalled();
    expect(jobStore.requestCancel).not.toHaveBeenCalled();
    expect(jobStore.getJob).toHaveBeenCalledWith(created.jobId, expect.stringMatching(/^[0-9a-f]{64}$/));
    if (!restored.ok) throw new Error('RECOVERY_EXPECTED');
    expect((await bridge.poll(runId, created.jobId, restored.bridgeToken)).status).toBe('running');
    expect((await bridge.recover('run-other', created.jobId)).ok).toBe(false);
    expect((await bridge.recover('run-recovery-test', 'coding-BBBBBBBBBBBBBBBBBBBBBB')).ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('denies recovery after the durable job expires and never extends a terminal job lifetime', async () => {
    const runId = 'run-recovery-expired';
    const now = Date.now();
    const created = { ...record('verified'), targetKey: codingAgentTargetKeyForRunV14(runId), expiresAt: now + 60_000 };
    const store = {
      create: vi.fn(async () => created),
      getJob: vi.fn(async () => created),
      requestCancel: vi.fn(async () => created),
    };
    const bridge = new AgentCodingBridgeV3(env, store, { get: vi.fn(async () => null) });
    const resumed = await bridge.recover(runId, created.jobId, now);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error('RECOVERY_EXPECTED');
    expect(Date.parse(resumed.expiresAt)).toBe(now + 60_000);
    const expired = await bridge.recover(runId, created.jobId, now + 60_000);
    expect(expired.ok).toBe(false);
    expect(expired).toMatchObject({ code: 'AGENT_CODING_RECOVERY_UNAVAILABLE' });
    expect(store.create).not.toHaveBeenCalled();
    expect(store.requestCancel).not.toHaveBeenCalled();
  });


});
