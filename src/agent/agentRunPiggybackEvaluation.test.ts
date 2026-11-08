// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import {
  AGENT_RUN_MAX_AUTO_RESUME_ATTEMPTS,
  evaluateAgentRunPiggyback,
  type AgentRunReplanPort,
} from './agentRunPiggybackEvaluation.js';
import {
  AGENT_RUN_APPROVAL_LAPSE_MS,
  type AgentRunHold,
  type AgentRunPlanStep,
  type CreateAgentRunInput,
} from './agentRunRecord.js';

const OWNER = 'a'.repeat(64);
const OTHER_OWNER = 'c'.repeat(64);
const DIGEST = 'd'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;
// Mid-month, so the Tavily UTC-month quota window attribution is unambiguous.
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);

const searchPlan: AgentRunPlanStep[] = [
  { toolName: 'web_search_grounding', params: { query: 'sales report' }, dependsOn: [] },
];
const localPlan: AgentRunPlanStep[] = [
  { toolName: 'repository_explorer', params: {}, dependsOn: [] },
];

/** Re-plan port whose output is byte-identical to the stored search plan. */
const unchangedReplan: AgentRunReplanPort = {
  replan: () => ({
    steps: [{ toolName: 'web_search_grounding', params: { query: 'sales report' } }],
    plan: searchPlan,
    planDigest: DIGEST,
  }),
};
const unchangedLocalReplan: AgentRunReplanPort = {
  replan: () => ({
    steps: [{ toolName: 'repository_explorer', params: {} }],
    plan: localPlan,
    planDigest: DIGEST,
  }),
};
const changedReplan: AgentRunReplanPort = {
  replan: () => ({
    steps: [{ toolName: 'web_search_grounding', params: { query: 'something else' } }],
    plan: [{ toolName: 'web_search_grounding', params: { query: 'something else' }, dependsOn: [] }],
    planDigest: 'e'.repeat(64),
  }),
};
const failingReplan: AgentRunReplanPort = { replan: () => null };

function makeClock(start = T0) {
  const clock = { now: start };
  return { clock, store: new InMemoryAgentRunStore(() => clock.now) };
}

function heldInput(overrides: Partial<CreateAgentRunInput> = {}): CreateAgentRunInput {
  return {
    runId: 'run-eval-00000001',
    ownerBinding: OWNER,
    goal: 'Research the sales report',
    status: 'held',
    plan: searchPlan,
    planDigest: DIGEST,
    stepsState: [{ id: 'task-1', status: 'queued', attempts: 0 }],
    hold: {
      reason: 'scheduled_time',
      resumeCondition: { kind: 'at_time', at: T0 - 60_000 },
      heldSince: T0 - 3_600_000,
      resumeAttempts: 0,
    },
    expiresAt: T0 + 7 * DAY_MS,
    ...overrides,
  };
}

