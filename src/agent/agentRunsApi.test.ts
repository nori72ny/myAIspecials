// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';

const SECRET = 'test-only-'.repeat(5);
const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };
const browserEnv = { ...env, APP_URL: 'https://example.test' };
const ORIGIN = { Origin: 'https://example.test' };
const OPERATOR_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');

function makeConsumptionStore() {
  const consumed = new Set<string>();
  const store: AgentRunConsumptionStore = {
    consume: vi.fn(async (runId: string) => {
      if (consumed.has(runId)) return false;
      consumed.add(runId);
      return true;
    }),
  };
  return { store, consumed };
}

function appFor(testEnv: NodeJS.ProcessEnv, consumptionStore?: AgentRunConsumptionStore, runStore?: InMemoryAgentRunStore) {
  const app = express();
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(testEnv, consumptionStore, { runStore }));
  return app;
}

class CreateFailingRunStore extends InMemoryAgentRunStore {
  constructor(private readonly failure: unknown) {
    super();
  }

  override async create(): Promise<never> {
    throw this.failure;
  }
}

class ListFailingRunStore extends InMemoryAgentRunStore {
  constructor(private readonly failure: unknown) {
    super();
  }

  override async listByOwner(): Promise<never> {
    throw this.failure;
  }
}

type PlanBody = {
  runId: string;
  planToken: string;
  steps: Array<{ toolName: string; params: Record<string, unknown> }>;
  params?: Record<string, unknown>;
};

async function planDocument(app: express.Express): Promise<PlanBody> {
  const plan = await request(app).post('/api/agent/v3/plan').send({ goal: 'Create a sales report.' });
  expect(plan.status).toBe(201);
  expect(plan.body.selectedTool).toBe('document_generator');
  return plan.body as PlanBody;
}

async function approveOperator(app: express.Express, plan: PlanBody): Promise<string> {
  const approval = await request(app).post('/api/agent/v3/approval')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps });
  expect(approval.status).toBe(201);
  return approval.body.approvalToken as string;
}

