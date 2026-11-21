import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { advanceAgentRun, stepArtifactPersistIndexes } from './agentRunAdvancer.js';
import {
  computeAgentRunStepFingerprint,
  type AgentRunRecord,
  type AgentRunStore,
} from './agentRunRecord.js';
import type { AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

/**
 * Step-artifact persistence, PR-2 (design AGENT_STEP_ARTIFACT_
 * PERSISTENCE_2026-11-22 §4/§6): the advancer saves the artifacts a
 * later step consumes with the completing step's fenced progress
 * write, hydrates them at the next advance's start (fingerprint +
 * attempt must match), and may stop between a producer and its
 * consumer once the artifact is persisted. OFF — the default — keeps
 * the pre-persistence behavior exactly.
 */

const OWNER = createHash('sha256').update('step-artifacts-advancer-owner').digest('hex');
const RUN_ID = 'run-step-artifacts-0001';
const DAY_MS = 24 * 60 * 60 * 1_000;
const LEASE_SECONDS = 30;

function makeConsumptionStore() {
  const consumed = new Set<string>();
  const store: AgentRunConsumptionStore = {
    consume: vi.fn(async (runId: string) => {
      if (consumed.has(runId)) return false;
      consumed.add(runId);
      return true;
    }),
  };
  return store;
}

const okVerifier = async (artifact: string) => ({ ok: true, artifact, attempts: 0 });

type PlanStepSpec = { toolName: ToolName; params?: ToolParams };

async function seedRun(
  store: AgentRunStore,
  clock: number,
  steps: PlanStepSpec[],
  stepsState?: AgentRunRecord['stepsState'],
): Promise<AgentRunRecord> {
  const created = await store.create({
    runId: RUN_ID,
    ownerBinding: OWNER,
    goal: 'Step-artifact persistence test goal',
    status: 'queued',
    plan: steps.map((step, index) => ({
      toolName: step.toolName,
      params: step.params ?? {},
      dependsOn: index === 0 ? [] : [index - 1],
    })),
    planDigest: createHash('sha256').update(`plan:${RUN_ID}`).digest('hex'),
    stepsState: stepsState ?? steps.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
    expiresAt: clock + DAY_MS,
  });
  if (!created) throw new Error('seed failed');
  return created;
}

/** Drives one advance, then lets the driver's lease lapse so the next
 * advance can claim the record — the production resumption shape. */
async function advanceAndLapse(
  store: InMemoryAgentRunStore,
  deps: Parameters<typeof advanceAgentRun>[0],
  snapshot: AgentRunRecord,
  driverId: string,
  lapse: () => void,
  budgetMs = 50,
) {
  const outcome = await advanceAgentRun(deps, snapshot, driverId, { budgetMs, leaseSeconds: LEASE_SECONDS });
  lapse();
  await store.recoverStale(RUN_ID);
  const next = await store.get(RUN_ID, OWNER);
  return { outcome, next };
}

const chainPlan: PlanStepSpec[] = [
  { toolName: 'file_reader', params: { path: 'notes.txt' } },
  { toolName: 'document_generator', params: { contentFromStep: 0 } },
];

function makeChainTool(calls: Array<{ name: ToolName; input: ToolParams }>) {
  return vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
    calls.push({ name, input });
    if (name === 'file_reader') return { ok: true, tool: name, artifact: 'FILE TEXT', message: 'ok' };
    if (name === 'document_generator') {
      return { ok: true, tool: name, artifact: JSON.stringify({ content: `doc:${String(input.content)}` }), message: 'ok' };
    }
    return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
  });
}

