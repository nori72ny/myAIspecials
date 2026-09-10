// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createCodingJobV14Router } from './codingJobRouterV14.js';
import type { CodingJobPublicRecordV14 } from './supabaseCodingJobStoreV14.js';

const approvalSecret = 'a'.repeat(48);
const env = {
  ORIGIN_AGENT_APPROVAL_SECRET: approvalSecret,
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 11).toString('base64'),
  ORIGIN_CODING_WORKER_ENABLED: 'true',
};

function appFor(store: any, dispatch = vi.fn(async (jobId: string) => ({
  accepted: true as const,
  jobId,
  repository: 'nori72ny/myAIspecials' as const,
  workflow: 'coding-job-worker-v14.yml' as const,
  ref: 'main' as const,
}))) {
  const app = express();
  app.use(express.json());
  app.use(createCodingJobV14Router(env, store, dispatch));
  return { app, dispatch };
}

function publicRecord(jobId: string): CodingJobPublicRecordV14 {
  const now = Date.now();
  return {
    jobId,
    targetKey: 'origin:self',
    status: 'queued',
    attempt: 0,
    version: 1,
    cancelRequested: false,
    resultCode: null,
    changedPaths: [],
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 60_000,
  };
}

describe('V1.4 coding job API', () => {
  it('stays fail-closed until the hosted worker is explicitly enabled', async () => {
    const disabledEnv = { ...env, ORIGIN_CODING_WORKER_ENABLED: 'false' };
    const app = express();
    app.use(express.json());
    app.use(createCodingJobV14Router(disabledEnv, {} as any));
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${approvalSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CODING_JOB_API_NOT_READY');
  });

  it('requires the server-only approval credential', async () => {
    const { app } = appFor({ create: vi.fn(), getJob: vi.fn(), requestCancel: vi.fn() });
    const response = await request(app).post('/api/coding/v1.4/jobs').send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('CODING_JOB_AUTHENTICATION_REQUIRED');
  });

  it('persists only an encrypted private envelope and dispatches only the opaque job id', async () => {
    let capturedEnvelope: any;
    const store = {
      create: vi.fn(async (envelope: any) => {
        capturedEnvelope = envelope;
        return publicRecord(envelope.jobId);
      }),
      getJob: vi.fn(),
      requestCancel: vi.fn(),
    };
    const { app, dispatch } = appFor(store);
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${approvalSecret}`)
      .send({ goal: 'fix the parser safely', confirmRun: true, ttlMinutes: 60 });

    expect(response.status).toBe(202);
    expect(capturedEnvelope.targetKey).toBe('origin:self');
    expect(capturedEnvelope.ownerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(capturedEnvelope.payloadCiphertext).toMatch(/^v1\./);
    expect(capturedEnvelope.payloadCiphertext).not.toContain('fix the parser safely');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]).toHaveLength(2);
    expect(dispatch.mock.calls[0][0]).toBe(capturedEnvelope.jobId);
  });

  it('cancels the durable row if GitHub dispatch is not accepted', async () => {
    let jobId = '';
    const store = {
      create: vi.fn(async (envelope: any) => {
        jobId = envelope.jobId;
        return publicRecord(envelope.jobId);
      }),
      getJob: vi.fn(),
      requestCancel: vi.fn(async (_jobId: string, _ownerHash: string) => publicRecord(jobId)),
    };
    const { app } = appFor(store, vi.fn(async () => { throw new Error('unavailable'); }));
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${approvalSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CODING_JOB_DISPATCH_UNAVAILABLE');
    expect(store.requestCancel).toHaveBeenCalledTimes(1);
    expect(store.requestCancel.mock.calls[0][0]).toBe(jobId);
    expect(store.requestCancel.mock.calls[0][1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps status and cancellation owner-scoped', async () => {
    const knownId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';
    const record = publicRecord(knownId);
    const store = {
      create: vi.fn(),
      getJob: vi.fn(async (_jobId: string, ownerHash: string) => ownerHash ? record : null),
      requestCancel: vi.fn(async (_jobId: string, ownerHash: string) => ownerHash ? { ...record, status: 'cancelled' as const, cancelRequested: true } : null),
    };
    const { app } = appFor(store);
    const status = await request(app).get(`/api/coding/v1.4/jobs/${knownId}`).set('Authorization', `Bearer ${approvalSecret}`);
    expect(status.status).toBe(200);
    expect(store.getJob.mock.calls[0][1]).toMatch(/^[0-9a-f]{64}$/);

    const cancelled = await request(app).delete(`/api/coding/v1.4/jobs/${knownId}`).set('Authorization', `Bearer ${approvalSecret}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.job.status).toBe('cancelled');
    expect(store.requestCancel.mock.calls[0][1]).toBe(store.getJob.mock.calls[0][1]);
  });
});
