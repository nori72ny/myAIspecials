import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { approvalDigest } from './agentApproval.js';
import { issueApprovalCapability, issuePlanCapability } from './agentV3Capability.js';

const env = { ORIGIN_AGENT_APPROVAL_SECRET: 'x'.repeat(40) };

function appFor(testEnv: NodeJS.ProcessEnv = env, store?: AgentRunConsumptionStore) {
  const app = express();
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(testEnv, store));
  return app;
}

describe('agent orchestrator v3', () => {
  const operation = { action: 'execute' as const, runId: 'run-replay-test', toolName: 'document_generator' as const, params: { content: 'Harmless audit document' } };
  const execute = (app: express.Express) => request(app).post('/api/agent/v3/execute')
    .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
    .send({ ...operation, approvalToken: issueApprovalCapability(operation.runId, approvalDigest(operation), env).token });

  const cancel = (app: express.Express, runId = operation.runId) => request(app).post('/api/agent/v3/cancel')
    .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
    .send({ runId, planToken: issuePlanCapability(runId, 'a'.repeat(64), env).token });

  it('reports readiness only when signing and shared replay protection are configured', async () => {
    const store: AgentRunConsumptionStore = { consume: async () => true };
    const ready = await request(appFor(env, store)).get('/api/agent/v3/status');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      ok: true,
      protocolVersion: 3,
      ready: true,
      approvalSigningConfigured: true,
      replayProtectionConfigured: true,
      replayProtection: 'shared-atomic',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });
    expect(JSON.stringify(ready.body)).not.toContain(env.ORIGIN_AGENT_APPROVAL_SECRET);

    const unavailable = await request(appFor({})).get('/api/agent/v3/status');
    expect(unavailable.body).toMatchObject({
      ready: false,
      approvalSigningConfigured: false,
      replayProtectionConfigured: false,
      replayProtection: 'unavailable',
    });
  });

  it('blocks execution without shared replay protection', async () => {
    const response = await execute(appFor());
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('AGENT_REPLAY_PROTECTION_UNAVAILABLE');
  });

  it('fails closed and hides storage errors', async () => {
    const response = await execute(appFor(env, { consume: async () => { throw new Error('private infrastructure details'); } }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private infrastructure');
  });

  it('allows only one execution across concurrent router instances and later retries', async () => {
    const used = new Set<string>();
    const store: AgentRunConsumptionStore = { consume: async (runId, expiresAt) => {
      expect(expiresAt).toBeGreaterThan(Date.now());
      if (used.has(runId)) return false;
      used.add(runId);
      return true;
    } };
    const first = appFor(env, store);
    const second = appFor(env, store);
    const responses = await Promise.all([execute(first), execute(second)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await execute(second)).status).toBe(409);
  });

  it('cancels a planned run atomically across instances and blocks all later execution', async () => {
    const used = new Set<string>();
    const store: AgentRunConsumptionStore = { consume: async (runId, expiresAt) => {
      expect(expiresAt).toBeGreaterThan(Date.now());
      if (used.has(runId)) return false;
      used.add(runId);
      return true;
    } };
    const first = appFor(env, store);
    const second = appFor(env, store);

    const cancelled = await cancel(first);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({
      ok: true,
      protocolVersion: 3,
      runId: operation.runId,
      status: 'cancelled',
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      cancellation: 'shared-atomic',
    });

    const laterExecute = await execute(second);
    expect(laterExecute.status).toBe(409);
    expect(laterExecute.body.code).toBe('AGENT_RUN_ALREADY_CONSUMED');

    const repeatedCancel = await cancel(second);
    expect(repeatedCancel.status).toBe(409);
    expect(repeatedCancel.body.code).toBe('AGENT_RUN_ALREADY_CONSUMED');
  });

  it('requires authentication, a matching plan capability, and shared replay storage for cancellation', async () => {
    const store: AgentRunConsumptionStore = { consume: async () => true };

    const unauthenticated = await request(appFor(env, store)).post('/api/agent/v3/cancel')
      .send({ runId: operation.runId, planToken: issuePlanCapability(operation.runId, 'a'.repeat(64), env).token });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe('AGENT_AUTHENTICATION_REQUIRED');

    const wrongRun = await request(appFor(env, store)).post('/api/agent/v3/cancel')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({
        runId: 'run-different-run',
        planToken: issuePlanCapability(operation.runId, 'a'.repeat(64), env).token,
      });
    expect(wrongRun.status).toBe(403);
    expect(wrongRun.body.code).toBe('AGENT_PLAN_CAPABILITY_INVALID');

    const unavailable = await cancel(appFor(env));
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('AGENT_REPLAY_PROTECTION_UNAVAILABLE');
  });

  it('fails cancellation closed when the shared store errors without leaking storage details', async () => {
    const response = await cancel(appFor(env, {
      consume: async () => { throw new Error('private cancellation storage details'); },
    }));
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('AGENT_REPLAY_PROTECTION_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('private cancellation storage details');
  });

  it('creates a bounded zero-cost stateless plan without returning the raw goal', async () => {
    const goal = '顧客情報を含む安全な計画';
    const response = await request(appFor()).post('/api/agent/v3/plan').send({ goal });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ ok: true, protocolVersion: 3, status: 'awaiting_approval', freeOnly: true, costUsd: 0, paidFallbackUsed: false, persistence: 'stateless-server-signed' });
    expect(response.body.runId).toMatch(/^run-/);
    expect(response.body.planToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(response.body)).not.toContain(goal);
  });

  it('fails closed when the signing secret is unavailable', async () => {
    const response = await request(appFor({})).post('/api/agent/v3/plan').send({ goal: 'safe task' });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
  });

  it('fails closed when v3 execution is not authenticated', async () => {
    const response = await request(appFor()).post('/api/agent/v3/execute').send({ runId: 'run-12345678', toolName: 'document_generator', params: {}, approvalToken: 'x' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
  });
});
