// @vitest-environment node
/**
 * Plan-digest regression tests for the jsonb key-order defect.
 *
 * The run store persists the plan in a Postgres jsonb column, which does
 * not preserve object key order (keys come back sorted by length, then
 * bytewise). The pre-fix plan digest was computed over plain
 * JSON.stringify, so the digest stored at plan/resume time could never
 * be reproduced from the stored plan: resume confirm failed with
 * AGENT_RUN_PLAN_DIGEST_MISMATCH for every plan whose params carry more
 * than one key. The in-memory fixture store preserves key order, so it
 * cannot surface this; the store below simulates the jsonb round trip
 * on every read, the same observable behavior as the Postgres store.
 */
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import type {
  AgentRunRecord,
  CreateAgentRunInput,
  ListAgentRunsByOwnerOptions,
  TransitionAgentRunInput,
} from './agentRunRecord.js';

const SECRET = 'test-only-'.repeat(5);
const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET } as NodeJS.ProcessEnv;
const OPERATOR_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');
const GOAL = 'Create a sales report.';
const MULTI_STEP_GOAL = '最新のスマートフォン市場を調べてレポートを作成してください';

/** Postgres jsonb key order: by key length, then bytewise. */
function jsonbKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbKeyOrder);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, jsonbKeyOrder(entry)]));
  }
  return value;
}

function jsonbRoundTripped(record: AgentRunRecord): AgentRunRecord {
  if (!record.plan) return record;
  return {
    ...record,
    plan: record.plan.map((step) => ({ ...step, params: jsonbKeyOrder(step.params) as typeof step.params })),
  };
}

/** The pre-fix (order-sensitive) plan digest formula, for legacy records. */
function legacyPlanDigest(plan: readonly { toolName: string; params: unknown }[]): string {
  if (plan.length === 1) return createHash('sha256').update(JSON.stringify(plan[0].params)).digest('hex');
  return createHash('sha256').update(JSON.stringify(plan.map((step) => [step.toolName, step.params]))).digest('hex');
}

class JsonbSimulatingRunStore extends InMemoryAgentRunStore {
  /** Test hook: rewrite a record on every read, before key reordering. */
  readonly readRewrites = new Map<string, (record: AgentRunRecord) => AgentRunRecord>();

  private simulate(record: AgentRunRecord | null): AgentRunRecord | null {
    if (!record) return record;
    const rewrite = this.readRewrites.get(record.runId);
    return jsonbRoundTripped(rewrite ? rewrite(record) : record);
  }

  override async create(input: CreateAgentRunInput, now?: number): Promise<AgentRunRecord | null> {
    return this.simulate(await super.create(input, now));
  }

  override async get(runId: string, ownerBinding: string): Promise<AgentRunRecord | null> {
    return this.simulate(await super.get(runId, ownerBinding));
  }

  override async listByOwner(ownerBinding: string, options?: ListAgentRunsByOwnerOptions): Promise<AgentRunRecord[]> {
    return (await super.listByOwner(ownerBinding, options))
      .map((record) => this.simulate(record))
      .filter((record): record is AgentRunRecord => record !== null);
  }

  override async transition(input: TransitionAgentRunInput): Promise<AgentRunRecord | null> {
    return this.simulate(await super.transition(input));
  }
}

function makeConsumptionStore(): AgentRunConsumptionStore {
  const consumed = new Set<string>();
  return {
    consume: vi.fn(async (runId: string) => {
      if (consumed.has(runId)) return false;
      consumed.add(runId);
      return true;
    }),
  };
}

function appFor(runStore: InMemoryAgentRunStore) {
  const app = express();
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(env, makeConsumptionStore(), { runStore }));
  return app;
}

type PlanBody = {
  runId: string;
  planToken: string;
  steps: Array<{ toolName: string; params: Record<string, unknown> }>;
};

async function planFor(app: express.Express, goal: string): Promise<PlanBody> {
  const plan = await request(app).post('/api/agent/v3/plan').send({ goal });
  expect(plan.status).toBe(201);
  return plan.body as PlanBody;
}

async function approveOperator(app: express.Express, plan: { runId: string; planToken: string; steps: unknown }): Promise<string> {
  const approval = await request(app).post('/api/agent/v3/approval')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps });
  expect(approval.status).toBe(201);
  return approval.body.approvalToken as string;
}

async function createQueuedRun(app: express.Express, goal: string): Promise<PlanBody> {
  const plan = await planFor(app, goal);
  const approvalToken = await approveOperator(app, plan);
  const created = await request(app).post('/api/agent/v3/runs')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.runId, goal, planToken: plan.planToken, approvalToken, steps: plan.steps });
  expect(created.status).toBe(201);
  expect(created.body.run.status).toBe('queued');
  return plan;
}

const holdOperator = (app: express.Express, runId: string) =>
  request(app).post(`/api/agent/v3/runs/${runId}/hold`).set('Authorization', `Bearer ${SECRET}`).send({ reason: 'user_paused' });
const resumeOperator = (app: express.Express, runId: string) =>
  request(app).post(`/api/agent/v3/runs/${runId}/resume`).set('Authorization', `Bearer ${SECRET}`).send({});
const confirmOperator = (app: express.Express, runId: string, approvalToken: string) =>
  request(app).post(`/api/agent/v3/runs/${runId}/resume/confirm`).set('Authorization', `Bearer ${SECRET}`).send({ approvalToken });

