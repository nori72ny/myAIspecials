// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { approvalDigest } from './agentApproval.js';
import { issueApprovalCapability } from './agentV3Capability.js';

/**
 * Piggyback evaluation at the HTTP surface (multitask Phase 1, PR 1-G).
 * The owner-scoped run reads run the evaluation for the requesting
 * owner before answering; these tests drive the real router and the
 * real planner, so what is verified is the wiring the task board will
 * actually exercise in production.
 */

const SECRET = 'test-only-'.repeat(5);
const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };
const OPERATOR_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');
const OTHER_BINDING = createHash('sha256').update('origin.agent.runs.owner.other.v1').digest('hex');
const GOAL = 'Create a sales report.';

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

async function createQueuedRun(app: express.Express): Promise<PlanBody> {
  const plan = await request(app).post('/api/agent/v3/plan').send({ goal: GOAL });
  expect(plan.status).toBe(201);
  const approval = await request(app).post('/api/agent/v3/approval')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.body.runId, planToken: plan.body.planToken, steps: plan.body.steps });
  expect(approval.status).toBe(201);
  const created = await request(app).post('/api/agent/v3/runs')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({
      runId: plan.body.runId, goal: GOAL, planToken: plan.body.planToken,
      approvalToken: approval.body.approvalToken, steps: plan.body.steps,
    });
  expect(created.status).toBe(201);
  return plan.body as PlanBody;
}

const operator = (req: request.Test) => req.set('Authorization', `Bearer ${SECRET}`);

