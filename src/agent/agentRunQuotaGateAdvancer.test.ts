// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { advanceAgentRun } from './agentRunAdvancer.js';
import { agentRunQuotaWindow } from './agentRunQuotaGate.js';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import type { AgentRunQuotaLedger, AgentRunRecord, AgentRunStore } from './agentRunRecord.js';
import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

const OWNER = createHash('sha256').update('quota-gate-test-owner').digest('hex');
const OPERATOR_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');
const DAY_MS = 24 * 60 * 60 * 1_000;

function makeConsumptionStore(available = true) {
  const consumed = new Set<string>();
  const store: AgentRunConsumptionStore = {
    consume: vi.fn(async (runId: string) => {
      if (!available || consumed.has(runId)) return false;
      consumed.add(runId);
      return true;
    }),
  };
  return { store, consumed };
}

function makeRunTool(artifacts: Partial<Record<ToolName, string>> = {}) {
  return vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => ({
    ok: true,
    tool: name,
    artifact: artifacts[name] ?? `artifact:${name}`,
    message: 'ok',
  }));
}

const okVerifier = async (artifact: string) => ({ ok: true, artifact, attempts: 0 });

async function seedRun(
  store: AgentRunStore,
  runId: string,
  steps: Array<{ toolName: ToolName; params?: ToolParams }>,
  options: { ownerBinding?: string; quotaLedger?: AgentRunQuotaLedger } = {},
): Promise<AgentRunRecord> {
  const created = await store.create({
    runId,
    ownerBinding: options.ownerBinding ?? OWNER,
    goal: 'Quota gate test goal',
    status: 'queued',
    plan: steps.map((step, index) => ({
      toolName: step.toolName,
      params: step.params ?? {},
      dependsOn: index === 0 ? [] : [index - 1],
    })),
    planDigest: createHash('sha256').update(`plan:${runId}`).digest('hex'),
    stepsState: steps.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
    quotaLedger: options.quotaLedger,
    expiresAt: Date.now() + DAY_MS,
  });
  if (!created) throw new Error('seed failed');
  return created;
}

