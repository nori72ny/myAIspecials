import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentOrchestratorV3Router } from './agentOrchestratorV3.js';
import { clearAgentRunsForTest } from './agentRunRegistry.js';

describe('agent orchestrator v3', () => {
  beforeEach(() => clearAgentRunsForTest());

  it('creates a bounded zero-cost plan-bound run without returning the raw goal', async () => {
    const app = express();
    app.use(express.json());
    app.use(createAgentOrchestratorV3Router());
    const goal = '顧客情報を含む安全な計画';
    const response = await request(app).post('/api/agent/v3/plan').send({ goal });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ ok: true, protocolVersion: 3, status: 'awaiting_approval', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    expect(response.body.runId).toMatch(/^run-/);
    expect(JSON.stringify(response.body)).not.toContain(goal);
  });

  it('fails closed when v3 execution is not authenticated', async () => {
    const app = express();
    app.use(express.json());
    app.use(createAgentOrchestratorV3Router());
    const response = await request(app).post('/api/agent/v3/execute').send({ runId: 'run-12345678', toolName: 'document_generator', params: {}, approvalToken: 'x' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
  });
});
