import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { approvalDigest } from './agentApproval.js';
import { issueApprovalCapability, issuePlanCapability } from './agentV3Capability.js';
import type { AgentCodingBridgeV3 } from './agentCodingBridgeV3.js';

const env = { ORIGIN_AGENT_APPROVAL_SECRET: 'x'.repeat(40) };

function appFor(testEnv: NodeJS.ProcessEnv = env, store?: AgentRunConsumptionStore, codingBridge?: AgentCodingBridgeV3) {
  const app = express();
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(testEnv, store, codingBridge));
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

  it('requires separated operator authentication and an exact existing Coding job for recovery', async () => {
    const operatorEnv = { ORIGIN_AGENT_APPROVAL_SECRET: 'a'.repeat(48),
      ORIGIN_AGENT_OPERATOR_SECRET: 'b'.repeat(48) };
    const recover = vi.fn(async (runId: string, jobId: string) => ({
      ok: true as const, runId, jobId, status: 'running' as const,
      bridgeToken: 'fresh-run-bound-token', expiresAt: new Date(Date.now() + 50_000).toISOString(),
      freeOnly: true as const, costUsd: 0 as const, paidFallbackUsed: false as const,
    }));
    const bridge = { recover } as unknown as AgentCodingBridgeV3;
    const query = { runId: 'run-recovery-test', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA' };
    const app = appFor(operatorEnv, undefined, bridge);
    const unauthenticated = await request(app).post('/api/agent/v3/coding/recover').send(query);
    expect(unauthenticated.status).toBe(401);
    const signingSecret = await request(app).post('/api/agent/v3/coding/recover')
      .set('Authorization', `Bearer ${operatorEnv.ORIGIN_AGENT_APPROVAL_SECRET}`).send(query);
    expect(signingSecret.status).toBe(401);
    const malformed = await request(app).post('/api/agent/v3/coding/recover')
      .set('Authorization', `Bearer ${operatorEnv.ORIGIN_AGENT_OPERATOR_SECRET}`)
      .send({ runId: 'run-../bad', jobId: query.jobId });
    expect(malformed.status).toBe(400);
    expect(recover).not.toHaveBeenCalled();
    const success = await request(app).post('/api/agent/v3/coding/recover')
      .set('Authorization', `Bearer ${operatorEnv.ORIGIN_AGENT_OPERATOR_SECRET}`).send(query);
    expect(success.status).toBe(200);
    expect(success.body).toMatchObject({ ...query, status: 'running', ok: true, paidFallbackUsed: false });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith(query.runId, query.jobId);
    const noSeparation = await request(appFor(env, undefined, bridge)).post('/api/agent/v3/coding/recover')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`).send(query);
    expect(noSeparation.status).toBe(503);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('does not certify an echoed document artifact as completed', async () => {
    const app = appFor(env, { consume: async () => true });
    const goal = 'Create a sales report.';
    const toolName = 'document_generator';
    const params = { content: '商品A:1200円×3個、商品B:800円×2個。売上合計と提案を作成してください。' };
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
  });

  it('binds coding approval to the original planned goal and reports dispatch as running', async () => {
    const start = vi.fn(async (runId: string) => ({
      ok: true as const,
      runId,
      jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
      status: 'running' as const,
      bridgeToken: 'bridge-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      freeOnly: true as const,
      costUsd: 0 as const,
      paidFallbackUsed: false as const,
    }));
    const poll = vi.fn(async (runId: string, jobId: string) => ({
      ok: true as const,
      runId,
      jobId,
      status: 'running' as const,
      codingStatus: 'running' as const,
      verified: false as const,
      resultCode: null,
      freeOnly: true as const,
      costUsd: 0 as const,
      paidFallbackUsed: false as const,
    }));
    const bridge = { start, poll } as unknown as AgentCodingBridgeV3;
    const app = appFor(env, { consume: async () => true }, bridge);
    const status = await request(app).get('/api/agent/v3/status');
    expect(status.body.codingBridgeConfigured).toBe(true);
    const goal = 'Repair this code bug.';
    const plan = await request(app).post('/api/agent/v3/plan').send({ goal });
    expect(plan.status).toBe(201);
    expect(plan.body.selectedTool).toBe('code_interpreter');

    const mismatch = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({
        runId: plan.body.runId,
        planToken: plan.body.planToken,
        toolName: 'code_interpreter',
        params: { goal: 'Do a different coding task.' },
      });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.code).toBe('AGENT_PLAN_GOAL_MISMATCH');

    const params = { goal };
    const approval = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.body.runId, planToken: plan.body.planToken, toolName: 'code_interpreter', params });
    expect(approval.status).toBe(201);

    const executeResult = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({
        runId: plan.body.runId,
        approvalToken: approval.body.approvalToken,
        toolName: 'code_interpreter',
        params,
      });
    expect(executeResult.status).toBe(202);
    expect(executeResult.body).toMatchObject({
      ok: true,
      status: 'running',
      jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
      costUsd: 0,
      paidFallbackUsed: false,
    });
    expect(executeResult.body.status).not.toBe('completed');
    expect(start).toHaveBeenCalledWith(plan.body.runId, goal);
  });

  it('uses the exact bridge capability for polling and never infers completion', async () => {
    const poll = vi.fn(async (runId: string, jobId: string, bridgeToken: string) => ({
      ok: true as const,
      runId,
      jobId,
      status: 'running' as const,
      codingStatus: 'repairing' as const,
      verified: false as const,
      resultCode: null,
      freeOnly: true as const,
      costUsd: 0 as const,
      paidFallbackUsed: false as const,
    }));
    const bridge = { start: vi.fn(), poll } as unknown as AgentCodingBridgeV3;
    const app = appFor(env, { consume: async () => true }, bridge);

    const missingCapability = await request(app).post('/api/agent/v3/coding/status')
      .send({ runId: 'run-coding-status', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA' });
    expect(missingCapability.status).toBe(403);
    expect(missingCapability.body.code).toBe('AGENT_CODING_BRIDGE_TOKEN_REQUIRED');
    expect(poll).not.toHaveBeenCalled();

    const crossOrigin = await request(app).post('/api/agent/v3/coding/status')
      .set('Origin', 'https://attacker.example')
      .send({ runId: 'run-coding-status', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA', bridgeToken: 'bound-token' });
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.body.code).toBe('CROSS_ORIGIN_REQUEST_BLOCKED');
    expect(poll).not.toHaveBeenCalled();

    const response = await request(app).post('/api/agent/v3/coding/status')
      .send({ runId: 'run-coding-status', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA', bridgeToken: 'bound-token' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'running', verified: false, codingStatus: 'repairing' });
    expect(poll).toHaveBeenCalledWith('run-coding-status', 'coding-AAAAAAAAAAAAAAAAAAAAAA', 'bound-token');
  });

  it('reports readiness and legacy credential compatibility truthfully', async () => {
    const store: AgentRunConsumptionStore = { consume: async () => true };
    const ready = await request(appFor(env, store)).get('/api/agent/v3/status');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      ok: true,
      protocolVersion: 3,
      ready: true,
      approvalSigningConfigured: true,
      operatorAuthenticationConfigured: true,
      authorizationMode: 'legacy-approval-compat',
      credentialSeparationConfigured: false,
      replayProtectionConfigured: true,
      replayProtection: 'shared-atomic',
      codingBridgeConfigured: false,
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
      codingBridgeConfigured: false,
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
  it('fails at plan time when coding execution is unavailable', async () => {
    const response = await request(appFor(env, { consume: async () => true }))
      .post('/api/agent/v3/plan')
      .send({ goal: 'Repair this TypeScript bug.' });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      code: 'AGENT_CODE_GENERATION_UNAVAILABLE',
      protocolVersion: 3,
    });
  });

  it('propagates coding cancellation through the exact bridge capability', async () => {
    const cancelCoding = vi.fn(async (runId: string, jobId: string, bridgeToken: string) => ({
      ok: true as const,
      runId,
      jobId,
      status: 'cancelling' as const,
      codingStatus: 'running' as const,
      cancelRequested: true as const,
      freeOnly: true as const,
      costUsd: 0 as const,
      paidFallbackUsed: false as const,
    }));
    const bridge = {
      start: vi.fn(),
      poll: vi.fn(),
      cancel: cancelCoding,
    } as unknown as AgentCodingBridgeV3;
    const app = appFor(env, { consume: async () => true }, bridge);

    const missingCapability = await request(app).post('/api/agent/v3/coding/cancel')
      .send({ runId: 'run-cancel-code', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA' });
    expect(missingCapability.status).toBe(403);
    expect(missingCapability.body.code).toBe('AGENT_CODING_BRIDGE_TOKEN_REQUIRED');
    expect(cancelCoding).not.toHaveBeenCalled();

    const response = await request(app).post('/api/agent/v3/coding/cancel')
      .send({ runId: 'run-cancel-code', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA', bridgeToken: 'bound-token' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'cancelling',
      codingStatus: 'running',
      cancelRequested: true,
      costUsd: 0,
      paidFallbackUsed: false,
    });
    expect(cancelCoding).toHaveBeenCalledWith('run-cancel-code', 'coding-AAAAAAAAAAAAAAAAAAAAAA', 'bound-token');
  });

});
