// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import { computeAgentRunStepFingerprint } from './agentRunRecord.js';
import { validateAgentAttachmentFileText } from './agentAttachmentRecord.js';
import type { AgentModelExecutor } from './agentModelCall.js';
import { approvalDigest } from './agentApproval.js';
import { issueApprovalCapability, verifyApprovalCapability } from './agentV3Capability.js';

const SECRET = 'test-only-'.repeat(5);
const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };
const browserEnv = { ...env, APP_URL: 'https://example.test' };
const ORIGIN = { Origin: 'https://example.test' };
const OPERATOR_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');
const GOAL = 'Create a sales report.';

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

type PlanBody = {
  runId: string;
  planToken: string;
  steps: Array<{ toolName: string; params: Record<string, unknown> }>;
};

async function planDocument(app: express.Express): Promise<PlanBody> {
  const plan = await request(app).post('/api/agent/v3/plan').send({ goal: GOAL });
  expect(plan.status).toBe(201);
  expect(plan.body.selectedTool).toBe('document_generator');
  return plan.body as PlanBody;
}

async function approveOperator(app: express.Express, plan: { runId: string; planToken: string; steps: unknown }): Promise<string> {
  const approval = await request(app).post('/api/agent/v3/approval')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps });
  expect(approval.status).toBe(201);
  return approval.body.approvalToken as string;
}

async function createQueuedRun(app: express.Express): Promise<PlanBody> {
  const plan = await planDocument(app);
  const approvalToken = await approveOperator(app, plan);
  const created = await request(app).post('/api/agent/v3/runs')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.runId, goal: GOAL, planToken: plan.planToken, approvalToken, steps: plan.steps });
  expect(created.status).toBe(201);
  expect(created.body.run.status).toBe('queued');
  return plan;
}

const holdOperator = (app: express.Express, runId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/agent/v3/runs/${runId}/hold`).set('Authorization', `Bearer ${SECRET}`).send(body);
const resumeOperator = (app: express.Express, runId: string) =>
  request(app).post(`/api/agent/v3/runs/${runId}/resume`).set('Authorization', `Bearer ${SECRET}`).send({});
const confirmOperator = (app: express.Express, runId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/agent/v3/runs/${runId}/resume/confirm`).set('Authorization', `Bearer ${SECRET}`).send(body);
const advanceOperator = (app: express.Express, runId: string) =>
  request(app).post(`/api/agent/v3/runs/${runId}/advance`).set('Authorization', `Bearer ${SECRET}`).send({});

