// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodingJobEnvelopeV14 } from './codingJobCryptoV14.js';
import { runCodingJobWorkerV14, type CodingJobLeaseV14 } from './codingJobWorkerV14.js';
import type { CodingCheck } from './codingSessionV14.js';
import type { CodingJobCompletionStatusV14, CodingJobPublicRecordV14 } from './supabaseCodingJobStoreV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const roots: string[] = [];
const kinds = ['typecheck', 'lint', 'test', 'build'] as const;
const green = (): CodingCheck[] => kinds.map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false }));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const env = {
  OPENROUTER_API_KEY: 'test-only',
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 17).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 19).toString('base64'),
};
const modelResult = (text: string): OriginProviderExecutionResult => ({
  text, actualCostUsd: 0, usage: { costUsd: 0 }, providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, provider: 'OpenRouter', strategy: 'adaptive-primary', attempt: 1, fallbackUsed: false },
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'origin-job-worker-v14-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/math.js'), 'export const add = (a, b) => a - b;\n');
  const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'owner', targetKey: 'github:test/repo', goal: 'Fix addition' }, env);
  const lease: CodingJobLeaseV14 = {
    jobId: envelope.jobId, targetKey: envelope.targetKey, status: 'leased', attempt: 1, version: 2,
    cancelRequested: false, resultCode: null, changedPaths: [], createdAt: Date.now(), updatedAt: Date.now(),
    expiresAt: envelope.expiresAt, payloadCiphertext: envelope.payloadCiphertext, leaseOwner: 'gha:123:1', leaseExpiresAt: Date.now() + 120_000,
  };
  return { root, envelope, lease };
}

class FakeStore {
  cancel = false;
  renew = true;
  started = true;
  acknowledged = false;
  repairingCalls = 0;
  completion: { status: CodingJobCompletionStatusV14; code: string; paths: readonly string[] } | null = null;
  constructor(readonly lease: CodingJobLeaseV14) {}
  async recoverStaleJob(_jobId: string): Promise<CodingJobPublicRecordV14 | null> { return null; }
  async claimJob(_jobId: string, _workerId: string, _seconds: number): Promise<CodingJobLeaseV14 | null> { return this.lease; }
  async startJob(_jobId: string, _workerId: string): Promise<boolean> { return this.started; }
  async markRepairing(_jobId: string, _workerId: string): Promise<boolean> { this.repairingCalls += 1; return true; }
  async renewLease(_jobId: string, _workerId: string, _seconds: number): Promise<boolean> { return this.renew; }
  async cancellationRequested(_jobId: string, _workerId: string): Promise<boolean> { return this.cancel; }
  async acknowledgeCancel(_jobId: string, _workerId: string): Promise<boolean> { this.acknowledged = true; return true; }
  async completeJob(_jobId: string, _workerId: string, status: CodingJobCompletionStatusV14, code: string, paths: readonly string[]): Promise<boolean> {
    this.completion = { status, code, paths };
    return true;
  }
}

describe('V1.4 durable coding worker controller', () => {
  it('decrypts only after claim, edits an approved workspace, verifies, and atomically completes', async () => {
    const { root, envelope, lease } = await fixture();
    const store = new FakeStore(lease);
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _providerEnv: NodeJS.ProcessEnv) => modelResult(JSON.stringify({ edits: [{ path: 'src/math.js', search: 'a - b', replacement: 'a + b' }], creates: [] })));
    const outcome = await runCodingJobWorkerV14(envelope.jobId, 'gha:123:1', {
      store,
      env,
      execute,
      resolveTarget: async targetKey => ({ root, allowedPaths: targetKey === envelope.targetKey ? ['src/math.js'] : [], trustedWorkspaceApproved: true }),
      verify: async () => green(),
    });
    expect(outcome).toEqual({ jobId: envelope.jobId, state: 'verified', code: 'CODING_CHECKS_PASSED' });
    expect(store.completion).toEqual({ status: 'verified', code: 'CODING_CHECKS_PASSED', paths: ['src/math.js'] });
    expect(await readFile(path.join(root, 'src/math.js'), 'utf8')).toContain('a + b');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('honors a cancellation before model/provider access', async () => {
    const { root, envelope, lease } = await fixture();
    const store = new FakeStore(lease);
    store.cancel = true;
    const execute = vi.fn();
    const outcome = await runCodingJobWorkerV14(envelope.jobId, 'gha:123:1', {
      store, env, execute,
      resolveTarget: async () => ({ root, allowedPaths: ['src/math.js'], trustedWorkspaceApproved: true }),
      verify: async () => green(),
    });
    expect(outcome.state).toBe('cancelled');
    expect(store.acknowledged).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed without completing after losing the lease', async () => {
    const { root, envelope, lease } = await fixture();
    const store = new FakeStore(lease);
    store.renew = false;
    const execute = vi.fn();
    const outcome = await runCodingJobWorkerV14(envelope.jobId, 'gha:123:1', {
      store, env, execute,
      resolveTarget: async () => ({ root, allowedPaths: ['src/math.js'], trustedWorkspaceApproved: true }),
      verify: async () => green(),
    });
    expect(outcome).toEqual({ jobId: envelope.jobId, state: 'lease_lost', code: 'CODING_JOB_LEASE_LOST' });
    expect(store.completion).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(await readFile(path.join(root, 'src/math.js'), 'utf8')).toContain('a - b');
  });

  it('marks repair state and self-corrects after failed verification', async () => {
    const { root, envelope, lease } = await fixture();
    const store = new FakeStore(lease);
    let modelCall = 0;
    const execute = vi.fn(async () => {
      modelCall += 1;
      return modelCall === 1
        ? modelResult(JSON.stringify({ edits: [{ path: 'src/math.js', search: 'a - b', replacement: 'a + b + 1' }], creates: [] }))
        : modelResult(JSON.stringify({ edits: [{ path: 'src/math.js', search: 'a + b + 1', replacement: 'a + b' }], creates: [] }));
    });
    let checkRound = 0;
    const outcome = await runCodingJobWorkerV14(envelope.jobId, 'gha:123:1', {
      store, env, execute,
      resolveTarget: async () => ({ root, allowedPaths: ['src/math.js'], maxRepairs: 1, trustedWorkspaceApproved: true }),
      verify: async () => {
        checkRound += 1;
        return green().map(check => checkRound === 1 && check.kind === 'test' ? { ...check, ok: false, exitCode: 1, diagnostic: 'expected 5' } : check);
      },
    });
    expect(outcome.state).toBe('verified');
    expect(store.repairingCalls).toBe(1);
    expect(modelCall).toBe(2);
    expect(await readFile(path.join(root, 'src/math.js'), 'utf8')).toContain('a + b;');
  });
});
