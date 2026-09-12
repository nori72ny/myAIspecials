// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  CODING_SMOKE_CREATED_CONTENT_V14,
  CODING_SMOKE_CREATED_PATH_V14,
  CODING_SMOKE_GOAL_V14,
  createCodingJobSmokeV14Router,
} from './codingJobSmokeRouterV14.js';

const releaseSha = 'a'.repeat(40);
const operatorSecret = 'c'.repeat(48);
const env = {
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: releaseSha,
  ORIGIN_CODING_OPERATOR_SECRET: operatorSecret,
};
const oidc = { sha: releaseSha, runId: '34699999999' };

function appFor(internalFetch: typeof fetch, verifyOidc = vi.fn(async () => oidc)) {
  const app = express();
  app.use(express.json());
  app.use(createCodingJobSmokeV14Router(env, {
    internalFetch,
    verifyOidc,
    productionOrigin: 'https://origin.test',
  }));
  return { app, verifyOidc };
}

describe('V1.4 production coding smoke router', () => {
  it('submits only the server-fixed bounded smoke goal through the normal Coding API', async () => {
    const internalFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe('https://origin.test/api/coding/v1.4/jobs');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${operatorSecret}`);
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ goal: CODING_SMOKE_GOAL_V14, confirmRun: true, ttlMinutes: 60 });
      expect(body.goal).toContain(CODING_SMOKE_CREATED_PATH_V14);
      expect(body.goal).toContain(CODING_SMOKE_CREATED_CONTENT_V14.trim());
      return new Response(JSON.stringify({
        ok: true,
        job: { jobId: 'coding-abcdefghijklmnopqrstuv', status: 'queued' },
        resultDetailsState: 'pending',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      }), { status: 202, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const { app } = appFor(internalFetch);
    const response = await request(app)
      .post('/api/coding/v1.4/smoke')
      .set('authorization', 'Bearer github-oidc-token')
      .send({ confirmSmoke: true, releaseSha });
    expect(response.status).toBe(202);
    expect(response.body.ok).toBe(true);
    expect(response.body.releaseSha).toBe(releaseSha);
    expect(response.body.job.jobId).toBe('coding-abcdefghijklmnopqrstuv');
    expect(JSON.stringify(response.body)).not.toContain(operatorSecret);
  });

  it('rejects stale release requests before any internal Coding call', async () => {
    const internalFetch = vi.fn() as unknown as typeof fetch;
    const verifyOidc = vi.fn(async () => oidc);
    const { app } = appFor(internalFetch, verifyOidc);
    const response = await request(app)
      .post('/api/coding/v1.4/smoke')
      .set('authorization', 'Bearer github-oidc-token')
      .send({ confirmSmoke: true, releaseSha: 'b'.repeat(40) });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CODING_SMOKE_RELEASE_MISMATCH');
    expect(verifyOidc).not.toHaveBeenCalled();
    expect(internalFetch).not.toHaveBeenCalled();
  });

  it('requires the signed GitHub smoke identity and never falls back to the operator bearer', async () => {
    const internalFetch = vi.fn() as unknown as typeof fetch;
    const { app } = appFor(internalFetch, vi.fn(async () => null));
    const response = await request(app)
      .post('/api/coding/v1.4/smoke')
      .set('authorization', `Bearer ${operatorSecret}`)
      .send({ confirmSmoke: true, releaseSha });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('CODING_SMOKE_AUTHENTICATION_REQUIRED');
    expect(internalFetch).not.toHaveBeenCalled();
  });

  it('proxies only owner-scoped result evidence for a valid smoke job', async () => {
    const jobId = 'coding-abcdefghijklmnopqrstuv';
    const internalFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe(`https://origin.test/api/coding/v1.4/jobs/${jobId}`);
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${operatorSecret}`);
      return new Response(JSON.stringify({
        ok: true,
        job: { jobId, status: 'verified', changedPaths: [CODING_SMOKE_CREATED_PATH_V14] },
        result: {
          schemaVersion: 1,
          sessionStatus: 'verified',
          repairRounds: 0,
          diffs: [{ path: CODING_SMOKE_CREATED_PATH_V14, kind: 'created', before: null, after: CODING_SMOKE_CREATED_CONTENT_V14, beforeTruncated: false, afterTruncated: false, previewAvailable: true }],
          verificationChecks: ['typecheck', 'lint', 'test', 'build'].map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false, attempt: 0 })),
          freeOnly: true,
          costUsd: 0,
          gitPublished: false,
          deployed: false,
        },
        resultDetailsState: 'available',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const { app } = appFor(internalFetch);
    const response = await request(app)
      .get(`/api/coding/v1.4/smoke/${jobId}?releaseSha=${releaseSha}`)
      .set('authorization', 'Bearer github-oidc-token');
    expect(response.status).toBe(200);
    expect(response.body.result.sessionStatus).toBe('verified');
    expect(response.body.result.verificationChecks).toHaveLength(4);
    expect(JSON.stringify(response.body)).not.toContain(operatorSecret);
  });
});
