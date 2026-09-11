// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodingJobEnvelopeV14 } from './codingJobCryptoV14.js';
import { runCodingJobWorkerV14, type CodingJobLeaseV14 } from './codingJobWorkerV14.js';
import type { CodingCheck } from './codingSessionV14.js';
import type { CodingJobPublicRecordV14 } from './supabaseCodingJobStoreV14.js';
import type { OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const roots: string[] = [];
const kinds = ['typecheck', 'lint', 'test', 'build'] as const;
const workerId = 'gha:123:1';
const green = (): CodingCheck[] => kinds.map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false }));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const env = {
  OPENROUTER_API_KEY: 'test-only',
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 17).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 19).toString('base64'),
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'origin-job-cancel-result-v14-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/math.js'), 'export const add = (a, b) => a - b;\n');
  const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'owner', targetKey: 'origin:self', goal: 'Fix addition' }, env);
  const lease: CodingJobLeaseV14 = {
    jobId: envelope.jobId,
    targetKey: envelope.targetKey,
    status: 'leased',
    attempt: 1,
    version: 2,
    cancelRequested: false,
    resultCode: null,
    changedPaths: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: envelope.expiresAt,
    payloadCiphertext: envelope.payloadCiphertext,
    leaseOwner: workerId,
    leaseExpiresAt: Date.now() + 120_000,
  };
  return { root, envelope, lease };
}

const execute = vi.fn(async (): Promise<OriginProviderExecutionResult> => ({
  text: JSON.stringify({ edits: [{ path: 'src/math.js', search: 'a - b', replacement: 'a + b' }], creates: [] }),
  actualCostUsd: 0,
  usage: { costUsd: 0 },
  providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  routingEvidence: {
    requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
    servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
    provider: 'OpenRouter',
    strategy: 'adaptive-primary',
    attempt: 1,
    fallbackUsed: false,
  },
}));

function captureResult(session: { status: 'verified' | 'blocked' | 'repair_limit'; repairRounds: number }) {
  return Promise.resolve({
    schemaVersion: 1 as const,
    sessionStatus: session.status,
    repairRounds: session.repairRounds,
    diffs: [],
    verificationChecks: kinds.map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false, attempt: 0 })),
    freeOnly: true as const,
    costUsd: 0 as const,
    gitPublished: false as const,
    deployed: false as const,
  });
}

function durableStore(lease: CodingJobLeaseV14, cancelled: () => boolean) {
  let completed = false;
  const store = {
    recoverStaleJob: vi.fn(async (): Promise<CodingJobPublicRecordV14 | null> => null),
    claimJob: vi.fn(async () => lease),
    startJob: vi.fn(async () => true),
    markRepairing: vi.fn(async () => true),
    renewLease: vi.fn(async () => true),
    cancellationRequested: vi.fn(async () => cancelled()),
    acknowledgeCancel: vi.fn(async () => true),
    completeJob: vi.fn(async () => { completed = true; return true; }),
  };
  return { store, completed: () => completed };
}

describe('V1.4 cancellation/result race', () => {
  it('erases encrypted result evidence when cancellation wins after result persistence', async () => {
    const { root, envelope, lease } = await fixture();
    let cancel = false;
    const durable = durableStore(lease, () => cancel);
    const put = vi.fn(async (_jobId: string, _workerId: string, _ciphertext: string) => { cancel = true; return true; });
    const deleteResult = vi.fn(async () => true);

    const outcome = await runCodingJobWorkerV14(envelope.jobId, workerId, {
      store: durable.store,
      resultStore: { put, delete: deleteResult },
      env,
      execute,
      resolveTarget: async () => ({ root, allowedPaths: ['src/math.js'], trustedWorkspaceApproved: true }),
      verify: async () => green(),
      captureResult,
    });

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(envelope.jobId);
    expect(put.mock.calls[0][1]).toBe(workerId);
    expect(deleteResult).toHaveBeenCalledWith(envelope.jobId);
    expect(durable.store.acknowledgeCancel).toHaveBeenCalledTimes(1);
    expect(durable.completed()).toBe(false);
    expect(outcome).toEqual({ jobId: envelope.jobId, state: 'cancelled', code: 'CODING_CANCELLED_BY_USER' });
  });

  it('reports cancellation when lease-bound result insertion is rejected by a newly-set cancel request', async () => {
    const { root, envelope, lease } = await fixture();
    let cancel = false;
    const durable = durableStore(lease, () => cancel);
    const put = vi.fn(async (_jobId: string, _workerId: string, _ciphertext: string) => { cancel = true; return false; });
    const deleteResult = vi.fn(async () => true);

    const outcome = await runCodingJobWorkerV14(envelope.jobId, workerId, {
      store: durable.store,
      resultStore: { put, delete: deleteResult },
      env,
      execute,
      resolveTarget: async () => ({ root, allowedPaths: ['src/math.js'], trustedWorkspaceApproved: true }),
      verify: async () => green(),
      captureResult,
    });

    expect(put).toHaveBeenCalledTimes(1);
    expect(durable.store.acknowledgeCancel).toHaveBeenCalledTimes(1);
    expect(deleteResult).toHaveBeenCalledWith(envelope.jobId);
    expect(durable.completed()).toBe(false);
    expect(outcome).toEqual({ jobId: envelope.jobId, state: 'cancelled', code: 'CODING_CANCELLED_BY_USER' });
  });
});
