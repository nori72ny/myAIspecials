// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../legacy/originProviderClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../legacy/originProviderClient.js')>();
  return { ...actual, executeOriginProvider: vi.fn() };
});
import { executeOriginProvider } from '../legacy/originProviderClient.js';
import { createAgentOrchestratorV3Router } from './agentOrchestratorV3.js';
import { DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, ORIGIN_OPENROUTER_FREE_MODEL } from '../lib/orchestration/OriginExecutionPolicy.js';
const env = { ORIGIN_AGENT_APPROVAL_SECRET: 's'.repeat(40), ORIGIN_AGENT_OPERATOR_SECRET: 'o'.repeat(40), ORIGIN_AGENT_DOCUMENT_GENERATION_ENABLED: 'true', OPENROUTER_API_KEY: 'unit-test-only' };
const content = '売上レポートを作成してください。Aは1200円を3個、Bは800円を2個。';
const draft = '# 売上レポート\n\nA: 3600円\nB: 1600円\n合計: 5200円';
function appFor() {
  const seen = new Set<string>();
  const app = express(); app.use(express.json());
  app.use(createAgentOrchestratorV3Router(env, { consume: async id => { if (seen.has(id)) return false; seen.add(id); return true; } }));
  return app;
}
describe('document generation HTTP integration with a stubbed provider', () => {
  beforeEach(() => {
    vi.mocked(executeOriginProvider).mockReset();
    vi.mocked(executeOriginProvider).mockResolvedValue({ text: draft, actualCostUsd: 0, usage: { costUsd: 0 }, providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, provider: 'OpenRouter', strategy: 'adaptive-primary', attempt: 1, fallbackUsed: false } });
  });
  async function planned(app: express.Express) {
    const plan = await request(app).post('/api/agent/v3/plan').send({ goal: 'Create a sales report.' });
    expect(plan.status).toBe(201);
    const operation = { runId: plan.body.runId, toolName: 'document_generator', params: { content, format: 'markdown' } };
    const approval = await request(app).post('/api/agent/v3/approval').set('Authorization', `Bearer ${env.ORIGIN_AGENT_OPERATOR_SECRET}`).send({ ...operation, planToken: plan.body.planToken });
    expect(approval.status).toBe(201);
    return { ...operation, approvalToken: approval.body.approvalToken };
  }
  it('passes the explicitly configured environment through the exact approved operation', async () => {
    const app = appFor(); const body = await planned(app);
    const result = await request(app).post('/api/agent/v3/execute').set('Authorization', `Bearer ${env.ORIGIN_AGENT_OPERATOR_SECRET}`).send(body);
    expect(result.status).toBe(200);
    expect(result.body.artifact).toBe(draft);
    expect(result.body.checkpoint.artifact).toBe(draft);
    expect(executeOriginProvider).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.body)).not.toContain(env.OPENROUTER_API_KEY);
    const replay = await request(app).post('/api/agent/v3/execute').set('Authorization', `Bearer ${env.ORIGIN_AGENT_OPERATOR_SECRET}`).send(body);
    expect(replay.status).toBe(409);
    expect(executeOriginProvider).toHaveBeenCalledTimes(1);
  });
  it('never starts inference with invalid approval', async () => {
    const app = appFor(); const body = await planned(app);
    const result = await request(app).post('/api/agent/v3/execute').set('Authorization', `Bearer ${env.ORIGIN_AGENT_OPERATOR_SECRET}`).send({ ...body, approvalToken: 'invalid' });
    expect(result.status).toBe(403);
    expect(executeOriginProvider).not.toHaveBeenCalled();
  });
  it('does not report failed inference as completed or attempt a recovery request', async () => {
    vi.mocked(executeOriginProvider).mockRejectedValue(new Error('provider timeout'));
    const app = appFor(); const body = await planned(app);
    const result = await request(app).post('/api/agent/v3/execute').set('Authorization', `Bearer ${env.ORIGIN_AGENT_OPERATOR_SECRET}`).send(body);
    expect(result.status).toBe(422);
    expect(result.body.artifact).toBeUndefined();
    expect(result.body.status).not.toBe('completed');
    expect(executeOriginProvider).toHaveBeenCalledTimes(1);
  });
  it('distinguishes configured drafting from live verification', async () => {
    const status = await request(appFor()).get('/api/agent/v3/status');
    expect(status.body.documentGeneration).toEqual({ configured: true, format: 'markdown', liveVerified: false });
    expect(status.body.unavailableTools).not.toContain('document_generator');
    expect(status.body.taskQualityQualification).toBe('not-measured');
  });
});
