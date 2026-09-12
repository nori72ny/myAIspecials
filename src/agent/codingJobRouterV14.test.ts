// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createCodingJobV14Router } from './codingJobRouterV14.js';
import type { CodingJobPublicRecordV14 } from './supabaseCodingJobStoreV14.js';

const approvalSecret = 'a'.repeat(48);
const codingSecret = 'c'.repeat(48);
const env = {
  ORIGIN_AGENT_APPROVAL_SECRET: approvalSecret,
  ORIGIN_CODING_OPERATOR_SECRET: codingSecret,
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 11).toString('base64'),
  ORIGIN_CODING_GITHUB_DISPATCH_TOKEN: 'g'.repeat(40),
  ORIGIN_CODING_WORKER_ENABLED: 'true',
};

const defaultDispatch = () => vi.fn(async (jobId: string) => ({
  accepted: true as const,
  jobId,
  repository: 'nori72ny/myAIspecials' as const,
  workflow: 'coding-job-worker-v14.yml' as const,
  ref: 'main' as const,
}));

const defaultResultStore = () => ({
  get: vi.fn(async () => null),
  delete: vi.fn(async () => true),
});

function appFor(
  store: any,
  dispatch = defaultDispatch(),
  routerEnv: NodeJS.ProcessEnv = env,
  resultStore: any = defaultResultStore(),
) {
  const app = express();
  app.use(express.json());
  app.use(createCodingJobV14Router(routerEnv, store, dispatch, resultStore));
  return { app, dispatch, resultStore };
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
  it('reports exact submission readiness without exposing credential material', async () => {
    const { app } = appFor({ create: vi.fn(), getJob: vi.fn(), requestCancel: vi.fn() });
    const response = await request(app).get('/api/coding/v1.4/status');
    expect(response.status).toBe(200);
    expect(response.body.ready).toBe(true);
    expect(response.body.controlPlaneReady).toBe(true);
    expect(response.body.storeReady).toBe(true);
    expect(response.body.resultStoreReady).toBe(true);
    expect(response.body.authorizationReady).toBe(true);
    expect(response.body.ownerBindingReady).toBe(true);
    expect(response.body.dataKeyReady).toBe(true);
    expect(response.body.cryptoReady).toBe(true);
    expect(response.body.dispatchReady).toBe(true);
    expect(response.body.workerEnabled).toBe(true);
    expect(response.body.authorizationMode).toBe('coding-operator');
    expect(response.body.authorizationScope).toBe('coding-v1.4-only-when-dedicated');
    expect(JSON.stringify(response.body)).not.toContain(codingSecret);
    expect(JSON.stringify(response.body)).not.toContain(approvalSecret);
  });

  it('stays fail-closed for new work until the hosted worker is explicitly enabled', async () => {
    const disabledEnv = { ...env, ORIGIN_CODING_WORKER_ENABLED: 'false' };
    const { app } = appFor({ create: vi.fn(), getJob: vi.fn(), requestCancel: vi.fn() }, defaultDispatch(), disabledEnv);
    const status = await request(app).get('/api/coding/v1.4/status');
    expect(status.body.ready).toBe(false);
    expect(status.body.controlPlaneReady).toBe(true);
    expect(status.body.workerEnabled).toBe(false);
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${codingSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CODING_JOB_API_NOT_READY');
  });

  it('keeps status and cancellation available when new-job submission is disabled', async () => {
    const knownId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';
    const record = { ...publicRecord(knownId), status: 'running' as const, attempt: 1, version: 2 };
    const store = {
      create: vi.fn(),
      getJob: vi.fn(async () => record),
      requestCancel: vi.fn(async () => ({ ...record, cancelRequested: true })),
    };
    const degradedEnv = { ...env, ORIGIN_CODING_WORKER_ENABLED: 'false', ORIGIN_CODING_GITHUB_DISPATCH_TOKEN: '' };
    const { app } = appFor(store, defaultDispatch(), degradedEnv);
    const capability = await request(app).get('/api/coding/v1.4/status');
    expect(capability.body.ready).toBe(false);
    expect(capability.body.controlPlaneReady).toBe(true);
    expect(capability.body.dispatchReady).toBe(false);

    const status = await request(app).get(`/api/coding/v1.4/jobs/${knownId}`).set('Authorization', `Bearer ${codingSecret}`);
    expect(status.status).toBe(200);
    expect(status.body.job.status).toBe('running');

    const cancel = await request(app).delete(`/api/coding/v1.4/jobs/${knownId}`).set('Authorization', `Bearer ${codingSecret}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.job.cancelRequested).toBe(true);
  });

  it('requires the coding operator credential', async () => {
    const { app } = appFor({ create: vi.fn(), getJob: vi.fn(), requestCancel: vi.fn() });
    const response = await request(app).post('/api/coding/v1.4/jobs').send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('CODING_JOB_AUTHENTICATION_REQUIRED');
  });

  it('rejects the broader agent credential once the dedicated coding credential exists', async () => {
    const { app } = appFor({ create: vi.fn(), getJob: vi.fn(), requestCancel: vi.fn() });
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${approvalSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('CODING_JOB_AUTHENTICATION_REQUIRED');
  });

  it('fails closed instead of falling back when a dedicated coding credential is present but invalid', async () => {
    const invalidDedicatedEnv = { ...env, ORIGIN_CODING_OPERATOR_SECRET: 'short' };
    const { app } = appFor({ create: vi.fn(), getJob: vi.fn(), requestCancel: vi.fn() }, defaultDispatch(), invalidDedicatedEnv);
    const status = await request(app).get('/api/coding/v1.4/status');
    expect(status.body.authorizationMode).toBe('unconfigured');
    expect(status.body.ready).toBe(false);
    expect(status.body.controlPlaneReady).toBe(false);
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${approvalSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CODING_JOB_API_NOT_READY');
  });

  it('keeps explicit legacy compatibility only while the dedicated coding credential is absent', async () => {
    const legacyEnv: NodeJS.ProcessEnv = { ...env };
    delete legacyEnv.ORIGIN_CODING_OPERATOR_SECRET;
    const store = {
      create: vi.fn(async (envelope: any) => publicRecord(envelope.jobId)),
      getJob: vi.fn(),
      requestCancel: vi.fn(),
    };
    const { app } = appFor(store, defaultDispatch(), legacyEnv);
    const status = await request(app).get('/api/coding/v1.4/status');
    expect(status.body.authorizationMode).toBe('legacy-agent-compat');
    expect(status.body.ready).toBe(true);
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${approvalSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(202);
  });

  it('requires data-key, result-store and dispatch readiness before accepting new work', async () => {
    const store = { create: vi.fn(), getJob: vi.fn(), requestCancel: vi.fn() };
    const missingDataKey = { ...env, ORIGIN_CODING_JOB_DATA_KEY: '' };
    const noKey = appFor(store, defaultDispatch(), missingDataKey);
    expect((await request(noKey.app).get('/api/coding/v1.4/status')).body.dataKeyReady).toBe(false);
    expect((await request(noKey.app).post('/api/coding/v1.4/jobs').set('Authorization', `Bearer ${codingSecret}`).send({ goal: 'fix it', confirmRun: true })).status).toBe(503);

    const noResults = appFor(store, defaultDispatch(), env, null);
    const noResultsStatus = await request(noResults.app).get('/api/coding/v1.4/status');
    expect(noResultsStatus.body.resultStoreReady).toBe(false);
    expect((await request(noResults.app).post('/api/coding/v1.4/jobs').set('Authorization', `Bearer ${codingSecret}`).send({ goal: 'fix it', confirmRun: true })).status).toBe(503);
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
      .set('Authorization', `Bearer ${codingSecret}`)
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
      requestCancel: vi.fn(async (_jobId: string, _ownerHash: string) => ({ ...publicRecord(jobId), status: 'cancelled' as const, cancelRequested: true, resultCode: 'CODING_CANCELLED_BY_USER' })),
    };
    const { app, resultStore } = appFor(store, vi.fn(async () => { throw new Error('unavailable'); }));
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${codingSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CODING_JOB_DISPATCH_UNAVAILABLE');
    expect(store.requestCancel).toHaveBeenCalledTimes(1);
    expect(store.requestCancel.mock.calls[0][0]).toBe(jobId);
    expect(store.requestCancel.mock.calls[0][1]).toMatch(/^[0-9a-f]{64}$/);
    expect(resultStore.delete).toHaveBeenCalledWith(jobId);
  });

  it('returns a safe dispatch reason while keeping the cancelled row cleanup', async () => {
    let jobId = '';
    const store = {
      create: vi.fn(async (envelope: any) => {
        jobId = envelope.jobId;
        return publicRecord(envelope.jobId);
      }),
      getJob: vi.fn(),
      requestCancel: vi.fn(async () => ({ ...publicRecord(jobId), status: 'cancelled' as const, cancelRequested: true, resultCode: 'CODING_CANCELLED_BY_USER' })),
    };
    const { app } = appFor(store, vi.fn(async () => { throw new Error('CODING_DISPATCH_PERMISSION_DENIED'); }));
    const response = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${codingSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CODING_JOB_DISPATCH_PERMISSION_DENIED');
    expect(response.body).not.toHaveProperty('message');
  });

  it('keeps status and cancellation owner-scoped and erases terminal cancelled evidence', async () => {
    const knownId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';
    const record = publicRecord(knownId);
    const store = {
      create: vi.fn(),
      getJob: vi.fn(async (_jobId: string, ownerHash: string) => ownerHash ? record : null),
      requestCancel: vi.fn(async (_jobId: string, ownerHash: string) => ownerHash ? { ...record, status: 'cancelled' as const, cancelRequested: true, resultCode: 'CODING_CANCELLED_BY_USER' } : null),
    };
    const { app, resultStore } = appFor(store);
    const status = await request(app).get(`/api/coding/v1.4/jobs/${knownId}`).set('Authorization', `Bearer ${codingSecret}`);
    expect(status.status).toBe(200);
    expect(store.getJob.mock.calls[0][1]).toMatch(/^[0-9a-f]{64}$/);

    const cancelled = await request(app).delete(`/api/coding/v1.4/jobs/${knownId}`).set('Authorization', `Bearer ${codingSecret}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.job.status).toBe('cancelled');
    expect(cancelled.body.resultDetailsState).toBe('not_applicable');
    expect(store.requestCancel.mock.calls[0][1]).toBe(store.getJob.mock.calls[0][1]);
    expect(resultStore.delete).toHaveBeenCalledWith(knownId);
  });
});
