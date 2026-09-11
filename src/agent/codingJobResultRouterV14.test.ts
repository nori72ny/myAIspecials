// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createCodingJobV14Router } from './codingJobRouterV14.js';
import { encryptCodingJobResultV14, type CodingJobResultV14 } from './codingJobResultV14.js';
import type { CodingJobPublicRecordV14 } from './supabaseCodingJobStoreV14.js';

const approvalSecret = 'a'.repeat(48);
const env = {
  ORIGIN_AGENT_APPROVAL_SECRET: approvalSecret,
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 11).toString('base64'),
  ORIGIN_CODING_WORKER_ENABLED: 'true',
};
const jobId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';

function record(status: CodingJobPublicRecordV14['status'] = 'verified'): CodingJobPublicRecordV14 {
  const now = Date.now();
  return {
    jobId,
    targetKey: 'origin:self',
    status,
    attempt: 1,
    version: 4,
    cancelRequested: false,
    resultCode: status === 'verified' ? 'CODING_CHECKS_PASSED' : null,
    changedPaths: status === 'verified' ? ['src/example.ts'] : [],
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 60_000,
  };
}

const result: CodingJobResultV14 = {
  schemaVersion: 1,
  sessionStatus: 'verified',
  repairRounds: 0,
  diffs: [{
    path: 'src/example.ts',
    kind: 'modified',
    before: 'export const value = 1;\n',
    after: 'export const value = 2;\n',
    beforeTruncated: false,
    afterTruncated: false,
    previewAvailable: true,
  }],
  verificationChecks: (['typecheck', 'lint', 'test', 'build'] as const).map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false, attempt: 0 })),
  freeOnly: true,
  costUsd: 0,
  gitPublished: false,
  deployed: false,
};

function appFor(store: { getJob: ReturnType<typeof vi.fn> }, resultStore: { get: ReturnType<typeof vi.fn>; delete?: ReturnType<typeof vi.fn> }) {
  const app = express();
  app.use(express.json());
  app.use(createCodingJobV14Router(env, store as never, vi.fn() as never, { delete: vi.fn(async () => true), ...resultStore } as never));
  return app;
}

describe('V1.4 coding job result API', () => {
  it('decrypts terminal result details only after owner-scoped job authorization', async () => {
    const encrypted = encryptCodingJobResultV14(jobId, result, env);
    const store = { getJob: vi.fn(async (_jobId: string, ownerHash: string) => ownerHash ? record() : null) };
    const resultStore = { get: vi.fn(async () => encrypted) };
    const response = await request(appFor(store, resultStore))
      .get(`/api/coding/v1.4/jobs/${jobId}`)
      .set('Authorization', `Bearer ${approvalSecret}`);

    expect(response.status).toBe(200);
    expect(response.body.resultDetailsState).toBe('available');
    expect(response.body.result).toEqual(result);
    expect(store.getJob).toHaveBeenCalledTimes(1);
    expect(resultStore.get).toHaveBeenCalledWith(jobId);
  });

  it('never reads result ciphertext when the owner-scoped job lookup is denied', async () => {
    const store = { getJob: vi.fn(async () => null) };
    const resultStore = { get: vi.fn() };
    const response = await request(appFor(store, resultStore))
      .get(`/api/coding/v1.4/jobs/${jobId}`)
      .set('Authorization', `Bearer ${approvalSecret}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CODING_JOB_NOT_FOUND');
    expect(resultStore.get).not.toHaveBeenCalled();
  });
});