describe('advanceAgentRun quota gate', () => {
  it('journals one tavily credit per executed search step alongside the reservation', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, 'run-quota-journal-01', [
      { toolName: 'web_search_grounding', params: { query: 'first' } },
      { toolName: 'web_search_grounding', params: { query: 'second' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(2);
    const record = await store.get('run-quota-journal-01', OWNER);
    expect(record?.quotaLedger.tavily?.credits).toBe(2);
    expect(record?.quotaLedger.origin?.execution_reserved).toBe(1);
  });

  it('holds the run before executing when the provider window is already exhausted', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    await seedRun(store, 'run-quota-prior-01', [{ toolName: 'repository_explorer' }], {
      quotaLedger: { tavily: { credits: 800 } },
    });
    const seeded = await seedRun(store, 'run-quota-blocked-01', [
      { toolName: 'web_search_grounding', params: { query: 'blocked' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('held');
    if (outcome.kind !== 'held') throw new Error('expected held');
    expect(outcome.provider).toBe('tavily');
    expect(outcome.resetAt).toBe(agentRunQuotaWindow('utc-month', Date.now()).resetsAt);
    expect(runTool).not.toHaveBeenCalled();
    const record = await store.get('run-quota-blocked-01', OWNER);
    expect(record?.status).toBe('held');
    expect(record?.hold).toMatchObject({
      reason: 'quota_exhausted',
      resumeCondition: { kind: 'quota_reset', provider: 'tavily' },
      resumeAttempts: 0,
    });
    expect(record?.stepsState[0]?.status).toBe('queued');

    // A held record is never advanced directly (design §8): it must be
    // resumed and re-approved first.
    const again = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      record!,
      'driver-alpha-01',
    );
    expect(again.kind).toBe('not_runnable');
    expect(runTool).not.toHaveBeenCalled();
  });

  it('holds mid-run at the step boundary when the window runs out', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    await seedRun(store, 'run-quota-prior-02', [{ toolName: 'repository_explorer' }], {
      quotaLedger: { tavily: { credits: 799 } },
    });
    const seeded = await seedRun(store, 'run-quota-midrun-01', [
      { toolName: 'web_search_grounding', params: { query: 'fits' } },
      { toolName: 'web_search_grounding', params: { query: 'does not fit' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('held');
    expect(runTool).toHaveBeenCalledTimes(1);
    const record = await store.get('run-quota-midrun-01', OWNER);
    expect(record?.status).toBe('held');
    expect(record?.stepsState.map((step) => step.status)).toEqual(['completed', 'queued']);
    expect(record?.quotaLedger.tavily?.credits).toBe(1);
    expect(record?.hold?.reason).toBe('quota_exhausted');
  });

  it('never gates local-only plans, even with an exhausted search window', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    await seedRun(store, 'run-quota-prior-03', [{ toolName: 'repository_explorer' }], {
      quotaLedger: { tavily: { credits: 800 } },
    });
    const seeded = await seedRun(store, 'run-quota-local-01', [
      { toolName: 'repository_explorer' },
      { toolName: 'document_generator', params: { title: 'Local only' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(2);
    const record = await store.get('run-quota-local-01', OWNER);
    expect(record?.quotaLedger.tavily).toBeUndefined();
  });

  it('journals the charge of a search step whose verification then fails', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedRun(store, 'run-quota-failed-01', [
      { toolName: 'web_search_grounding', params: { query: 'spent anyway' } },
    ]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore,
        runTool: makeRunTool(),
        verifyArtifact: async (artifact) => ({ ok: false, artifact, attempts: 1 }),
      },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'ARTIFACT_VERIFICATION_FAILED' });
    const record = await store.get('run-quota-failed-01', OWNER);
    expect(record?.quotaLedger.tavily?.credits).toBe(1);
  });

  it('serializes delegated jobs to one per advance without inventing a charge', async () => {
    let clock = Date.now();
    const store = new InMemoryAgentRunStore(() => clock);
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, 'run-quota-delegated-01', [
      { toolName: 'code_interpreter', params: { task: 'first job' } },
      { toolName: 'code_interpreter', params: { task: 'second job' } },
    ]);
    const deps = {
      runStore: store,
      consumptionStore,
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
    };

    const first = await advanceAgentRun(deps, seeded, 'driver-alpha-01', { leaseSeconds: 30 });
    expect(first.kind).toBe('progress');
    expect(runTool).toHaveBeenCalledTimes(1);
    const midway = await store.get('run-quota-delegated-01', OWNER);
    expect(midway?.stepsState.map((step) => step.status)).toEqual(['completed', 'queued']);
    // No numeric quota was fabricated for the delegated job.
    expect(midway?.quotaLedger.openrouter).toBeUndefined();

    clock += 31_000;
    const recovered = await store.recoverStale('run-quota-delegated-01');
    expect(recovered?.status).toBe('queued');
    const second = await advanceAgentRun(deps, recovered!, 'driver-beta-02', { leaseSeconds: 30 });
    expect(second.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(2);
  });
});

describe('runs API quota gate surface', () => {
  const SECRET = 'test-only-'.repeat(5);
  const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };

  it('reports a quota-blocked advance as held, never as failed', async () => {
    const runStore = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    await seedRun(runStore, 'run-api-quota-prior', [{ toolName: 'repository_explorer' }], {
      ownerBinding: OPERATOR_BINDING,
      quotaLedger: { tavily: { credits: 800 } },
    });
    await seedRun(runStore, 'run-api-quota-target', [
      { toolName: 'web_search_grounding', params: { query: 'needs quota' } },
    ], { ownerBinding: OPERATOR_BINDING });

    const app = express();
    app.use(express.json());
    app.use(createAgentOrchestratorV3Router(env, consumptionStore, { runStore }));

    const advanced = await request(app).post('/api/agent/v3/runs/run-api-quota-target/advance')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});

    expect(advanced.status).toBe(202);
    expect(advanced.body.ok).toBe(true);
    expect(advanced.body.status).toBe('held');
    expect(advanced.body.code).toBe('AGENT_RUN_QUOTA_EXHAUSTED');
    expect(advanced.body.quota.provider).toBe('tavily');
    expect(advanced.body.run.hold).toMatchObject({
      reason: 'quota_exhausted',
      resumeCondition: { kind: 'quota_reset', provider: 'tavily' },
    });
    expect(JSON.stringify(advanced.body)).not.toContain(OPERATOR_BINDING);
  });
});