describe('evaluateAgentRunPiggyback at_time conditions', () => {
  it('leaves a run held until its scheduled time arrives', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput({
      hold: { reason: 'scheduled_time', resumeCondition: { kind: 'at_time', at: T0 + 60_000 }, heldSince: T0 - 1000, resumeAttempts: 0 },
    }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.notReady).toEqual(['run-eval-00000001']);
    expect(summary.advanced).toEqual([]);
    expect((await store.get('run-eval-00000001', OWNER))?.status).toBe('held');
  });

  it('advances a due run only to awaiting_approval — never to queued or running (design §8)', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput(), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.advanced).toEqual(['run-eval-00000001']);
    const record = await store.get('run-eval-00000001', OWNER);
    expect(record?.status).toBe('awaiting_approval');
    expect(record?.hold).toBeNull();
    // The approval window restarts from the evaluation instant.
    expect(record?.approvalDeadlineAt).toBe(clock.now + AGENT_RUN_APPROVAL_LAPSE_MS);
    // Not claimable: no driver can pick the run up without the human
    // resume/confirm flow producing a fresh approval first.
    await expect(store.claim('run-eval-00000001', 'driver-eval-1', 120)).resolves.toBeNull();
  });

  it('keeps a run held when the current planner would change the plan (the diff belongs to manual resume)', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput(), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: changedReplan }, OWNER, clock.now);
    expect(summary.planChanged).toEqual(['run-eval-00000001']);
    const record = await store.get('run-eval-00000001', OWNER);
    expect(record?.status).toBe('held');
    expect(record?.plan).toEqual(searchPlan);
  });

  it('keeps a run held when the goal can no longer be planned', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput(), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: failingReplan }, OWNER, clock.now);
    expect(summary.plannerFailed).toEqual(['run-eval-00000001']);
    expect((await store.get('run-eval-00000001', OWNER))?.status).toBe('held');
  });

  it('never pre-plans a goal-only held run (its first plan is presented by manual resume)', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput({ plan: null, planDigest: null, stepsState: [] }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.unplanned).toEqual(['run-eval-00000001']);
    expect((await store.get('run-eval-00000001', OWNER))?.status).toBe('held');
  });
});