describe('stepArtifactPersistIndexes (design §4.2 selectivity)', () => {
  it('selects named producers and every textual producer before a legacy marker', () => {
    const plan = [
      { toolName: 'repository_explorer' as ToolName, params: {}, dependsOn: [] },
      { toolName: 'file_reader' as ToolName, params: {}, dependsOn: [0] },
      { toolName: 'attachment_analyzer' as ToolName, params: { chunkOffset: 0, chunkCount: 4 }, dependsOn: [1] },
      { toolName: 'attachment_analyzer' as ToolName, params: { chunkOffset: 4, chunkCount: 4, contentFromStep: 2 }, dependsOn: [2] },
      { toolName: 'document_generator' as ToolName, params: { contentFromPreviousArtifact: true }, dependsOn: [3] },
    ];
    // contentFromStep selects step 2; the legacy marker on step 4
    // selects every textual producer before it (1, 2, 3) — but not the
    // repository_explorer, whose artifact has no textual form.
    expect([...stepArtifactPersistIndexes(plan)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('selects nothing when no step consumes an earlier artifact', () => {
    const plan = [
      { toolName: 'file_reader' as ToolName, params: {}, dependsOn: [] },
      { toolName: 'repository_explorer' as ToolName, params: {}, dependsOn: [0] },
    ];
    expect(stepArtifactPersistIndexes(plan).size).toBe(0);
  });
});

describe('advanceAgentRun with step-artifact persistence OFF (default)', () => {
  it('saves nothing and a consumer whose producer finished in an earlier advance still fails closed', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeChainTool(calls);
    // The midway state the pre-persistence world produces: step 0
    // completed in an earlier advance, its artifact gone with it.
    const seeded = await seedRun(store, clock, chainPlan, [
      { id: 'task-1', status: 'completed', attempts: 1, artifactRef: 'task-1', summary: 'completed:file_reader' },
      { id: 'task-2', status: 'queued', attempts: 0 },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore: makeConsumptionStore(), runTool, verifyArtifact: okVerifier, now: () => clock },
      seeded,
      'driver-off-01',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({ errorCode: 'AGENT_STEP_INPUT_UNAVAILABLE' });
    expect(calls.some((call) => call.name === 'document_generator')).toBe(false);
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);
  });

  it('saves nothing even when the whole chain completes in one advance', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeChainTool(calls);
    const seeded = await seedRun(store, clock, chainPlan);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore: makeConsumptionStore(), runTool, verifyArtifact: okVerifier, now: () => clock },
      seeded,
      'driver-off-02',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome.kind).toBe('completed');
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);
  });
});

