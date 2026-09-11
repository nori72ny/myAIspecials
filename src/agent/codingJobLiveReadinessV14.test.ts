// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createCodingJobV14Router } from './codingJobRouterV14.js';

const codingSecret = 'c'.repeat(48);
const env: NodeJS.ProcessEnv = {
  ORIGIN_CODING_OPERATOR_SECRET: codingSecret,
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 11).toString('base64'),
  ORIGIN_CODING_GITHUB_DISPATCH_TOKEN: 'g'.repeat(40),
  ORIGIN_CODING_WORKER_ENABLED: 'true',
};

function appFor(store: any, resultStore: any) {
  const app = express();
  app.use(express.json());
  const dispatch = vi.fn(async (jobId: string) => ({
    accepted: true as const,
    jobId,
    repository: 'nori72ny/myAIspecials' as const,
    workflow: 'coding-job-worker-v14.yml' as const,
    ref: 'main' as const,
  }));
  app.use(createCodingJobV14Router(env, store, dispatch, resultStore));
  return { app, dispatch };
}

describe('V1.4 live database readiness', () => {
  it('fails new work closed when the durable job schema cannot be queried', async () => {
    const store = {
      create: vi.fn(),
      getJob: vi.fn(async () => { throw new Error('relation origin_coding_jobs_v14 does not exist'); }),
      requestCancel: vi.fn(),
    };
    const resultStore = {
      get: vi.fn(async () => null),
      delete: vi.fn(async () => true),
    };
    const { app, dispatch } = appFor(store, resultStore);

    const status = await request(app).get('/api/coding/v1.4/status');
    expect(status.status).toBe(200);
    expect(status.body.storeConfigured).toBe(true);
    expect(status.body.resultStoreConfigured).toBe(true);
    expect(status.body.storeReady).toBe(false);
    expect(status.body.resultStoreReady).toBe(true);
    expect(status.body.databaseReady).toBe(false);
    expect(status.body.controlPlaneReady).toBe(false);
    expect(status.body.ready).toBe(false);
    expect(status.body.databaseProbe).toBe('live-schema-select');

    const create = await request(app).post('/api/coding/v1.4/jobs')
      .set('Authorization', `Bearer ${codingSecret}`)
      .send({ goal: 'fix the parser', confirmRun: true });
    expect(create.status).toBe(503);
    expect(create.body.code).toBe('CODING_JOB_API_NOT_READY');
    expect(store.create).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('requires the encrypted result schema to be live before accepting new work', async () => {
    const store = {
      create: vi.fn(),
      getJob: vi.fn(async () => null),
      requestCancel: vi.fn(),
    };
    const resultStore = {
      get: vi.fn(async () => { throw new Error('relation origin_coding_job_results_v14 does not exist'); }),
      delete: vi.fn(async () => true),
    };
    const { app } = appFor(store, resultStore);

    const status = await request(app).get('/api/coding/v1.4/status');
    expect(status.body.storeReady).toBe(true);
    expect(status.body.resultStoreReady).toBe(false);
    expect(status.body.databaseReady).toBe(false);
    expect(status.body.controlPlaneReady).toBe(true);
    expect(status.body.resultDetailsReady).toBe(false);
    expect(status.body.ready).toBe(false);
  });

  it('reports live database readiness only after both schema probes succeed', async () => {
    const store = {
      create: vi.fn(),
      getJob: vi.fn(async () => null),
      requestCancel: vi.fn(),
    };
    const resultStore = {
      get: vi.fn(async () => null),
      delete: vi.fn(async () => true),
    };
    const { app } = appFor(store, resultStore);

    const status = await request(app).get('/api/coding/v1.4/status');
    expect(status.body.databaseReady).toBe(true);
    expect(status.body.storeReady).toBe(true);
    expect(status.body.resultStoreReady).toBe(true);
    expect(status.body.controlPlaneReady).toBe(true);
    expect(status.body.ready).toBe(true);
    expect(store.getJob).toHaveBeenCalledWith('coding-0000000000000000000000', '0'.repeat(64));
    expect(resultStore.get).toHaveBeenCalledWith('coding-0000000000000000000000');
  });
});