describe('evaluateAgentRunPiggyback quota_reset conditions', () => {
  async function seedUsage(store: InMemoryAgentRunStore, credits: number, now: number) {
    await store.create({
      runId: 'run-eval-usage-01',
      ownerBinding: OWNER,
      goal: 'Earlier work',
      status: 'queued',
      plan: searchPlan,
      planDigest: DIGEST,
      quotaLedger: { tavily: { credits } },
      expiresAt: now + 7 * DAY_MS,
    }, now);
  }
  const quotaHold = (resumeAttempts = 0): AgentRunHold => ({
    reason: 'quota_exhausted',
    resumeCondition: { kind: 'quota_reset', provider: 'tavily', resetAt: T0 - 60_000 },
    heldSince: T0 - 3_600_000,
    resumeAttempts,
  });

  it('judges by the real ledger, not the reset estimate: still exhausted means still held', async () => {
    const { clock, store } = makeClock();
    await seedUsage(store, 800, clock.now);
    await store.create(heldInput({ hold: quotaHold() }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.notReady).toEqual(['run-eval-00000001']);
    expect((await store.get('run-eval-00000001', OWNER))?.status).toBe('held');
  });

  it('advances when the window has room again, even if the estimated reset is still ahead', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput({
      hold: { ...quotaHold(), resumeCondition: { kind: 'quota_reset', provider: 'tavily', resetAt: T0 + 3_600_000 } },
    }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.advanced).toEqual(['run-eval-00000001']);
  });

  it('simulates the whole pending plan: two search steps need two credits of headroom', async () => {
    const { clock, store } = makeClock();
    await seedUsage(store, 799, clock.now);
    const twoSearchPlan: AgentRunPlanStep[] = [
      { toolName: 'web_search_grounding', params: { query: 'one' }, dependsOn: [] },
      { toolName: 'web_search_grounding', params: { query: 'two' }, dependsOn: [0] },
    ];
    await store.create(heldInput({
      plan: twoSearchPlan,
      stepsState: [
        { id: 'task-1', status: 'queued', attempts: 0 },
        { id: 'task-2', status: 'queued', attempts: 0 },
      ],
      hold: quotaHold(),
    }), clock.now);
    const blocked = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(blocked.notReady).toEqual(['run-eval-00000001']);
  });

  it('does not let a charged later step hide behind a local first step', async () => {
    const { clock, store } = makeClock();
    await seedUsage(store, 800, clock.now);
    const mixedPlan: AgentRunPlanStep[] = [
      { toolName: 'repository_explorer', params: {}, dependsOn: [] },
      { toolName: 'web_search_grounding', params: { query: 'sales report' }, dependsOn: [0] },
    ];
    await store.create(heldInput({
      plan: mixedPlan,
      stepsState: [
        { id: 'task-1', status: 'queued', attempts: 0 },
        { id: 'task-2', status: 'queued', attempts: 0 },
      ],
      hold: quotaHold(),
    }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.notReady).toEqual(['run-eval-00000001']);
  });

  it('advances a quota-held run whose pending steps are all local (quota never blocked it)', async () => {
    const { clock, store } = makeClock();
    await seedUsage(store, 800, clock.now);
    await store.create(heldInput({ plan: localPlan, hold: quotaHold() }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedLocalReplan }, OWNER, clock.now);
    expect(summary.advanced).toEqual(['run-eval-00000001']);
  });
});

describe('evaluateAgentRunPiggyback attempt cap (design §8.6)', () => {
  it('stops evaluating a hold at the cap and leaves it to a human', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput({
      runId: 'run-eval-capped-01',
      hold: { reason: 'scheduled_time', resumeCondition: { kind: 'at_time', at: T0 - 1000 }, heldSince: T0 - 1000, resumeAttempts: AGENT_RUN_MAX_AUTO_RESUME_ATTEMPTS },
    }), clock.now);
    await store.create(heldInput({
      runId: 'run-eval-almost-01',
      hold: { reason: 'scheduled_time', resumeCondition: { kind: 'at_time', at: T0 - 1000 }, heldSince: T0 - 1000, resumeAttempts: AGENT_RUN_MAX_AUTO_RESUME_ATTEMPTS - 1 },
    }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.capped).toEqual(['run-eval-capped-01']);
    expect(summary.advanced).toEqual(['run-eval-almost-01']);
    expect((await store.get('run-eval-capped-01', OWNER))?.status).toBe('held');
  });

  it('counts an approval lapse after an auto-advance as a failed attempt, then terminates the loop', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput({
      hold: { reason: 'quota_exhausted', resumeCondition: { kind: 'quota_reset', provider: 'tavily' }, heldSince: T0 - 1000, resumeAttempts: 0 },
    }), clock.now);
    const first = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(first.advanced).toEqual(['run-eval-00000001']);
    // Nobody approves; the approval window (12 minutes) lapses.
    clock.now += AGENT_RUN_APPROVAL_LAPSE_MS + 60_000;
    const second = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(second.approvalTimeouts).toEqual(['run-eval-00000001']);
    const record = await store.get('run-eval-00000001', OWNER);
    expect(record?.status).toBe('held');
    expect(record?.hold).toMatchObject({
      reason: 'awaiting_approval',
      resumeCondition: { kind: 'manual' },
      resumeAttempts: 1,
    });
    expect(record?.priorResumeAttempts).toBe(1);
    // The converted hold is manual: later passes never touch it again.
    const third = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(third.advanced).toEqual([]);
    expect(third.skippedCondition).toEqual(['run-eval-00000001']);
  });
});

describe('evaluateAgentRunPiggyback approval-timeout conversion', () => {
  it('converts a lapsed awaiting_approval run and leaves a live one alone', async () => {
    const { clock, store } = makeClock();
    await store.create({
      runId: 'run-eval-lapsed-01',
      ownerBinding: OWNER,
      goal: 'Research the sales report',
      status: 'awaiting_approval',
      plan: searchPlan,
      planDigest: DIGEST,
      approvalDeadlineAt: T0 - 1000,
      expiresAt: T0 + 7 * DAY_MS,
    }, clock.now);
    await store.create({
      runId: 'run-eval-live-0001',
      ownerBinding: OWNER,
      goal: 'Research the sales report',
      status: 'awaiting_approval',
      plan: searchPlan,
      planDigest: DIGEST,
      approvalDeadlineAt: T0 + 60_000,
      expiresAt: T0 + 7 * DAY_MS,
    }, clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.approvalTimeouts).toEqual(['run-eval-lapsed-01']);
    const converted = await store.get('run-eval-lapsed-01', OWNER);
    expect(converted?.status).toBe('held');
    expect(converted?.hold?.reason).toBe('awaiting_approval');
    // First hold of a never-held run: the failed-resume count starts at 0.
    expect(converted?.hold?.resumeAttempts).toBe(0);
    expect(converted?.approvalDeadlineAt).toBeNull();
    expect((await store.get('run-eval-live-0001', OWNER))?.status).toBe('awaiting_approval');
  });
});