describe('agent v3 durable runs API', () => {
  it('creates, reads, lists and advances a run end to end (operator mode)', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore, consumed } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await planDocument(app);
    const approvalToken = await approveOperator(app, plan);

    const created = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(created.status).toBe(201);
    expect(created.body.persistence).toBe('durable-run-record');
    expect(created.body.run.status).toBe('queued');
    expect(created.body.run.plan).toEqual([
      { toolName: 'document_generator', params: plan.steps[0]?.params, dependsOn: [] },
    ]);
    expect(created.body.run.planDigest).toMatch(/^[a-f0-9]{64}$/);
    // No owner binding, plan token or approval token is ever exposed.
    expect(JSON.stringify(created.body)).not.toContain(OPERATOR_BINDING);
    expect(JSON.stringify(created.body)).not.toContain(plan.planToken);
    expect(JSON.stringify(created.body)).not.toContain(approvalToken);

    // Idempotent re-create for the same owner and plan.
    const recreated = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(recreated.status).toBe(200);
    expect(recreated.body.run.status).toBe('queued');

    const fetched = await request(app).get(`/api/agent/v3/runs/${plan.runId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.run.runId).toBe(plan.runId);

    const listed = await request(app).get('/api/agent/v3/runs?status=queued')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(listed.status).toBe(200);
    expect(listed.body.runs.map((run: { runId: string }) => run.runId)).toContain(plan.runId);
    const listedOtherStatus = await request(app).get('/api/agent/v3/runs?status=completed')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(listedOtherStatus.body.runs).toEqual([]);

    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe('completed');
    expect(advanced.body.run.stepsState).toEqual([
      expect.objectContaining({ id: 'task-1', status: 'completed', attempts: 1 }),
    ]);
    expect(consumed.has(plan.runId)).toBe(true);
    // PR-D1: the completing advance delivers the final artifact body for
    // display (the same `artifact` field as the legacy /execute response),
    // while the record and its view keep only the step reference/summary.
    expect(typeof advanced.body.artifact).toBe('string');
    const delivered = JSON.parse(advanced.body.artifact) as { kind?: unknown; verified?: unknown; content?: unknown };
    expect(delivered.kind).toBe('document');
    expect(delivered.verified).toBe(true);
    expect(typeof delivered.content).toBe('string');
    expect(advanced.body.run).not.toHaveProperty('artifact');
    expect(advanced.body.run.stepsState[0]).not.toHaveProperty('artifact');

    // Advancing a terminal run is an idempotent read-back, not an error.
    const advancedAgain = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(advancedAgain.status).toBe(200);
    expect(advancedAgain.body.status).toBe('completed');
    expect(advancedAgain.body.advanced).toBe(false);
    // The read-back carries no artifact body: bodies are delivered only
    // by the advance that finalized them.
    expect(advancedAgain.body).not.toHaveProperty('artifact');
  });

  it('rejects run creation without the matching plan and approval bindings', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await planDocument(app);
    const approvalToken = await approveOperator(app, plan);

    const noAuth = await request(app).post('/api/agent/v3/runs')
      .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(noAuth.status).toBe(401);

    const tampered = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({
        runId: plan.runId,
        goal: 'Create a sales report.',
        planToken: plan.planToken,
        approvalToken,
        steps: [{ toolName: 'document_generator', params: { title: 'Forged', kind: 'report', audience: 'x', sections: ['a'] } }],
      });
    expect(tampered.status).toBe(403);
    expect(tampered.body.code).toBe('AGENT_PLAN_PARAMS_MISMATCH');

    const wrongGoal = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: 'Write a poem instead.', planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(wrongGoal.status).toBe(403);
    expect(wrongGoal.body.code).toBe('AGENT_PLAN_GOAL_MISMATCH');

    const forgedApproval = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken: 'forged', steps: plan.steps });
    expect(forgedApproval.status).toBe(403);
    expect(forgedApproval.body.code).toBe('AGENT_APPROVAL_INVALID');

    expect(await runStore.listByOwner(OPERATOR_BINDING)).toEqual([]);
  });

  it('scopes browser runs to their plan capability and hides them from the operator', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(browserEnv, consumptionStore, runStore);
    const plan = await planDocument(app);
    const approval = await request(app).post('/api/agent/v3/browser-approval')
      .set(ORIGIN)
      .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
    expect(approval.status).toBe(201);

    const created = await request(app).post('/api/agent/v3/runs')
      .set(ORIGIN)
      .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken: approval.body.approvalToken, steps: plan.steps });
    expect(created.status).toBe(201);

    // The operator cannot see or advance the browser-owned run.
    const operatorGet = await request(app).get(`/api/agent/v3/runs/${plan.runId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(operatorGet.status).toBe(404);
    const operatorList = await request(app).get('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(operatorList.body.runs).toEqual([]);

    // The browser owner reads it back with the plan capability header.
    const browserGet = await request(app).get(`/api/agent/v3/runs/${plan.runId}`)
      .set(ORIGIN)
      .set('x-agent-plan-token', plan.planToken);
    expect(browserGet.status).toBe(200);
    expect(browserGet.body.run.status).toBe('queued');

    // A request without the capability cannot read it.
    const anonymousGet = await request(app).get(`/api/agent/v3/runs/${plan.runId}`).set(ORIGIN);
    expect(anonymousGet.status).toBe(403);

    // The browser owner can advance it to completion.
    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken });
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe('completed');
    // PR-D1: the artifact delivery contract is the same in browser mode.
    expect(typeof advanced.body.artifact).toBe('string');
  });

  it('cancels a queued run and tombstones the shared reservation', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore, consumed } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await planDocument(app);
    const approvalToken = await approveOperator(app, plan);
    const created = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(created.status).toBe(201);

    const cancelled = await request(app).post(`/api/agent/v3/runs/${plan.runId}/cancel`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.run.status).toBe('cancelled');
    expect(cancelled.body.cancellation).toBe('run-record-and-shared-reservation');
    expect(consumed.has(plan.runId)).toBe(true);

    // A cancelled run cannot be advanced, and the legacy execute path is
    // blocked by the tombstone as well.
    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe('cancelled');
    const legacy = await request(app).post('/api/agent/v3/execute')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, approvalToken, steps: plan.steps });
    expect(legacy.status).toBe(409);
    expect(legacy.body.code).toBe('AGENT_RUN_ALREADY_CONSUMED');
  });

  it('refuses to advance a held run (resume requires re-approval first)', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const held = await runStore.create({
      runId: 'run-held-fixture-01',
      ownerBinding: OPERATOR_BINDING,
      goal: 'Held fixture',
      status: 'held',
      hold: {
        reason: 'quota_exhausted',
        resumeCondition: { kind: 'quota_reset', provider: 'openrouter' },
        heldSince: Date.now(),
        resumeAttempts: 0,
      },
      expiresAt: Date.now() + 10 * 60_000,
    });
    expect(held?.status).toBe('held');

    const advanced = await request(app).post('/api/agent/v3/runs/run-held-fixture-01/advance')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(advanced.status).toBe(409);
    expect(advanced.body.code).toBe('AGENT_RUN_HELD');
    expect((await runStore.get('run-held-fixture-01', OPERATOR_BINDING))?.status).toBe('held');
  });

  it('returns 503 for every runs route when no run store is configured', async () => {
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore);
    const plan = await planDocument(app);
    const approvalToken = await approveOperator(app, plan);

    const created = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(created.status).toBe(503);
    expect(created.body.code).toBe('AGENT_RUN_STORE_UNAVAILABLE');

    const listed = await request(app).get('/api/agent/v3/runs').set('Authorization', `Bearer ${SECRET}`);
    expect(listed.status).toBe(503);
    const fetched = await request(app).get(`/api/agent/v3/runs/${plan.runId}`).set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.status).toBe(503);
    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(advanced.status).toBe(503);
  });

  it('logs the store failure class (never the message) when creation hits an infrastructure error', async () => {
    // Shaped like a node-postgres error for a missing runs table, with a
    // connection string embedded in the message to prove it never leaks.
    const failure = Object.assign(
      new Error('relation "public.origin_agent_runs" does not exist (postgres://origin:fixture-password@db.invalid:5432/postgres)'),
      { code: '42P01' },
    );
    const runStore = new CreateFailingRunStore(failure);
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await planDocument(app);
    const approvalToken = await approveOperator(app, plan);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const created = await request(app).post('/api/agent/v3/runs')
        .set('Authorization', `Bearer ${SECRET}`)
        .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken, steps: plan.steps });
      expect(created.status).toBe(503);
      expect(created.body.code).toBe('AGENT_RUN_STORE_UNAVAILABLE');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('ORIGIN_AGENT_RUN_STORE_FAILED', {
        operation: 'create',
        name: 'Error',
        code: '42P01',
      });
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain('does not exist');
      expect(logged).not.toContain('fixture-password');
      expect(logged).not.toContain('db.invalid');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps AGENT_RUN_* store errors on the 400 path without an infrastructure log', async () => {
    const runStore = new CreateFailingRunStore(new Error('AGENT_RUN_CREATE_INPUT_INVALID'));
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await planDocument(app);
    const approvalToken = await approveOperator(app, plan);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const created = await request(app).post('/api/agent/v3/runs')
        .set('Authorization', `Bearer ${SECRET}`)
        .send({ runId: plan.runId, goal: 'Create a sales report.', planToken: plan.planToken, approvalToken, steps: plan.steps });
      expect(created.status).toBe(400);
      expect(created.body.code).toBe('AGENT_RUN_CREATE_INPUT_INVALID');
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs the store failure class when listing runs hits an infrastructure error', async () => {
    const failure = Object.assign(new Error('connection terminated unexpectedly'), { code: '57P01' });
    const runStore = new ListFailingRunStore(failure);
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const listed = await request(app).get('/api/agent/v3/runs').set('Authorization', `Bearer ${SECRET}`);
      expect(listed.status).toBe(503);
      expect(listed.body.code).toBe('AGENT_RUN_STORE_UNAVAILABLE');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('ORIGIN_AGENT_RUN_STORE_FAILED', {
        operation: 'list',
        name: 'Error',
        code: '57P01',
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('connection terminated');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