describe('advanceAgentRun with step-artifact persistence ON', () => {
  it('completes a producer→consumer chain across two advances via hydration', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const baseTool = makeChainTool(calls);
    const runTool = vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
      clock += 100;
      return baseTool(name, input);
    });
    const deps = {
      runStore: store,
      consumptionStore: makeConsumptionStore(),
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
      stepArtifactsEnabled: true,
    };
    const seeded = await seedRun(store, clock, chainPlan);

    const first = await advanceAndLapse(store, deps, seeded, 'driver-on-01', () => { clock += 31_000; });
    // The budget boundary now falls between producer and consumer
    // because the producer's artifact was persisted with its progress.
    expect(first.outcome.kind).toBe('progress');
    expect(first.next?.stepsState.map((step) => step.status)).toEqual(['completed', 'queued']);
    const saved = await store.listStepArtifacts(RUN_ID);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      stepIndex: 0,
      stepFingerprint: computeAgentRunStepFingerprint('file_reader', { path: 'notes.txt' }),
      artifact: 'FILE TEXT',
    });

    const second = await advanceAgentRun(deps, first.next!, 'driver-on-02', { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS });
    expect(second.kind).toBe('completed');
    const docCall = calls.find((call) => call.name === 'document_generator');
    expect(docCall?.input.content).toBe('FILE TEXT');
    expect(docCall?.input).not.toHaveProperty('contentFromStep');
    expect(second).toMatchObject({ artifact: JSON.stringify({ content: 'doc:FILE TEXT' }) });
  });

  it('completes an AGORA-shaped chain (reader + 9 analyzer segments + document) across many advances', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const docReceivedRows: string[] = [];
    let analyzerCalls = 0;
    const runTool = vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
      clock += 100;
      if (name === 'attachment_reader') {
        return { ok: true, tool: name, artifact: JSON.stringify({ content: 'attachment text' }), message: 'ok' };
      }
      if (name === 'attachment_analyzer') {
        analyzerCalls += 1;
        const offset = Number(input.chunkOffset);
        const count = Number(input.chunkCount);
        let rows: string[] = [];
        if (typeof input.content === 'string') {
          rows = (JSON.parse(input.content) as { rows: string[] }).rows;
        }
        const merged = [...rows, ...Array.from({ length: count }, (_, k) => `chunk-${offset + k}`)];
        return {
          ok: true,
          tool: name,
          artifact: JSON.stringify({ kind: 'data-analysis', outputKind: 'rows', rows: merged, content: merged.join(',') }),
          message: 'ok',
        };
      }
      if (name === 'document_generator') {
        const bundle = JSON.parse(String(input.content)) as { rows: string[] };
        docReceivedRows.push(...bundle.rows);
        return { ok: true, tool: name, artifact: JSON.stringify({ content: `rows:${bundle.rows.length}`, rows: bundle.rows }), message: 'ok' };
      }
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const deps = {
      runStore: store,
      consumptionStore: makeConsumptionStore(),
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
      stepArtifactsEnabled: true,
    };
    const segments = Array.from({ length: 9 }, (_, i) => ({
      toolName: 'attachment_analyzer' as ToolName,
      params: {
        chunkOffset: i * 4,
        chunkCount: 4,
        outputKind: 'rows',
        ...(i > 0 ? { contentFromStep: i } : {}),
      },
    }));
    const seeded = await seedRun(store, clock, [
      { toolName: 'attachment_reader', params: { setId: 'set-agora' } },
      ...segments,
      { toolName: 'document_generator', params: { contentFromStep: 9, jsonTopLevelKeys: ['rows'] } },
    ]);

    let snapshot: AgentRunRecord | null = seeded;
    let outcome: Awaited<ReturnType<typeof advanceAgentRun>> | undefined;
    for (let advance = 0; advance < 20 && snapshot; advance += 1) {
      const result = await advanceAndLapse(store, deps, snapshot, `driver-agora-${advance}`, () => { clock += 31_000; });
      outcome = result.outcome;
      snapshot = result.next;
      if (outcome.kind !== 'progress') break;
    }

    expect(outcome?.kind).toBe('completed');
    expect(analyzerCalls).toBe(9);
    // The final bundle the document step received covers all 36
    // chunks exactly once — the coverage the real analyzer verifies.
    expect(docReceivedRows).toHaveLength(36);
    expect(new Set(docReceivedRows)).toEqual(new Set(Array.from({ length: 36 }, (_, k) => `chunk-${k}`)));
    const saved = await store.listStepArtifacts(RUN_ID);
    // Every analyzer segment was saved (each is consumed by the next);
    // the reader, consumed by nobody, was not.
    expect(saved.map((row) => row.stepIndex).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await store.get(RUN_ID, OWNER))?.status).toBe('completed');
  });

  it('does not hydrate an artifact whose fingerprint does not match the current plan step', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeChainTool(calls);
    await seedRun(store, clock, chainPlan);
    // A row written for a DIFFERENT step at index 0 (the re-plan
    // hazard): valid shape, wrong fingerprint.
    const lease = await store.claim(RUN_ID, 'driver-tamper-01', LEASE_SECONDS);
    expect(lease).not.toBeNull();
    await store.updateProgress(RUN_ID, 'driver-tamper-01', {
      stepsState: [
        { id: 'task-1', status: 'completed', attempts: 1, artifactRef: 'task-1', summary: 'completed:file_reader' },
        { id: 'task-2', status: 'queued', attempts: 0 },
      ],
      artifacts: [{
        stepIndex: 0,
        stepFingerprint: computeAgentRunStepFingerprint('file_reader', { path: 'other.txt' }),
        attempt: 1,
        artifact: 'FILE TEXT',
      }],
    });
    clock += 31_000;
    const recovered = await store.recoverStale(RUN_ID);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore: makeConsumptionStore(), runTool, verifyArtifact: okVerifier, now: () => clock, stepArtifactsEnabled: true },
      recovered!,
      'driver-tamper-02',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({ errorCode: 'AGENT_STEP_INPUT_UNAVAILABLE' });
    expect(calls.some((call) => call.name === 'document_generator')).toBe(false);
  });

  it('does not hydrate an artifact whose attempt does not match the recorded step state', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeChainTool(calls);
    await seedRun(store, clock, chainPlan);
    const lease = await store.claim(RUN_ID, 'driver-tamper-03', LEASE_SECONDS);
    expect(lease).not.toBeNull();
    await store.updateProgress(RUN_ID, 'driver-tamper-03', {
      stepsState: [
        { id: 'task-1', status: 'completed', attempts: 1, artifactRef: 'task-1', summary: 'completed:file_reader' },
        { id: 'task-2', status: 'queued', attempts: 0 },
      ],
      artifacts: [{
        stepIndex: 0,
        stepFingerprint: computeAgentRunStepFingerprint('file_reader', { path: 'notes.txt' }),
        attempt: 2,
        artifact: 'FILE TEXT',
      }],
    });
    clock += 31_000;
    const recovered = await store.recoverStale(RUN_ID);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore: makeConsumptionStore(), runTool, verifyArtifact: okVerifier, now: () => clock, stepArtifactsEnabled: true },
      recovered!,
      'driver-tamper-04',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({ errorCode: 'AGENT_STEP_INPUT_UNAVAILABLE' });
  });

  it('does not save an oversize artifact; the producer still completes and a split consumer degrades fail-closed', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const oversize = 'x'.repeat(120_001);
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => {
      clock += 100;
      if (name === 'file_reader') return { ok: true, tool: name, artifact: oversize, message: 'ok' };
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const deps = {
      runStore: store,
      consumptionStore: makeConsumptionStore(),
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
      stepArtifactsEnabled: true,
    };
    const seeded = await seedRun(store, clock, [
      { toolName: 'file_reader', params: { path: 'big.txt' } },
      { toolName: 'repository_explorer', params: {} },
      { toolName: 'document_generator', params: { contentFromStep: 0 } },
    ]);

    const first = await advanceAndLapse(store, deps, seeded, 'driver-big-01', () => { clock += 31_000; });
    // The producer completed normally — oversize refuses the SAVE,
    // never the step — and nothing was persisted.
    expect(first.outcome.kind).toBe('progress');
    expect(first.next?.stepsState[0]?.status).toBe('completed');
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);

    const second = await advanceAndLapse(store, deps, first.next!, 'driver-big-02', () => { clock += 31_000; });
    expect(second.outcome.kind).toBe('progress');

    const third = await advanceAgentRun(deps, second.next!, 'driver-big-03', { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS });
    expect(third.kind).toBe('failed');
    expect(third).toMatchObject({ errorCode: 'AGENT_STEP_INPUT_UNAVAILABLE' });
  });

  it('does not save a secret-like artifact; the producer still completes and a split consumer degrades fail-closed', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const secretLike = 'quarterly notes api_key: "supersecretvalue" end of notes';
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => {
      clock += 100;
      if (name === 'file_reader') return { ok: true, tool: name, artifact: secretLike, message: 'ok' };
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const deps = {
      runStore: store,
      consumptionStore: makeConsumptionStore(),
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
      stepArtifactsEnabled: true,
    };
    const seeded = await seedRun(store, clock, [
      { toolName: 'file_reader', params: { path: 'notes.txt' } },
      { toolName: 'repository_explorer', params: {} },
      { toolName: 'document_generator', params: { contentFromStep: 0 } },
    ]);

    const first = await advanceAndLapse(store, deps, seeded, 'driver-secret-01', () => { clock += 31_000; });
    expect(first.outcome.kind).toBe('progress');
    expect(first.next?.stepsState[0]?.status).toBe('completed');
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);

    const second = await advanceAndLapse(store, deps, first.next!, 'driver-secret-02', () => { clock += 31_000; });
    const third = await advanceAgentRun(deps, second.next!, 'driver-secret-03', { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS });
    expect(third.kind).toBe('failed');
    expect(third).toMatchObject({ errorCode: 'AGENT_STEP_INPUT_UNAVAILABLE' });
    // The secret-like body never entered the artifact store.
    expect(JSON.stringify(await store.listStepArtifacts(RUN_ID))).not.toContain('supersecretvalue');
  });

  it('an advance that loses its claim mid-step saves no artifact and leaves the step uncompleted', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    let readerCalls = 0;
    const runTool = vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
      if (name === 'file_reader') {
        readerCalls += 1;
        // The first driver's lease (30s) lapses while its step runs.
        if (readerCalls === 1) clock += 31_000;
        return { ok: true, tool: name, artifact: 'FILE TEXT', message: 'ok' };
      }
      if (name === 'document_generator') {
        return { ok: true, tool: name, artifact: JSON.stringify({ content: `doc:${String(input.content)}` }), message: 'ok' };
      }
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const deps = {
      runStore: store,
      consumptionStore: makeConsumptionStore(),
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
      stepArtifactsEnabled: true,
    };
    const seeded = await seedRun(store, clock, chainPlan);

    const first = await advanceAgentRun(deps, seeded, 'driver-claim-01', { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS });
    // The fenced progress write failed, so the advance reports busy:
    // neither the step state nor the artifact was persisted.
    expect(first.kind).toBe('busy');
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);
    expect((await store.get(RUN_ID, OWNER))?.stepsState[0]?.status).toBe('queued');

    const recovered = await store.recoverStale(RUN_ID);
    const second = await advanceAgentRun(deps, recovered!, 'driver-claim-02', { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS });
    expect(second.kind).toBe('completed');
    expect(readerCalls).toBe(2);
    const saved = await store.listStepArtifacts(RUN_ID);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.stepIndex).toBe(0);
  });
});