describe('agent v3 run hold endpoint', () => {
  it('holds a queued run with a default manual resume condition and blocks advance', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);

    const held = await holdOperator(app, plan.runId, { reason: 'user_paused' });
    expect(held.status).toBe(200);
    expect(held.body.status).toBe('held');
    expect(held.body.run.hold).toMatchObject({
      reason: 'user_paused',
      resumeCondition: { kind: 'manual' },
      resumeAttempts: 0,
    });
    expect(JSON.stringify(held.body)).not.toContain(OPERATOR_BINDING);

    const advanced = await advanceOperator(app, plan.runId);
    expect(advanced.status).toBe(409);
    expect(advanced.body.code).toBe('AGENT_RUN_HELD');

    const listed = await request(app).get('/api/agent/v3/runs?status=held')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(listed.body.runs.map((run: { runId: string }) => run.runId)).toContain(plan.runId);
  });

  it('holds with a quota_exhausted reason and a quota_reset condition', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);

    const held = await holdOperator(app, plan.runId, {
      reason: 'quota_exhausted',
      resumeCondition: { kind: 'quota_reset', provider: 'openrouter', resetAt: Date.now() + 3_600_000 },
    });
    expect(held.status).toBe(200);
    expect(held.body.run.hold.reason).toBe('quota_exhausted');
    expect(held.body.run.hold.resumeCondition).toMatchObject({ kind: 'quota_reset', provider: 'openrouter' });
  });

  it('rejects invalid reasons and incompatible reason/condition pairs', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);

    const badReason = await holdOperator(app, plan.runId, { reason: 'because' });
    expect(badReason.status).toBe(400);
    expect(badReason.body.code).toBe('AGENT_RUN_HOLD_INVALID');

    const incompatible = await holdOperator(app, plan.runId, {
      reason: 'user_paused',
      resumeCondition: { kind: 'dependency', targetKind: 'run', targetId: 'run-other-123456' },
    });
    expect(incompatible.status).toBe(400);
    expect(incompatible.body.code).toBe('AGENT_RUN_HOLD_INVALID');

    const missingCondition = await holdOperator(app, plan.runId, { reason: 'dependency_wait' });
    expect(missingCondition.status).toBe(400);
    expect(missingCondition.body.code).toBe('AGENT_RUN_HOLD_INVALID');

    // None of the failed attempts held the run.
    expect((await runStore.get(plan.runId, OPERATOR_BINDING))?.status).toBe('queued');
  });

  it('is idempotent for an already held run and never overwrites the first hold', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);

    const first = await holdOperator(app, plan.runId, { reason: 'user_paused' });
    expect(first.status).toBe(200);
    const second = await holdOperator(app, plan.runId, { reason: 'quota_exhausted' });
    expect(second.status).toBe(200);
    expect(second.body.held).toBe('already');
    expect(second.body.run.hold.reason).toBe('user_paused');
  });

  it('refuses to hold a terminal run and hides other owners runs', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);
    const advanced = await advanceOperator(app, plan.runId);
    expect(advanced.body.status).toBe('completed');

    const heldTerminal = await holdOperator(app, plan.runId, { reason: 'user_paused' });
    expect(heldTerminal.status).toBe(409);
    expect(heldTerminal.body.code).toBe('AGENT_RUN_NOT_HOLDABLE');

    const missing = await holdOperator(app, 'run-does-not-exist-1', { reason: 'user_paused' });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('AGENT_RUN_NOT_FOUND');
  });

  it('holds a running run by detaching the driver lease', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);

    const lease = await runStore.claim(plan.runId, 'driver-hold-test', 120);
    expect(lease?.status).toBe('running');

    const held = await holdOperator(app, plan.runId, { reason: 'user_paused' });
    expect(held.status).toBe(200);
    expect(held.body.run.status).toBe('held');

    // The detached driver can no longer persist progress, and the held
    // run cannot be claimed again.
    expect(await runStore.updateProgress(plan.runId, 'driver-hold-test', {
      stepsState: [{ id: 'task-1', status: 'running', attempts: 1 }],
    })).toBe(false);
    expect(await runStore.claim(plan.runId, 'driver-hold-test', 120)).toBeNull();
  });
});