async function resumeAndConfirm(app: express.Express, runId: string) {
  const resumed = await resumeOperator(app, runId);
  expect(resumed.status).toBe(200);
  const approvalToken = await approveOperator(app, {
    runId,
    planToken: resumed.body.planToken,
    steps: resumed.body.steps,
  });
  const confirmed = await confirmOperator(app, runId, approvalToken);
  return { resumed, confirmed };
}

describe('plan digest across a jsonb round trip', () => {
  it('confirm succeeds for a single-step plan with multi-key params after jsonb key reordering', async () => {
    const runStore = new JsonbSimulatingRunStore();
    const app = appFor(runStore);
    const plan = await createQueuedRun(app, GOAL);
    // Sanity: this plan really does change serialization under jsonb.
    const params = plan.steps[0].params;
    expect(Object.keys(params).length).toBeGreaterThan(1);
    expect(JSON.stringify(params)).not.toBe(JSON.stringify(jsonbKeyOrder(params)));

    await holdOperator(app, plan.runId);
    const { resumed, confirmed } = await resumeAndConfirm(app, plan.runId);
    expect(resumed.body.planChanged).toBe(false);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('queued');
  });

  it('confirm succeeds for a multi-step plan after jsonb key reordering', async () => {
    const runStore = new JsonbSimulatingRunStore();
    const app = appFor(runStore);
    const plan = await createQueuedRun(app, MULTI_STEP_GOAL);
    expect(plan.steps.length).toBeGreaterThan(1);
    expect(plan.steps.some((step) => JSON.stringify(step.params) !== JSON.stringify(jsonbKeyOrder(step.params)))).toBe(true);

    await holdOperator(app, plan.runId);
    const { resumed, confirmed } = await resumeAndConfirm(app, plan.runId);
    expect(resumed.body.planChanged).toBe(false);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('queued');
  });

  it('run creation accepts steps whose params keys were reordered in transit', async () => {
    const runStore = new JsonbSimulatingRunStore();
    const app = appFor(runStore);
    const plan = await planFor(app, GOAL);
    const reorderedSteps = plan.steps.map((step) => ({ ...step, params: jsonbKeyOrder(step.params) as Record<string, unknown> }));
    const approvalToken = await approveOperator(app, { runId: plan.runId, planToken: plan.planToken, steps: reorderedSteps });
    const created = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: GOAL, planToken: plan.planToken, approvalToken, steps: reorderedSteps });
    expect(created.status).toBe(201);
    expect(created.body.run.status).toBe('queued');
  });

  it('a pre-fix legacy-digest record resumes with step progress preserved and still confirms', async () => {
    const runStore = new JsonbSimulatingRunStore();
    const app = appFor(runStore);
    const plan = await createQueuedRun(app, GOAL);

    // Record real step progress, then hold the run through the store
    // (the detached-driver path the production holds use).
    const lease = await runStore.claim(plan.runId, 'driver-digest-test', 300);
    expect(lease?.status).toBe('running');
    expect(await runStore.updateProgress(plan.runId, 'driver-digest-test', {
      stepsState: [{ id: 'task-1', status: 'completed', attempts: 1 }],
    })).toBe(true);
    const held = await runStore.finish(plan.runId, 'driver-digest-test', 'held', {
      reason: 'user_paused',
      resumeCondition: { kind: 'manual' },
      heldSince: Date.now(),
      resumeAttempts: 0,
    });
    expect(held?.status).toBe('held');

    // Downgrade the stored digest to the pre-fix formula, as every record
    // written before the canonical form carries. The rewrite sees the
    // record in its original (insertion) key order, exactly what the
    // pre-fix code digested; reads then round-trip through jsonb order.
    runStore.readRewrites.set(plan.runId, (record) => ({
      ...record,
      planDigest: legacyPlanDigest(record.plan ?? []),
    }));

    const { resumed, confirmed } = await resumeAndConfirm(app, plan.runId);
    expect(resumed.body.planChanged).toBe(false);
    const stored = await runStore.get(plan.runId, OPERATOR_BINDING);
    expect(stored?.stepsState).toEqual([{ id: 'task-1', status: 'completed', attempts: 1 }]);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('queued');
  });

  it('confirm rejects when the stored plan was altered after the approval was minted', async () => {
    const runStore = new JsonbSimulatingRunStore();
    const app = appFor(runStore);
    const plan = await createQueuedRun(app, GOAL);
    await holdOperator(app, plan.runId);
    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(200);
    const approvalToken = await approveOperator(app, {
      runId: plan.runId,
      planToken: resumed.body.planToken,
      steps: resumed.body.steps,
    });

    // Alter the stored plan after approval: the approval was minted for
    // different steps, so confirm must refuse and the run must stay put.
    runStore.readRewrites.set(plan.runId, (record) => ({
      ...record,
      plan: (record.plan ?? []).map((step, index) => (index === 0
        ? { ...step, params: { ...step.params, title: '改ざんされたタイトル' } }
        : step)),
    }));
    const confirmed = await confirmOperator(app, plan.runId, approvalToken);
    expect(confirmed.status).toBe(403);
    expect(confirmed.body.code).toBe('AGENT_APPROVAL_INVALID');
    runStore.readRewrites.delete(plan.runId);
    const stored = await runStore.get(plan.runId, OPERATOR_BINDING);
    expect(stored?.status).toBe('awaiting_approval');
  });
});