describe('piggyback evaluation on run reads (PR 1-G)', () => {
  it('advances a due held run to awaiting_approval on GET /runs — and execution still needs a fresh approval (§8)', async () => {
    const runStore = new InMemoryAgentRunStore();
    const app = appFor(runStore);
    const plan = await createQueuedRun(app);
    const held = await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/hold`)).send({
      reason: 'scheduled_time',
      resumeCondition: { kind: 'at_time', at: Date.now() - 1000 },
    });
    expect(held.status).toBe(200);

    const listed = await operator(request(app).get('/api/agent/v3/runs'));
    expect(listed.status).toBe(200);
    expect(listed.body.piggybackEvaluation).toEqual({ advanced: 1, approvalTimeouts: 0, capped: 0 });
    const view = listed.body.runs.find((run: { runId: string }) => run.runId === plan.runId);
    expect(view.status).toBe('awaiting_approval');
    expect(view.hold).toBeNull();
    expect(typeof view.approvalDeadlineAt).toBe('string');
    expect(Date.parse(view.approvalDeadlineAt)).toBeGreaterThan(Date.now());

    // §8: the auto-advance is not an approval. Advancing execution is
    // refused until the human resume/confirm flow runs.
    const advanced = await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)).send({});
    expect(advanced.status).toBe(409);
    expect(advanced.body.code).toBe('AGENT_RUN_NOT_APPROVED');
  });

  it('an auto-advanced run completes the ordinary resume → approve → confirm → advance flow', async () => {
    const runStore = new InMemoryAgentRunStore();
    const app = appFor(runStore);
    const plan = await createQueuedRun(app);
    await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/hold`)).send({
      reason: 'scheduled_time',
      resumeCondition: { kind: 'at_time', at: Date.now() - 1000 },
    });
    const listed = await operator(request(app).get('/api/agent/v3/runs'));
    expect(listed.body.piggybackEvaluation).toEqual({ advanced: 1, approvalTimeouts: 0, capped: 0 });

    const resumed = await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/resume`)).send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.resumed).toBe('already');
    expect(resumed.body.planChanged).toBe(false);
    // The approval capability is minted directly (as in the 1-C tests)
    // to keep this flow inside the shared POST burst budget; the
    // /approval endpoint path is covered by the other tests here.
    const approvalToken = issueApprovalCapability(
      plan.runId,
      approvalDigest({ action: 'execute', runId: plan.runId, toolName: 'document_generator', params: resumed.body.steps[0].params }),
      env,
      Date.now(),
      'operator',
    ).token;
    const confirmed = await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/resume/confirm`))
      .send({ approvalToken });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.run.status).toBe('queued');
    const executed = await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)).send({});
    expect(executed.body.status).toBe('completed');
  });

  it('converts an approval-lapsed run to a manual hold on GET /runs/:id', async () => {
    const runStore = new InMemoryAgentRunStore();
    const app = appFor(runStore);
    const created = await runStore.create({
      runId: 'run-piggy-lapsed-01',
      ownerBinding: OPERATOR_BINDING,
      goal: GOAL,
      status: 'awaiting_approval',
      plan: [{ toolName: 'document_generator', params: {}, dependsOn: [] }],
      planDigest: 'b'.repeat(64),
      approvalDeadlineAt: Date.now() - 1000,
      expiresAt: Date.now() + 10 * 60_000,
    });
    expect(created?.status).toBe('awaiting_approval');

    const fetched = await operator(request(app).get('/api/agent/v3/runs/run-piggy-lapsed-01'));
    expect(fetched.status).toBe(200);
    expect(fetched.body.piggybackEvaluation).toEqual({ advanced: 0, approvalTimeouts: 1, capped: 0 });
    expect(fetched.body.run.status).toBe('held');
    expect(fetched.body.run.hold).toMatchObject({
      reason: 'awaiting_approval',
      resumeCondition: { kind: 'manual' },
      resumeAttempts: 0,
    });
    expect(fetched.body.run.approvalDeadlineAt).toBeNull();

    // The converted hold is manual: a second read changes nothing more.
    const again = await operator(request(app).get('/api/agent/v3/runs/run-piggy-lapsed-01'));
    expect(again.body.piggybackEvaluation).toEqual({ advanced: 0, approvalTimeouts: 0, capped: 0 });
    expect(again.body.run.status).toBe('held');
  });

  it('never evaluates another owner’s runs', async () => {
    const runStore = new InMemoryAgentRunStore();
    const app = appFor(runStore);
    await runStore.create({
      runId: 'run-piggy-other-001',
      ownerBinding: OTHER_BINDING,
      goal: GOAL,
      status: 'held',
      hold: {
        reason: 'scheduled_time',
        resumeCondition: { kind: 'at_time', at: Date.now() - 1000 },
        heldSince: Date.now() - 2000,
        resumeAttempts: 0,
      },
      expiresAt: Date.now() + 10 * 60_000,
    });
    const listed = await operator(request(app).get('/api/agent/v3/runs'));
    expect(listed.status).toBe(200);
    expect(listed.body.piggybackEvaluation).toEqual({ advanced: 0, approvalTimeouts: 0, capped: 0 });
    expect(listed.body.runs).toEqual([]);
    expect((await runStore.get('run-piggy-other-001', OTHER_BINDING))?.status).toBe('held');
  });

  it('stores the approval deadline at manual resume and refreshes it on capability re-issue', async () => {
    const runStore = new InMemoryAgentRunStore();
    const app = appFor(runStore);
    const plan = await createQueuedRun(app);
    await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/hold`)).send({ reason: 'user_paused' });

    const resumed = await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/resume`)).send({});
    expect(resumed.status).toBe(200);
    const afterResume = await runStore.get(plan.runId, OPERATOR_BINDING);
    expect(afterResume?.status).toBe('awaiting_approval');
    // Deadline = plan capability expiry + approval TTL, exactly the
    // response's planExpiresAt plus two minutes.
    expect(afterResume?.approvalDeadlineAt).toBe(Date.parse(resumed.body.planExpiresAt) + 2 * 60_000);

    // Re-issuing the capability (the idempotent resume path) moves the
    // deadline to the new capability's window without moving updatedAt
    // (the confirm freshness anchor).
    const versionBefore = afterResume?.version;
    const updatedBefore = afterResume?.updatedAt;
    const reissued = await operator(request(app).post(`/api/agent/v3/runs/${plan.runId}/resume`)).send({});
    expect(reissued.status).toBe(200);
    expect(reissued.body.resumed).toBe('already');
    const afterReissue = await runStore.get(plan.runId, OPERATOR_BINDING);
    expect(afterReissue?.approvalDeadlineAt).toBe(Date.parse(reissued.body.planExpiresAt) + 2 * 60_000);
    expect(afterReissue?.approvalDeadlineAt).toBeGreaterThanOrEqual(afterResume?.approvalDeadlineAt ?? 0);
    expect(afterReissue?.version).toBe(versionBefore);
    expect(afterReissue?.updatedAt).toBe(updatedBefore);
  });
});