describe('evaluateAgentRunPiggyback scoping and robustness', () => {
  it('skips manual, dependency and condition holds without judging them', async () => {
    const { clock, store } = makeClock();
    const holds: Array<[string, AgentRunHold]> = [
      ['run-eval-manual-01', { reason: 'user_paused', resumeCondition: { kind: 'manual' }, heldSince: T0 - 1000, resumeAttempts: 0 }],
      ['run-eval-depend-01', { reason: 'dependency_wait', resumeCondition: { kind: 'dependency', targetKind: 'run', targetId: 'run-eval-manual-01' }, heldSince: T0 - 1000, resumeAttempts: 0 }],
      ['run-eval-cond-0001', { reason: 'condition_wait', resumeCondition: { kind: 'condition', conditionRef: 'watch:price' }, heldSince: T0 - 1000, resumeAttempts: 0 }],
    ];
    for (const [runId, hold] of holds) {
      await store.create(heldInput({ runId, hold }), clock.now);
    }
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.skippedCondition.sort()).toEqual(['run-eval-cond-0001', 'run-eval-depend-01', 'run-eval-manual-01']);
    expect(summary.advanced).toEqual([]);
  });

  it('evaluates only the given owner and processes higher priorities first', async () => {
    const { clock, store } = makeClock();
    await store.create(heldInput({ runId: 'run-eval-low-00001', priority: 1 }), clock.now);
    await store.create(heldInput({ runId: 'run-eval-high-0001', priority: 9 }), clock.now);
    await store.create(heldInput({ runId: 'run-eval-other-001', ownerBinding: OTHER_OWNER }), clock.now);
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: unchangedReplan }, OWNER, clock.now);
    expect(summary.advanced).toEqual(['run-eval-high-0001', 'run-eval-low-00001']);
    expect((await store.get('run-eval-other-001', OTHER_OWNER))?.status).toBe('held');
  });

  it('reports a lost transition race as contended and a throwing re-plan as an isolated error', async () => {
    const { clock } = makeClock();
    class RaceStore extends InMemoryAgentRunStore {
      async transition(): Promise<null> {
        return null;
      }
    }
    const raceStore = new RaceStore(() => clock.now);
    await raceStore.create(heldInput({ runId: 'run-eval-race-0001' }), clock.now);
    const race = await evaluateAgentRunPiggyback({ runStore: raceStore, replan: unchangedReplan }, OWNER, clock.now);
    expect(race.contended).toEqual(['run-eval-race-0001']);
    expect(race.advanced).toEqual([]);
    expect((await raceStore.get('run-eval-race-0001', OWNER))?.status).toBe('held');

    const { store } = makeClock();
    await store.create(heldInput({ runId: 'run-eval-boom-0001', goal: 'Research the boom report' }), clock.now);
    await store.create(heldInput({ runId: 'run-eval-fine-0001' }), clock.now);
    const explodingReplan: AgentRunReplanPort = {
      replan: (goal) => {
        if (goal.includes('boom')) throw new Error('planner exploded');
        return unchangedReplan.replan(goal);
      },
    };
    const summary = await evaluateAgentRunPiggyback({ runStore: store, replan: explodingReplan }, OWNER, clock.now);
    expect(summary.errors).toEqual(['run-eval-boom-0001']);
    // One run's failure never stops the rest of the pass.
    expect(summary.advanced).toEqual(['run-eval-fine-0001']);
  });
});
