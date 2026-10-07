import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
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
  const operation = { action: 'execute' as const, runId: 'run-replay-test', toolName: 'repository_explorer' as const, params: {} };
  const execute = (app: express.Express) => request(app).post('/api/agent/v3/execute')
    .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
    .send({ ...operation, approvalToken: issueApprovalCapability(operation.runId, approvalDigest(operation), env).token });

  const cancel = (app: express.Express, runId = operation.runId) => request(app).post('/api/agent/v3/cancel')
    .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
    .send({ runId, planToken: issuePlanCapability(runId, 'a'.repeat(64), env).token });

  it.each(['Repair this code.', 'このTypeScriptコードのバグを分析して'])(
    'refuses unavailable code execution during planning without creating an approval capability: %s', async goal => {
      const response = await request(appFor(env, { consume: async () => true }))
        .post('/api/agent/v3/plan').send({ goal });
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ ok: false, code: 'AGENT_CODE_GENERATION_UNAVAILABLE', protocolVersion: 3 });
      expect(response.body.runId).toBeUndefined();
      expect(response.body.planToken).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(goal);
    },
  );

  it.each([
    ['document_generator', { content: '商品A:1200円×3個、商品B:800円×2個。売上合計と提案を作成してください。' }],
  ] as const)('does not certify an echoed %s artifact as completed', async (toolName, params) => {
    const app = appFor(env, { consume: async () => true });
    const goal = 'Create a sales report.';
    const plan = await request(app).post('/api/agent/v3/plan').send({ goal });
    expect(plan.status).toBe(201);
    const approval = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.body.runId, planToken: plan.body.planToken, toolName, params });
    expect(approval.status).toBe(201);
    const result = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.body.runId, approvalToken: approval.body.approvalToken, toolName, params });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ARTIFACT_VERIFICATION_FAILED');
    expect(result.body.status).not.toBe('completed');
    expect(result.body.artifact).toBeUndefined();
    expect(result.body.checkpoint).toBeUndefined();
  });

  it('reports readiness and legacy credential compatibility truthfully', async () => {
    const store: AgentRunConsumptionStore = { consume: async () => true };
    const ready = await request(appFor(env, store)).get('/api/agent/v3/status');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      ok: true,
      protocolVersion: 3,
      ready: true,
      readinessScope: 'authorization-and-replay-protection',
      unavailableTools: ['code_interpreter', 'document_generator'],
      documentGeneration: { configured: false, format: 'markdown', liveVerified: false },
      artifactVerificationScope: 'structural-preflight-only',
      taskQualityQualification: 'not-measured',
      approvalSigningConfigured: true,
      operatorAuthenticationConfigured: true,
      authorizationMode: 'legacy-approval-compat',
      credentialSeparationConfigured: false,
      replayProtectionConfigured: true,
      replayProtection: 'shared-atomic',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'legacy-shared-credential',
    });
    expect(JSON.stringify(ready.body)).not.toContain(env.ORIGIN_AGENT_APPROVAL_SECRET);

    const unavailable = await request(appFor({})).get('/api/agent/v3/status');
    expect(unavailable.body).toMatchObject({
      ready: false,
      approvalSigningConfigured: false,
      operatorAuthenticationConfigured: false,
      authorizationMode: 'unconfigured',
      credentialSeparationConfigured: false,
      replayProtectionConfigured: false,
      replayProtection: 'unavailable',
      secretDelivery: 'unavailable',
    });
  });

  it('uses a dedicated operator credential without exposing or accepting the signing key', async () => {
    const dedicatedEnv = {
      ORIGIN_AGENT_APPROVAL_SECRET: 's'.repeat(48),
      ORIGIN_AGENT_OPERATOR_SECRET: 'o'.repeat(48),
    };
    const store: AgentRunConsumptionStore = { consume: async () => true };
    const app = appFor(dedicatedEnv, store);

    const status = await request(app).get('/api/agent/v3/status');
    expect(status.body).toMatchObject({
      ready: true,
      approvalSigningConfigured: true,
      operatorAuthenticationConfigured: true,
      authorizationMode: 'agent-operator',
      credentialSeparationConfigured: true,
      secretDelivery: 'signing-secret-server-only',
    });
    expect(JSON.stringify(status.body)).not.toContain(dedicatedEnv.ORIGIN_AGENT_APPROVAL_SECRET);
    expect(JSON.stringify(status.body)).not.toContain(dedicatedEnv.ORIGIN_AGENT_OPERATOR_SECRET);

    const signingKeyRejected = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${dedicatedEnv.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: 'bad', toolName: 'document_generator', params: {}, approvalToken: 'x' });
    expect(signingKeyRejected.status).toBe(401);
    expect(signingKeyRejected.body.code).toBe('AGENT_AUTHENTICATION_REQUIRED');

    const operatorAccepted = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${dedicatedEnv.ORIGIN_AGENT_OPERATOR_SECRET}`)
      .send({ runId: 'bad', toolName: 'document_generator', params: {}, approvalToken: 'x' });
    expect(operatorAccepted.status).toBe(400);
    expect(operatorAccepted.body.code).toBe('INVALID_AGENT_RUN_ID');
  });

  it('fails closed when a present dedicated operator credential is malformed', async () => {
    const malformed = {
      ORIGIN_AGENT_APPROVAL_SECRET: 's'.repeat(48),
      ORIGIN_AGENT_OPERATOR_SECRET: 'short',
    };
    const store: AgentRunConsumptionStore = { consume: async () => true };
    const app = appFor(malformed, store);
    const status = await request(app).get('/api/agent/v3/status');
    expect(status.body).toMatchObject({
      ready: false,
      approvalSigningConfigured: true,
      operatorAuthenticationConfigured: false,
      authorizationMode: 'unconfigured',
      credentialSeparationConfigured: false,
    });

    const response = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${malformed.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: operation.runId, toolName: operation.toolName, params: operation.params, approvalToken: 'x' });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('AGENT_OPERATOR_AUTH_NOT_CONFIGURED');
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

  it.each(['before-approval', 'after-approval'] as const)(
    'retains cancellation beyond plan expiry when cancelled %s', async cancelTiming => {
      let now = 1_800_000_000_000;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        const reservations = new Map<string, number>();
        const store: AgentRunConsumptionStore = { consume: async (runId, expiresAt) => {
          if ((reservations.get(runId) ?? 0) > now) return false;
          reservations.set(runId, expiresAt);
          return true;
        } };
        const first = appFor(env, store);
        const second = appFor(env, store);
        const planned = await request(first).post('/api/agent/v3/plan').send({ goal: 'Inspect repository structure' });
        expect(planned.status).toBe(201);
        const { runId, planToken } = planned.body;
        const cancelPlanned = () => request(first).post('/api/agent/v3/cancel')
          .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
          .send({ runId, planToken });
        if (cancelTiming === 'before-approval') expect((await cancelPlanned()).status).toBe(200);

        // An approval legitimately issued just before plan expiry remains valid
        // for another two minutes. The shared store models real TTL expiration.
        now = Date.parse(planned.body.expiresAt) - 1_000;
        const approved = await request(second).post('/api/agent/v3/approval')
          .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
          .send({ runId, planToken, toolName: operation.toolName, params: operation.params });
        expect(approved.status).toBe(201);
        if (cancelTiming === 'after-approval') expect((await cancelPlanned()).status).toBe(200);

        now = Date.parse(planned.body.expiresAt) + 1_000;
        expect(Date.parse(approved.body.expiresAt)).toBeGreaterThan(now);
        const executed = await request(second).post('/api/agent/v3/execute')
          .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
          .send({ ...operation, runId, approvalToken: approved.body.approvalToken });
        expect(executed.status).toBe(409);
        expect(executed.body.code).toBe('AGENT_RUN_ALREADY_CONSUMED');
      } finally {
        clock.mockRestore();
      }
    },
  );

  it('fails cancellation closed when the shared store errors without leaking storage details', async () => {
    const response = await cancel(appFor(env, {
      consume: async () => { throw new Error('private cancellation storage details'); },
    }));
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('AGENT_REPLAY_PROTECTION_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('private cancellation storage details');
  });

  it('creates a bounded zero-cost stateless plan with a deterministic signed tool choice', async () => {
    const goal = '営業提案書を作成して';
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
      selectedTool: 'document_generator',
      toolChoice: { source: 'deterministic-local', reasonCode: 'document-request' },
    });
    expect(response.body.runId).toMatch(/^run-/);
    expect(response.body.planToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(response.body)).not.toContain(goal);
  });

  it('fails closed when one goal requires multiple tools instead of pretending one tool can finish it', async () => {
    const response = await request(appFor()).post('/api/agent/v3/plan')
      .send({ goal: '最新市場を調べて、その結果から提案書を作って' });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ ok: false, code: 'AGENT_MULTI_TOOL_PLAN_REQUIRED', protocolVersion: 3 });
  });

  it('cryptographically binds approval to the tool selected by the plan', async () => {
    const store: AgentRunConsumptionStore = { consume: async () => true };
    const app = appFor(env, store);
    const planned = await request(app).post('/api/agent/v3/plan').send({ goal: '営業提案書を作成して' });
    expect(planned.status).toBe(201);

    const mismatch = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({
        runId: planned.body.runId,
        planToken: planned.body.planToken,
        toolName: 'code_interpreter',
        params: { code: 'const value = 1' },
      });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.code).toBe('AGENT_PLAN_TOOL_MISMATCH');

    const approved = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({
        runId: planned.body.runId,
        planToken: planned.body.planToken,
        toolName: 'document_generator',
        params: { content: 'Harmless audit document' },
      });
    expect(approved.status).toBe(201);
    expect(approved.body.scope).toBe('exact-operation');
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
