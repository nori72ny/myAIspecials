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

  it.each([
    ['code_interpreter', { code: 'function add(a,b) { return a + ; }' }],
    ['code_interpreter', { code: 'function add(a,b) { return a - b; }' }],
  ] as const)('does not certify an echoed %s artifact as completed', async (toolName, params) => {
    const app = appFor(env, { consume: async () => true });
    const goal = 'Repair this code.';
    const plan = await request(app).post('/api/agent/v3/plan').send({ goal });
    expect(plan.status).toBe(201);
    const approval = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.body.runId, planToken: plan.body.planToken, toolName, params: plan.body.params });
    expect(approval.status).toBe(201);
    const result = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.body.runId, approvalToken: approval.body.approvalToken, toolName, params: plan.body.params });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ARTIFACT_VERIFICATION_FAILED');
    expect(result.body.status).not.toBe('completed');
    expect(result.body.artifact).toBeUndefined();
    expect(result.body.checkpoint).toBeUndefined();
  });

  it('completes a document run with a real generated artifact, not an echo', async () => {
    const app = appFor(env, { consume: async () => true });
    const goal = 'Create a sales report.';
    const plan = await request(app).post('/api/agent/v3/plan').send({ goal });
    expect(plan.status).toBe(201);
    expect(plan.body.selectedTool).toBe('document_generator');
    const approval = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.body.runId, planToken: plan.body.planToken, toolName: 'document_generator', params: plan.body.params });
    expect(approval.status).toBe(201);
    const result = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.body.runId, approvalToken: approval.body.approvalToken, toolName: 'document_generator', params: plan.body.params });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('completed');
    const artifact = JSON.parse(result.body.artifact as string) as { kind?: string; verified?: boolean; sha256?: string; content?: string };
    expect(artifact.kind).toBe('document');
    expect(artifact.verified).toBe(true);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.content).not.toBe(goal);
    expect(result.body.checkpoint).toBeDefined();
  });

  it('reports readiness and legacy credential compatibility truthfully', async () => {
    const store: AgentRunConsumptionStore = { consume: async () => true };
    const app = appFor(env, store);
    // Unauthenticated callers receive readiness booleans only; the
    // configuration breakdown is not disclosed.
    const ready = await request(app).get('/api/agent/v3/status');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      ok: true,
      protocolVersion: 3,
      ready: true,
      approvalSigningConfigured: true,
      replayProtectionConfigured: true,
      browserApprovalEnabled: true,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
    });
    expect(JSON.stringify(ready.body)).not.toContain(env.ORIGIN_AGENT_APPROVAL_SECRET);

    // The operator-authenticated view keeps the full breakdown, including
    // the truthful legacy credential compatibility reporting.
    const detailed = await request(app).get('/api/agent/v3/status')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`);
    expect(detailed.status).toBe(200);
    expect(detailed.body).toEqual({
      ok: true,
      protocolVersion: 3,
      ready: true,
      approvalSigningConfigured: true,
      replayProtectionConfigured: true,
      browserApprovalEnabled: true,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      operatorAuthenticationConfigured: true,
      authorizationMode: 'legacy-approval-compat',
      credentialSeparationConfigured: false,
      replayProtection: 'shared-atomic',
      secretDelivery: 'legacy-shared-credential',
    });
    expect(JSON.stringify(detailed.body)).not.toContain(env.ORIGIN_AGENT_APPROVAL_SECRET);

    // A wrong credential receives the public shape, never the breakdown.
    const wrongCredential = await request(app).get('/api/agent/v3/status')
      .set('Authorization', `Bearer ${'x'.repeat(48)}`);
    expect(wrongCredential.body).toEqual(ready.body);

    const unavailable = await request(appFor({})).get('/api/agent/v3/status');
    expect(unavailable.body).toEqual({
      ok: true,
      protocolVersion: 3,
      ready: false,
      approvalSigningConfigured: false,
      replayProtectionConfigured: false,
      browserApprovalEnabled: false,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
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
    });
    expect(status.body).not.toHaveProperty('operatorAuthenticationConfigured');
    expect(status.body).not.toHaveProperty('authorizationMode');
    expect(status.body).not.toHaveProperty('credentialSeparationConfigured');
    expect(status.body).not.toHaveProperty('secretDelivery');
    expect(JSON.stringify(status.body)).not.toContain(dedicatedEnv.ORIGIN_AGENT_APPROVAL_SECRET);
    expect(JSON.stringify(status.body)).not.toContain(dedicatedEnv.ORIGIN_AGENT_OPERATOR_SECRET);

    // The signing key does not unlock the operator detail view either.
    const signingKeyDetail = await request(app).get('/api/agent/v3/status')
      .set('Authorization', `Bearer ${dedicatedEnv.ORIGIN_AGENT_APPROVAL_SECRET}`);
    expect(signingKeyDetail.body).not.toHaveProperty('authorizationMode');

    const detailed = await request(app).get('/api/agent/v3/status')
      .set('Authorization', `Bearer ${dedicatedEnv.ORIGIN_AGENT_OPERATOR_SECRET}`);
    expect(detailed.body).toMatchObject({
      ready: true,
      approvalSigningConfigured: true,
      operatorAuthenticationConfigured: true,
      authorizationMode: 'agent-operator',
      credentialSeparationConfigured: true,
      secretDelivery: 'signing-secret-server-only',
    });
    expect(JSON.stringify(detailed.body)).not.toContain(dedicatedEnv.ORIGIN_AGENT_APPROVAL_SECRET);
    expect(JSON.stringify(detailed.body)).not.toContain(dedicatedEnv.ORIGIN_AGENT_OPERATOR_SECRET);

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
      replayProtectionConfigured: true,
      browserApprovalEnabled: true,
    });
    expect(status.body).not.toHaveProperty('operatorAuthenticationConfigured');
    expect(status.body).not.toHaveProperty('authorizationMode');
    expect(status.body).not.toHaveProperty('credentialSeparationConfigured');
    // A malformed dedicated credential cannot authenticate the detail view.
    const detailAttempt = await request(app).get('/api/agent/v3/status')
      .set('Authorization', `Bearer ${malformed.ORIGIN_AGENT_OPERATOR_SECRET}`);
    expect(detailAttempt.body).not.toHaveProperty('authorizationMode');

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
    expect(response.body.params).toEqual({
      title: '営業提案書',
      format: 'markdown',
      brief: goal,
      outline: ['目的', '背景と課題', '提案内容', '期待効果', '実施計画'],
    });
  });

  it('returns structured web-search parameters and a default sales-table file without code fences', async () => {
    const app = appFor(env, { consume: async () => true });
    const research = await request(app).post('/api/agent/v3/plan').send({ goal: '最新のVercel料金を調べてください' });
    expect(research.status).toBe(201);
    expect(research.body.selectedTool).toBe('web_search_grounding');
    expect(research.body.params).toMatchObject({ query: expect.stringContaining('Vercel料金') });

    const table = await request(app).post('/api/agent/v3/plan').send({ goal: '簡単な売上表を作って' });
    expect(table.status).toBe(201);
    expect(table.body.selectedTool).toBe('file_writer');
    expect(table.body.params.path).toBe('artifacts/sales-table.csv');
    expect(table.body.params.content).toContain('日付,商品,数量,単価,売上');
    expect(table.body.params.content).toContain('=SUM(E2:E3)');
  });

  it('plans multiple tools in dependency order instead of rejecting a multi-tool goal', async () => {
    const response = await request(appFor()).post('/api/agent/v3/plan')
      .send({ goal: '最新市場を調べて、その結果から提案書を作って' });
    expect(response.status).toBe(201);
    expect(response.body.toolChoice).toMatchObject({ source: 'deterministic-local', mode: 'multi-step' });
    expect((response.body.steps as Array<{ toolName: string }>).map(step => step.toolName)).toEqual([
      'web_search_grounding',
      'document_generator',
    ]);
    expect(response.body.selectedTool).toBe('web_search_grounding');
  });

  it('treats a document-creation goal as one document step, not a document plus a file write', async () => {
    const response = await request(appFor()).post('/api/agent/v3/plan')
      .send({ goal: '週次報告書のドキュメントを作成してください' });
    expect(response.status).toBe(201);
    expect((response.body.steps as Array<{ toolName: string }>).map(step => step.toolName)).toEqual(['document_generator']);
    expect(response.body.params).toMatchObject({ title: '週次報告書のドキュメント', format: 'markdown' });
  });

  it('generates structured code parameters instead of copying the goal into a code field', async () => {
    const response = await request(appFor()).post('/api/agent/v3/plan')
      .send({ goal: 'PythonでCSVを集計するコードを実行してください' });
    expect(response.status).toBe(201);
    expect(response.body.selectedTool).toBe('code_interpreter');
    expect(response.body.params).toEqual({
      mode: 'generate',
      instruction: 'PythonでCSVを集計するコードを実行してください',
      language: 'python',
    });
    expect(response.body.params.code).toBeUndefined();
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

    const paramsMismatch = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({
        runId: planned.body.runId,
        planToken: planned.body.planToken,
        toolName: 'document_generator',
        params: { content: 'Different content than the signed plan' },
      });
    expect(paramsMismatch.status).toBe(403);
    expect(paramsMismatch.body.code).toBe('AGENT_PLAN_PARAMS_MISMATCH');

    const approved = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({
        runId: planned.body.runId,
        planToken: planned.body.planToken,
        toolName: 'document_generator',
        params: planned.body.params,
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

describe('agent orchestrator v3 browser approval', () => {
  const browserEnv = { ...env, APP_URL: 'https://example.test' };
  const store: AgentRunConsumptionStore = { consume: async () => true };
  const origin = { Origin: 'https://example.test' };

  const planInBrowser = async (app: express.Express, goal: string) => {
    const plan = await request(app).post('/api/agent/v3/plan').send({ goal });
    expect(plan.status).toBe(201);
    return plan.body as { runId: string; planToken: string; steps: Array<{ toolName: string; params: Record<string, unknown> }> };
  };

  it('requires a same-origin Origin header and an explicit confirmation', async () => {
    const app = appFor(browserEnv, store);
    const plan = await planInBrowser(app, 'Inspect repository structure');

    const noOrigin = await request(app).post('/api/agent/v3/browser-approval')
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.code).toBe('AGENT_BROWSER_ORIGIN_REQUIRED');

    const crossOrigin = await request(app).post('/api/agent/v3/browser-approval')
      .set('Origin', 'https://evil.example')
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.body.code).toBe('AGENT_BROWSER_ORIGIN_REQUIRED');

    const noConfirm = await request(app).post('/api/agent/v3/browser-approval')
      .set(origin)
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps });
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.code).toBe('AGENT_CONFIRMATION_REQUIRED');
  });

  it('lets a browser user approve and execute without the operator credential', async () => {
    const app = appFor(browserEnv, store);
    const plan = await planInBrowser(app, 'Read the file `package.json`');
    expect(plan.steps.map(step => step.toolName)).toEqual(['file_reader']);

    const approval = await request(app).post('/api/agent/v3/browser-approval')
      .set(origin)
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
    expect(approval.status).toBe(201);
    expect(approval.body.authMode).toBe('browser');

    const result = await request(app).post('/api/agent/v3/execute')
      .set(origin)
      .send({ runId: plan.runId, steps: plan.steps, approvalToken: approval.body.approvalToken });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('completed');
    expect(result.body.authMode).toBe('browser');
    expect(result.body.artifact).toContain('"scripts"');
  });

  it('never executes without an approval capability, even from a browser', async () => {
    const app = appFor(browserEnv, store);
    const plan = await planInBrowser(app, 'Inspect repository structure');
    const result = await request(app).post('/api/agent/v3/execute')
      .set(origin)
      .send({ runId: plan.runId, steps: plan.steps, approvalToken: 'forged' });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('AGENT_AUTHENTICATED_APPROVAL_REQUIRED');
  });

  it('does not let a browser-issued approval ride the operator path or vice versa', async () => {
    const app = appFor(browserEnv, store);
    const plan = await planInBrowser(app, 'Inspect repository structure');
    const approval = await request(app).post('/api/agent/v3/browser-approval')
      .set(origin)
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
    expect(approval.status).toBe(201);

    const operatorPath = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${env.ORIGIN_AGENT_APPROVAL_SECRET}`)
      .send({ runId: plan.runId, steps: plan.steps, approvalToken: approval.body.approvalToken });
    expect(operatorPath.status).toBe(403);

    const noOrigin = await request(app).post('/api/agent/v3/execute')
      .send({ runId: plan.runId, steps: plan.steps, approvalToken: approval.body.approvalToken });
    expect(noOrigin.status).toBe(401);
  });

  it('keeps browser executions single-use through the shared replay store', async () => {
    const used = new Set<string>();
    const singleUseStore: AgentRunConsumptionStore = { consume: async (runId) => {
      if (used.has(runId)) return false;
      used.add(runId);
      return true;
    } };
    const app = appFor(browserEnv, singleUseStore);
    const plan = await planInBrowser(app, 'Inspect repository structure');
    const approval = await request(app).post('/api/agent/v3/browser-approval')
      .set(origin)
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
    expect(approval.status).toBe(201);

    const first = await request(app).post('/api/agent/v3/execute')
      .set(origin)
      .send({ runId: plan.runId, steps: plan.steps, approvalToken: approval.body.approvalToken });
    expect(first.status).toBe(200);
    const replay = await request(app).post('/api/agent/v3/execute')
      .set(origin)
      .send({ runId: plan.runId, steps: plan.steps, approvalToken: approval.body.approvalToken });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('AGENT_RUN_ALREADY_CONSUMED');
  });

  it('executes a multi-step plan sequentially through the task graph', async () => {
    const app = appFor(browserEnv, store);
    const plan = await planInBrowser(app, 'リポジトリの構成を確認して、`package.json` ファイルも読んでください');
    expect(plan.steps.map(step => step.toolName)).toEqual(['repository_explorer', 'file_reader']);

    const approval = await request(app).post('/api/agent/v3/browser-approval')
      .set(origin)
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
    expect(approval.status).toBe(201);

    const result = await request(app).post('/api/agent/v3/execute')
      .set(origin)
      .send({ runId: plan.runId, steps: plan.steps, approvalToken: approval.body.approvalToken });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('completed');
    expect(result.body.steps).toHaveLength(2);
    expect(result.body.steps.map((step: { toolName: string }) => step.toolName)).toEqual(['repository_explorer', 'file_reader']);
    expect(result.body.artifact).toContain('"scripts"');
  });
});