describe('agent v3 run resume flow', () => {
  it('resume re-plans into awaiting_approval and nothing runs before a fresh approval', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);
    await holdOperator(app, plan.runId, { reason: 'user_paused' });

    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe('awaiting_approval');
    expect(resumed.body.planChanged).toBe(false);
    expect(resumed.body.planDiff).toMatchObject({ changed: false, previousStepCount: 1, nextStepCount: 1 });
    expect(resumed.body.previousPlan).toEqual([
      expect.objectContaining({ toolName: 'document_generator' }),
    ]);
    expect(typeof resumed.body.planToken).toBe('string');
    expect(JSON.stringify(resumed.body)).not.toContain(OPERATOR_BINDING);

    // Not yet approved: advance refuses, confirm without approval fails.
    const earlyAdvance = await advanceOperator(app, plan.runId);
    expect(earlyAdvance.status).toBe(409);
    expect(earlyAdvance.body.code).toBe('AGENT_RUN_NOT_APPROVED');
    const earlyConfirm = await confirmOperator(app, plan.runId, {});
    expect(earlyConfirm.status).toBe(403);
    expect(earlyConfirm.body.code).toBe('AGENT_APPROVAL_INVALID');
  });

  it('confirm binds the fresh approval and the run advances to completion', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);
    await holdOperator(app, plan.runId, { reason: 'user_paused' });
    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(200);

    const approvalToken = await approveOperator(app, {
      runId: plan.runId,
      planToken: resumed.body.planToken,
      steps: resumed.body.steps,
    });
    const confirmed = await confirmOperator(app, plan.runId, { approvalToken });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('queued');
    expect(confirmed.body.run.status).toBe('queued');
    expect(JSON.stringify(confirmed.body)).not.toContain(approvalToken);

    const advanced = await advanceOperator(app, plan.runId);
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe('completed');
  });

  it('confirm is idempotent once the run is queued', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);

    const confirmed = await confirmOperator(app, plan.runId, {});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmed).toBe('already');
    expect(confirmed.body.run.status).toBe('queued');
  });

  it('rejects an approval capability minted before the hold (stale approval)', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);
    await holdOperator(app, plan.runId, { reason: 'user_paused' });
    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(200);

    // A capability for the exact same operation, but issued 60 seconds
    // ago (before the hold): signature and digest are valid, only its
    // issuance predates the resume, so confirm must refuse it.
    const staleApproval = issueApprovalCapability(
      plan.runId,
      approvalDigest({ action: 'execute', runId: plan.runId, toolName: 'document_generator', params: plan.steps[0].params }),
      env,
      Date.now() - 60_000,
      'operator',
    ).token;
    expect(verifyApprovalCapability(staleApproval, env, Date.now())).not.toBeNull();

    const confirmed = await confirmOperator(app, plan.runId, { approvalToken: staleApproval });
    expect(confirmed.status).toBe(403);
    expect(confirmed.body.code).toBe('AGENT_RUN_STALE_APPROVAL');
    expect((await runStore.get(plan.runId, OPERATOR_BINDING))?.status).toBe('awaiting_approval');
  });

  it('re-plans on resume and presents the diff when the stored plan differs', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    // A held record whose stored snapshot no longer matches what the
    // current planner produces for the goal (planner rules moved on).
    const stalePlan = [{ toolName: 'file_reader' as const, params: { path: 'notes.txt' }, dependsOn: [] }];
    const created = await runStore.create({
      runId: 'run-resume-diff-0001',
      ownerBinding: OPERATOR_BINDING,
      goal: GOAL,
      status: 'held',
      plan: stalePlan,
      planDigest: 'a'.repeat(64),
      stepsState: [{ id: 'task-1', status: 'completed', attempts: 1 }],
      hold: { reason: 'user_paused', resumeCondition: { kind: 'manual' }, heldSince: Date.now(), resumeAttempts: 0 },
      expiresAt: Date.now() + 10 * 60_000,
    });
    expect(created?.status).toBe('held');

    const resumed = await resumeOperator(app, 'run-resume-diff-0001');
    expect(resumed.status).toBe(200);
    expect(resumed.body.planChanged).toBe(true);
    expect(resumed.body.planDiff.steps[0]).toMatchObject({
      change: 'modified',
      previousToolName: 'file_reader',
      toolName: 'document_generator',
    });
    expect(resumed.body.run.plan[0].toolName).toBe('document_generator');
    // Progress made under the old plan does not carry into the new one.
    expect(resumed.body.run.stepsState).toEqual([{ id: 'task-1', status: 'queued', attempts: 0 }]);

    const approvalToken = await approveOperator(app, {
      runId: 'run-resume-diff-0001',
      planToken: resumed.body.planToken,
      steps: resumed.body.steps,
    });
    const confirmed = await confirmOperator(app, 'run-resume-diff-0001', { approvalToken });
    expect(confirmed.status).toBe(200);
    const advanced = await advanceOperator(app, 'run-resume-diff-0001');
    expect(advanced.body.status).toBe('completed');
  });

  it('resumes a goal-only held run (never planned) by planning from the goal', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const created = await runStore.create({
      runId: 'run-resume-goal-0001',
      ownerBinding: OPERATOR_BINDING,
      goal: GOAL,
      status: 'held',
      hold: { reason: 'awaiting_approval', resumeCondition: { kind: 'manual' }, heldSince: Date.now(), resumeAttempts: 0 },
      expiresAt: Date.now() + 10 * 60_000,
    });
    expect(created?.plan).toBeNull();

    const resumed = await resumeOperator(app, 'run-resume-goal-0001');
    expect(resumed.status).toBe(200);
    expect(resumed.body.planChanged).toBe(true);
    expect(resumed.body.planDiff.steps[0].change).toBe('added');
    expect(resumed.body.previousPlan).toBeNull();

    const approvalToken = await approveOperator(app, {
      runId: 'run-resume-goal-0001',
      planToken: resumed.body.planToken,
      steps: resumed.body.steps,
    });
    const confirmed = await confirmOperator(app, 'run-resume-goal-0001', { approvalToken });
    expect(confirmed.status).toBe(200);
    const advanced = await advanceOperator(app, 'run-resume-goal-0001');
    expect(advanced.body.status).toBe('completed');
  });

  it('keeps the run held when the goal can no longer be planned', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    await runStore.create({
      runId: 'run-resume-ambig-001',
      ownerBinding: OPERATOR_BINDING,
      goal: 'いい感じに進めて',
      status: 'held',
      hold: { reason: 'user_paused', resumeCondition: { kind: 'manual' }, heldSince: Date.now(), resumeAttempts: 0 },
      expiresAt: Date.now() + 10 * 60_000,
    });

    const resumed = await resumeOperator(app, 'run-resume-ambig-001');
    expect(resumed.status).toBe(422);
    expect(resumed.body.code).toBe('AGENT_TOOL_SELECTION_AMBIGUOUS');
    expect((await runStore.get('run-resume-ambig-001', OPERATOR_BINDING))?.status).toBe('held');
  });

  it('supports re-hold after resume (approval timeout conversion) and a second resume', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);
    await holdOperator(app, plan.runId, { reason: 'user_paused' });
    const firstResume = await resumeOperator(app, plan.runId);
    expect(firstResume.status).toBe(200);

    // The approval lapses unused: the run converts back to held with the
    // approval-timeout reason instead of vanishing.
    const reheld = await holdOperator(app, plan.runId, { reason: 'awaiting_approval' });
    expect(reheld.status).toBe(200);
    expect(reheld.body.run.hold.reason).toBe('awaiting_approval');

    const secondResume = await resumeOperator(app, plan.runId);
    expect(secondResume.status).toBe(200);
    expect(secondResume.body.status).toBe('awaiting_approval');
    // The second resume lands in the same confirm flow as the first one
    // (covered end to end by the confirm tests above).
    expect((await runStore.get(plan.runId, OPERATOR_BINDING))?.status).toBe('awaiting_approval');
  });

  it('rejects resume for non-held runs and confirm before resume', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const plan = await createQueuedRun(app);

    const resumedQueued = await resumeOperator(app, plan.runId);
    expect(resumedQueued.status).toBe(409);
    expect(resumedQueued.body.code).toBe('AGENT_RUN_NOT_HELD');

    const missing = await resumeOperator(app, 'run-does-not-exist-1');
    expect(missing.status).toBe(404);

    await holdOperator(app, plan.runId, { reason: 'user_paused' });
    const confirmHeld = await confirmOperator(app, plan.runId, { approvalToken: 'whatever' });
    expect(confirmHeld.status).toBe(409);
    expect(confirmHeld.body.code).toBe('AGENT_RUN_NOT_RESUMED');
  });

  it('runs the full cycle in browser mode with the plan capability as owner proof', async () => {
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
      .send({ runId: plan.runId, goal: GOAL, planToken: plan.planToken, approvalToken: approval.body.approvalToken, steps: plan.steps });
    expect(created.status).toBe(201);

    const held = await request(app).post(`/api/agent/v3/runs/${plan.runId}/hold`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken, reason: 'user_paused' });
    expect(held.status).toBe(200);
    expect(held.body.run.status).toBe('held');

    // Record access stays bound to the original plan capability; the
    // resume response carries the fresh capability for approval only.
    const resumed = await request(app).post(`/api/agent/v3/runs/${plan.runId}/resume`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken });
    expect(resumed.status).toBe(200);
    expect(resumed.body.planToken).not.toBe(plan.planToken);

    const freshApproval = await request(app).post('/api/agent/v3/browser-approval')
      .set(ORIGIN)
      .send({ runId: plan.runId, planToken: resumed.body.planToken, steps: resumed.body.steps, confirm: true });
    expect(freshApproval.status).toBe(201);

    const confirmed = await request(app).post(`/api/agent/v3/runs/${plan.runId}/resume/confirm`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken, approvalToken: freshApproval.body.approvalToken });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('queued');

    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken });
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe('completed');

    // The operator still cannot see the browser-owned run at any point.
    const operatorGet = await request(app).get(`/api/agent/v3/runs/${plan.runId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(operatorGet.status).toBe(404);
  });

  it('expires held runs through the same sweep as every other status', async () => {
    let now = Date.now();
    const runStore = new InMemoryAgentRunStore(() => now);
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore, runStore);
    const created = await runStore.create({
      runId: 'run-held-expiry-001',
      ownerBinding: OPERATOR_BINDING,
      goal: GOAL,
      status: 'held',
      hold: { reason: 'scheduled_time', resumeCondition: { kind: 'at_time', at: now + 60_000 }, heldSince: now, resumeAttempts: 0 },
      expiresAt: now + 120_000,
    }, now);
    expect(created?.status).toBe('held');
    expect(await runStore.markExpired()).toBe(0);

    now += 180_000;
    expect(await runStore.markExpired()).toBe(1);
    expect(await runStore.get('run-held-expiry-001', OPERATOR_BINDING)).toBeNull();

    // An expired hold never turns back into execution: reads hide it and
    // resume finds nothing.
    const fetched = await request(app).get('/api/agent/v3/runs/run-held-expiry-001')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.status).toBe(404);
    const resumed = await resumeOperator(app, 'run-held-expiry-001');
    expect(resumed.status).toBe(404);
  });

  it('returns 503 for hold, resume and confirm when no run store is configured', async () => {
    const { store: consumptionStore } = makeConsumptionStore();
    const app = appFor(env, consumptionStore);
    const plan = await planDocument(app);

    const held = await holdOperator(app, plan.runId, { reason: 'user_paused' });
    expect(held.status).toBe(503);
    expect(held.body.code).toBe('AGENT_RUN_STORE_UNAVAILABLE');
    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(503);
    const confirmed = await confirmOperator(app, plan.runId, { approvalToken: 'x' });
    expect(confirmed.status).toBe(503);
  });
});

describe('agent v3 resume of attachment-bound held runs (resume attachment support)', () => {
  const attachEnv = { ...env, ORIGIN_AGENT_ATTACHMENTS_ENABLED: 'true' } as NodeJS.ProcessEnv;
  const CLASSIFY_GOAL = '各行を分類してレポートを作成してください';
  const FRUITS = ['id,item,amount', 'A-1,りんご,120', 'A-2,みかん,80', 'A-3,ぶどう,300'].join('\n');

  function attachApp(
    runStore: InMemoryAgentRunStore,
    attachmentStore: InMemoryAgentAttachmentStore,
    modelCall?: AgentModelExecutor,
    testEnv: NodeJS.ProcessEnv = attachEnv,
  ) {
    const app = express();
    app.use(express.json());
    app.use(createAgentOrchestratorV3Router(testEnv, makeConsumptionStore().store, { runStore, attachmentStore, modelCall }));
    return app;
  }

  /** The F2 classifying executor, with a call counter: classifies each
   * CSV row in the chunk text it is actually given (amount >= 200 → 高額). */
  function makeClassifyingExecutor(calls: { count: number }): AgentModelExecutor {
    return async ({ userText }) => {
      calls.count += 1;
      const lines = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:'));
      const rows = lines.slice(1).map((line) => {
        const [id, item, amount] = line.split(',');
        return { id, item, amount, category: Number(amount) >= 200 ? '高額' : '通常' };
      });
      return { ok: true, text: JSON.stringify({ rows }) };
    };
  }

  async function createSetWithFile(app: express.Express, name: string, contentText: string): Promise<string> {
    const created = await request(app).post('/api/agent/v3/attachment-sets')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(created.status).toBe(201);
    const setId = created.body.attachmentSetId as string;
    const added = await request(app).post(`/api/agent/v3/attachment-sets/${setId}/files`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ name, mediaType: 'text/csv', contentText });
    expect(added.status).toBe(201);
    return setId;
  }

  async function planAttach(app: express.Express, setId: string): Promise<PlanBody> {
    const plan = await request(app).post('/api/agent/v3/plan')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ goal: CLASSIFY_GOAL, attachmentSetId: setId });
    expect(plan.status).toBe(201);
    return plan.body as PlanBody;
  }

  async function createAttachRun(app: express.Express, plan: PlanBody): Promise<void> {
    const approvalToken = await approveOperator(app, plan);
    const created = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: CLASSIFY_GOAL, planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(created.status).toBe(201);
    expect(created.body.run.status).toBe('queued');
  }

  const ANALYZER_BUNDLE = JSON.stringify({
    kind: 'data-analysis',
    content: ['id,item,amount,category', 'A-1,りんご,120,通常', 'A-2,みかん,80,通常', 'A-3,ぶどう,300,高額'].join('\n'),
    outputKind: 'rows',
    rows: [
      { id: 'A-1', item: 'りんご', amount: '120', category: '通常' },
      { id: 'A-2', item: 'みかん', amount: '80', category: '通常' },
      { id: 'A-3', item: 'ぶどう', amount: '300', category: '高額' },
    ],
    coverage: { totalChunks: 1, processedChunks: 1, keyCount: 3 },
    chunkRange: { offset: 0, count: 1 },
  });

  /** A claimed attachment run driven into held with the reader and
   * analyzer already completed and the analyzer's bundle persisted —
   * the production shape of a rate-limit hold landing mid-run. */
  async function heldAttachRunWithProgress() {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const calls = { count: 0 };
    const app = attachApp(runStore, attachmentStore, makeClassifyingExecutor(calls));
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planAttach(app, setId);
    await createAttachRun(app, plan);
    const stored = await runStore.get(plan.runId, OPERATOR_BINDING);
    expect(stored?.plan).toHaveLength(3);
    const lease = await runStore.claim(plan.runId, 'driver-resume-test', 300);
    expect(lease?.status).toBe('running');
    const progressed = await runStore.updateProgress(plan.runId, 'driver-resume-test', {
      stepsState: [
        { id: 'task-1', status: 'completed', attempts: 1 },
        { id: 'task-2', status: 'completed', attempts: 1 },
        { id: 'task-3', status: 'queued', attempts: 0 },
      ],
      artifacts: [{
        stepIndex: 1,
        stepFingerprint: computeAgentRunStepFingerprint(stored!.plan![1].toolName, stored!.plan![1].params),
        attempt: 1,
        artifact: ANALYZER_BUNDLE,
      }],
    });
    expect(progressed).toBe(true);
    const held = await runStore.finish(plan.runId, 'driver-resume-test', 'held', {
      reason: 'user_paused',
      resumeCondition: { kind: 'manual' },
      heldSince: Date.now(),
      resumeAttempts: 0,
    });
    expect(held?.status).toBe('held');
    return { app, runStore, attachmentStore, plan, calls };
  }

  it('resumes an attachment-bound held run with planChanged false and step progress preserved', async () => {
    const { app, runStore, plan } = await heldAttachRunWithProgress();
    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe('awaiting_approval');
    expect(resumed.body.planChanged).toBe(false);
    expect(resumed.body.run.stepsState).toEqual([
      { id: 'task-1', status: 'completed', attempts: 1 },
      { id: 'task-2', status: 'completed', attempts: 1 },
      { id: 'task-3', status: 'queued', attempts: 0 },
    ]);
    expect((await runStore.get(plan.runId, OPERATOR_BINDING))?.status).toBe('awaiting_approval');
  });

  it('confirms and completes without re-executing the hydrated analyzer step', async () => {
    const { app, runStore, attachmentStore, plan, calls } = await heldAttachRunWithProgress();
    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(200);
    const approvalToken = await approveOperator(app, {
      runId: plan.runId,
      planToken: resumed.body.planToken,
      steps: resumed.body.steps,
    });
    const confirmed = await confirmOperator(app, plan.runId, { approvalToken });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('queued');

    process.env.ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED = 'true';
    try {
      // A fresh router instance over the same stores: the shared POST
      // limiter's burst bucket is per-instance, and this flow has
      // already spent it on setup.
      const advanceApp = attachApp(runStore, attachmentStore, makeClassifyingExecutor(calls));
      const advanced = await advanceOperator(advanceApp, plan.runId);
      expect(advanced.status).toBe(200);
      expect(advanced.body.status).toBe('completed');
      // The analyzer never ran again: its persisted bundle was hydrated
      // (fingerprint + attempt match), so the model port saw no call.
      expect(calls.count).toBe(0);
      const artifact = JSON.parse(advanced.body.artifact) as { content?: string };
      expect(artifact.content).toContain('A-3,ぶどう,300,高額');
    } finally {
      delete process.env.ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED;
    }
  });

  it('answers 409 AGENT_ATTACHMENT_UNAVAILABLE when the bound set was deleted, leaving plan and hold untouched', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = attachApp(runStore, attachmentStore, makeClassifyingExecutor({ count: 0 }));
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planAttach(app, setId);
    await createAttachRun(app, plan);
    const held = await holdOperator(app, plan.runId, { reason: 'user_paused' });
    expect(held.status).toBe(200);
    const before = await runStore.get(plan.runId, OPERATOR_BINDING);

    expect(await attachmentStore.deleteSet(setId, OPERATOR_BINDING)).toBe(true);
    const resumed = await resumeOperator(app, plan.runId);
    expect(resumed.status).toBe(409);
    expect(resumed.body.code).toBe('AGENT_ATTACHMENT_UNAVAILABLE');
    const after = await runStore.get(plan.runId, OPERATOR_BINDING);
    expect(after?.status).toBe('held');
    expect(after?.plan).toEqual(before?.plan);
    expect(after?.planDigest).toBe(before?.planDigest);
  });

  it('fails closed with the same 409 when the attachments switch is off at resume time', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = attachApp(runStore, attachmentStore, makeClassifyingExecutor({ count: 0 }));
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planAttach(app, setId);
    await createAttachRun(app, plan);
    await holdOperator(app, plan.runId, { reason: 'user_paused' });

    const offApp = attachApp(runStore, attachmentStore, undefined, env);
    const resumed = await resumeOperator(offApp, plan.runId);
    expect(resumed.status).toBe(409);
    expect(resumed.body.code).toBe('AGENT_ATTACHMENT_UNAVAILABLE');
    // No goal-only plan is presented in place of the data-bound one.
    expect(resumed.body.steps).toBeUndefined();
    expect((await runStore.get(plan.runId, OPERATOR_BINDING))?.status).toBe('held');
  });

  it('answers 422 AGENT_ATTACHMENT_TOO_LARGE when the bound set outgrew the plan ceilings', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = attachApp(runStore, attachmentStore, makeClassifyingExecutor({ count: 0 }));
    const bigSetId = 'att-12345678-abcd-4ef0-9abc-def012345678';
    // Prose chunking splits on blank lines: 180 paragraphs of 1,000
    // chars pack three to a 3,500-char chunk — 60 chunks, over the 48 cap.
    const bigText = Array.from({ length: 180 }, () => 'あ'.repeat(1000)).join('\n\n');
    await attachmentStore.createSet({
      setId: bigSetId,
      ownerBinding: OPERATOR_BINDING,
      uploadTokenDigest: createHash('sha256').update('upload-token').digest('hex'),
      expiresAt: Date.now() + 3_600_000,
    });
    await attachmentStore.addFile(bigSetId, OPERATOR_BINDING, {
      name: 'big.txt',
      mediaType: 'text/plain',
      kind: 'text',
      ...validateAgentAttachmentFileText(bigText),
      extractedText: bigText,
    });
    await runStore.create({
      runId: 'run-resume-toolarge-1',
      ownerBinding: OPERATOR_BINDING,
      goal: CLASSIFY_GOAL,
      status: 'held',
      plan: [{ toolName: 'attachment_reader', params: { attachmentSetId: bigSetId, setDigest: 'e'.repeat(64) }, dependsOn: [] }],
      planDigest: 'd'.repeat(64),
      stepsState: [{ id: 'task-1', status: 'queued', attempts: 0 }],
      hold: { reason: 'user_paused', resumeCondition: { kind: 'manual' }, heldSince: Date.now(), resumeAttempts: 0 },
      expiresAt: Date.now() + 3_600_000,
    });
    const resumed = await resumeOperator(app, 'run-resume-toolarge-1');
    expect(resumed.status).toBe(422);
    expect(resumed.body.code).toBe('AGENT_ATTACHMENT_TOO_LARGE');
    expect(resumed.body.limitKind).toBe('chunks');
    expect(resumed.body.limit).toBe(48);
    expect(resumed.body.chunkCount).toBeGreaterThan(48);
    expect((await runStore.get('run-resume-toolarge-1', OPERATOR_BINDING))?.status).toBe('held');
  });

  it('never reads the attachment store for goal-only runs (piggyback and manual resume regression)', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const getSetSpy = vi.spyOn(attachmentStore, 'getSet');
    const app = attachApp(runStore, attachmentStore, makeClassifyingExecutor({ count: 0 }));

    // Piggyback path: a goal-only held run whose at_time condition is
    // already due advances on the next owner read, exactly as before.
    const plan = await planDocument(app);
    const approvalToken = await approveOperator(app, plan);
    const created = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.runId, goal: GOAL, planToken: plan.planToken, approvalToken, steps: plan.steps });
    expect(created.status).toBe(201);
    const queued = await runStore.get(plan.runId, OPERATOR_BINDING);
    const heldRecord = await runStore.transition({
      runId: plan.runId,
      ownerBinding: OPERATOR_BINDING,
      expectedStatus: 'queued',
      expectedVersion: queued!.version,
      nextStatus: 'held',
      hold: {
        reason: 'scheduled_time',
        resumeCondition: { kind: 'at_time', at: Date.now() - 1000 },
        heldSince: Date.now() - 1000,
        resumeAttempts: 0,
      },
    });
    expect(heldRecord?.status).toBe('held');
    const fetched = await request(app).get(`/api/agent/v3/runs/${plan.runId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.run.status).toBe('awaiting_approval');
    expect(getSetSpy).not.toHaveBeenCalled();

    // Manual resume path: same guarantee for a plainly held run.
    const plan2 = await planDocument(app);
    const approval2 = await approveOperator(app, plan2);
    const created2 = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan2.runId, goal: GOAL, planToken: plan2.planToken, approvalToken: approval2, steps: plan2.steps });
    expect(created2.status).toBe(201);
    await holdOperator(app, plan2.runId, { reason: 'user_paused' });
    const resumed = await resumeOperator(app, plan2.runId);
    expect(resumed.status).toBe(200);
    expect(resumed.body.planChanged).toBe(false);
    expect(getSetSpy).not.toHaveBeenCalled();
  });
});
