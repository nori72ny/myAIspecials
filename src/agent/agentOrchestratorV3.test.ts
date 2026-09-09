import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAgentOrchestratorV3Router } from './agentOrchestratorV3.js';

const SECRET = 'x'.repeat(40);
const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };

function appFor(testEnv: NodeJS.ProcessEnv = env) {
  const app = express();
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(testEnv));
  return app;
}

describe('agent orchestrator v3', () => {
  it('creates a bounded zero-cost stateless plan without returning the raw goal', async () => {
    const goal = '顧客情報を含む安全な計画';
    const response = await request(appFor()).post('/api/agent/v3/plan').send({ goal });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ok: true,
      protocolVersion: 3,
      status: 'awaiting_approval',
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      persistence: 'stateless-server-signed',
    });
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
