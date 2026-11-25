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
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import {
  computeAgentAttachmentSetDigest,
  validateAgentAttachmentFileText,
} from './agentAttachmentRecord.js';
import type { AgentModelExecutor } from './agentModelCall.js';
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
    // repository_explorer, whose artifact has no textual form. Step 4
    // itself joins as the plan's final document_generator: the
    // deliverable is always persisted (retrieval design §3.2).
    expect([...stepArtifactPersistIndexes(plan)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('selects nothing when no step consumes an earlier artifact', () => {
    const plan = [
      { toolName: 'file_reader' as ToolName, params: {}, dependsOn: [] },
      { toolName: 'repository_explorer' as ToolName, params: {}, dependsOn: [0] },
    ];
    expect(stepArtifactPersistIndexes(plan).size).toBe(0);
  });

  it('persists every role-carrying document step of a multi-file plan (対策6)', () => {
    const plan = [
      { toolName: 'attachment_reader' as ToolName, params: {}, dependsOn: [] },
      { toolName: 'attachment_analyzer' as ToolName, params: { chunkOffset: 0, chunkCount: 2 }, dependsOn: [0] },
      { toolName: 'document_generator' as ToolName, params: { contentFromStep: 1, outputRole: 'rows-csv' }, dependsOn: [1] },
      { toolName: 'document_generator' as ToolName, params: { contentFromStep: 1, outputRole: 'capital-json' }, dependsOn: [1] },
      { toolName: 'document_generator' as ToolName, params: { contentFromStep: 1, outputRole: 'execution-log' }, dependsOn: [1] },
    ];
    // Step 1 is selected as the named producer; steps 2–4 are all
    // deliverables of the multi-file run, not only the final one.
    expect([...stepArtifactPersistIndexes(plan)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
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
    // the reader, consumed by nobody, was not. The final document
    // step (10) is saved as the run's deliverable (retrieval §3.2).
    expect(saved.map((row) => row.stepIndex).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
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
    // Step 0 (the consumed producer) and step 1 (the final
    // document_generator — the deliverable, retrieval design §3.2).
    expect(saved.map((row) => row.stepIndex).sort((a, b) => a - b)).toEqual([0, 1]);
  });
});

describe('diagnostic retention of verification-failed artifacts (K-17, PR-α)', () => {
  const refusingVerifier = async (artifact: string, toolName: ToolName) =>
    (toolName === 'document_generator'
      ? { ok: false, artifact, attempts: 1 }
      : { ok: true, artifact, attempts: 0 });

  it('keeps the artifact verification refused, alongside the completed producer row', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeChainTool(calls);
    const seeded = await seedRun(store, clock, chainPlan);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        runTool,
        verifyArtifact: refusingVerifier,
        now: () => clock,
        stepArtifactsEnabled: true,
      },
      seeded,
      'driver-diag-01',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    // The failure itself is unchanged: same kind, same code, and the
    // run record carries no artifact on the outcome.
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'ARTIFACT_VERIFICATION_FAILED' });
    expect(outcome).not.toHaveProperty('artifact');
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.stepsState[1]?.status).toBe('failed');
    // Both rows are in the store: the producer's (its step state is
    // completed) and the refused document's — the read side tells
    // the diagnostic row apart by exactly that step state.
    const saved = await store.listStepArtifacts(RUN_ID);
    expect(saved.map((row) => row.stepIndex).sort((a, b) => a - b)).toEqual([0, 1]);
    const diagnostic = saved.find((row) => row.stepIndex === 1);
    expect(diagnostic?.artifact).toBe(JSON.stringify({ content: 'doc:FILE TEXT' }));
    expect(diagnostic?.attempt).toBe(record?.stepsState[1]?.attempts);
  });

  it('saves no diagnostic row while persistence is OFF', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeChainTool(calls);
    const seeded = await seedRun(store, clock, chainPlan);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        runTool,
        verifyArtifact: refusingVerifier,
        now: () => clock,
      },
      seeded,
      'driver-diag-02',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'ARTIFACT_VERIFICATION_FAILED' });
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);
  });

  it('keeps the §4.2 selectivity for diagnostic rows: a refused step nobody consumes is not saved', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const runTool = vi.fn(async (name: ToolName): Promise<ToolResult> => ({
      ok: true,
      tool: name,
      artifact: `artifact:${name}`,
      message: 'ok',
    }));
    const refuseAll = async (artifact: string) => ({ ok: false, artifact, attempts: 1 });
    const seeded = await seedRun(store, clock, [{ toolName: 'repository_explorer', params: {} }]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        runTool,
        verifyArtifact: refuseAll,
        now: () => clock,
        stepArtifactsEnabled: true,
      },
      seeded,
      'driver-diag-03',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'ARTIFACT_VERIFICATION_FAILED' });
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);
  });

  it('does not save a secret-like diagnostic artifact', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const secretDoc = 'draft document api_key: "supersecretvalue" end of draft';
    const runTool = vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
      if (name === 'file_reader') return { ok: true, tool: name, artifact: 'FILE TEXT', message: 'ok' };
      if (name === 'document_generator') return { ok: true, tool: name, artifact: secretDoc, message: 'ok' };
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const seeded = await seedRun(store, clock, chainPlan);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        runTool,
        verifyArtifact: refusingVerifier,
        now: () => clock,
        stepArtifactsEnabled: true,
      },
      seeded,
      'driver-diag-04',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'ARTIFACT_VERIFICATION_FAILED' });
    const saved = await store.listStepArtifacts(RUN_ID);
    // The producer's clean row is saved; the refused secret-like
    // document is screened out exactly like a completed step's
    // artifact would be — never truncated, never stored.
    expect(saved.map((row) => row.stepIndex)).toEqual([0]);
    expect(JSON.stringify(saved)).not.toContain('supersecretvalue');
  });
});

describe('diagnostic retention of tool-failure bundles (K-17, PR-β)', () => {
  const BUNDLE = JSON.stringify({
    kind: 'data-analysis',
    content: 'Event_ID,Loss_Amount_CNY\nOR001,100\nOR002,200\nOR004,400',
    outputKind: 'rows',
    rows: [
      { Event_ID: 'OR001', Loss_Amount_CNY: '100' },
      { Event_ID: 'OR002', Loss_Amount_CNY: '200' },
      { Event_ID: 'OR004', Loss_Amount_CNY: '400' },
    ],
  });
  const COVERAGE_MESSAGE = 'AGENT_DATA_COVERAGE_INSUFFICIENT (対象4件中3件を処理、未処理1件、重複0件、対象外0件、数値不一致1件)';

  const betaPlan: PlanStepSpec[] = [
    { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 0, chunkCount: 1 } },
    { toolName: 'document_generator', params: { contentFromStep: 0 } },
  ];

  function makeFailingAnalyzerTool(calls: Array<{ name: ToolName; input: ToolParams }>) {
    return vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
      calls.push({ name, input });
      if (name === 'attachment_analyzer') {
        return { ok: false, tool: name, message: COVERAGE_MESSAGE, diagnosticArtifact: BUNDLE };
      }
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
  }

  it('saves the bundle a failed tool computed, and never lets a consumer resolve it', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeFailingAnalyzerTool(calls);
    const seeded = await seedRun(store, clock, betaPlan);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        runTool,
        verifyArtifact: okVerifier,
        now: () => clock,
        stepArtifactsEnabled: true,
      },
      seeded,
      'driver-beta-01',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    // The failure itself is unchanged: the tool's own code, and no
    // artifact rides the outcome.
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_COVERAGE_INSUFFICIENT' });
    expect(outcome).not.toHaveProperty('artifact');
    // The consumer step never ran: the diagnostic bundle was not
    // resolved as its contentFromStep input — nor as anything else.
    // The diagnostic channel is write-only toward the store.
    expect(calls.map((call) => call.name)).toEqual(['attachment_analyzer']);
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[0]?.status).toBe('failed');
    // The bundle is in the store as step 0's row, told apart from a
    // success row by exactly that failed step state.
    const saved = await store.listStepArtifacts(RUN_ID);
    expect(saved.map((row) => row.stepIndex)).toEqual([0]);
    expect(saved[0]?.artifact).toBe(BUNDLE);
    expect(saved[0]?.attempt).toBe(record?.stepsState[0]?.attempts);
  });

  it('saves no tool-failure bundle while persistence is OFF', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const calls: Array<{ name: ToolName; input: ToolParams }> = [];
    const runTool = makeFailingAnalyzerTool(calls);
    const seeded = await seedRun(store, clock, betaPlan);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        runTool,
        verifyArtifact: okVerifier,
        now: () => clock,
      },
      seeded,
      'driver-beta-02',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_COVERAGE_INSUFFICIENT' });
    expect(await store.listStepArtifacts(RUN_ID)).toEqual([]);
  });

  it('keeps a real analyzer coverage failure diagnosable from the saved row alone (Basel shape)', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunStore(() => clock);
    const SET_ID = 'att-12345678-abcd-4ef0-9abc-def012345678';
    const EVENTS = ['Event_ID,Loss_Amount_CNY', 'OR001,100', 'OR002,200', 'OR003,300', 'OR004,400'].join('\n');
    const attachmentStore = new InMemoryAgentAttachmentStore();
    await attachmentStore.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    const measured = validateAgentAttachmentFileText(EVENTS);
    await attachmentStore.addFile(SET_ID, OWNER, {
      name: 'operational_risk_events.csv',
      mediaType: 'text/csv',
      kind: 'text',
      byteSize: measured.byteSize,
      charCount: measured.charCount,
      sha256: measured.sha256,
      extractedText: EVENTS,
    });
    const set = await attachmentStore.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    const setDigest = computeAgentAttachmentSetDigest(set.files);
    // The model drops OR003 — the coverage failure shape behind the
    // production Basel diagnosis (K-17's origin): before PR-β the
    // merged rows were discarded with the failure and only the
    // message's aggregates survived.
    const droppingExecutor: AgentModelExecutor = async ({ userText }) => {
      const lines = userText
        .split('\n')
        .filter((line) => line.length > 0 && !line.startsWith('【出典:') && !line.includes('OR003'));
      const rows = lines.slice(1).map((line) => {
        const [Event_ID, Loss_Amount_CNY] = line.split(',');
        return { Event_ID, Loss_Amount_CNY };
      });
      return { ok: true, text: JSON.stringify({ rows }) };
    };
    const seeded = await seedRun(store, clock, [
      {
        toolName: 'attachment_analyzer',
        params: {
          attachmentSetId: SET_ID,
          setDigest,
          instruction: '各イベントの損失額を集計してください',
          outputKind: 'rows',
          chunkOffset: 0,
          chunkCount: 1,
        },
      },
      { toolName: 'document_generator', params: { contentFromStep: 0 } },
    ]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        attachmentStore,
        toolContext: { modelCall: droppingExecutor },
        verifyArtifact: okVerifier,
        now: () => clock,
        stepArtifactsEnabled: true,
      },
      seeded,
      'driver-beta-03',
      { budgetMs: 60_000, leaseSeconds: LEASE_SECONDS },
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_COVERAGE_INSUFFICIENT' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[0]?.status).toBe('failed');
    const saved = await store.listStepArtifacts(RUN_ID);
    expect(saved.map((row) => row.stepIndex)).toEqual([0]);

    // The K-17 acceptance, reconstructed from the saved row alone:
    // diffing the bundle's rows against the input table names the
    // row that contributed the whole difference — the missing key
    // is OR003 and its input amount equals the sum difference.
    const bundle = JSON.parse(saved[0]?.artifact ?? '{}') as {
      rows?: Array<{ Event_ID: string; Loss_Amount_CNY: string }>;
    };
    const inputRows = EVENTS.split('\n').slice(1).map((line) => {
      const [id, amount] = line.split(',');
      return { id, amount: Number(amount) };
    });
    const bundleIds = new Set((bundle.rows ?? []).map((row) => row.Event_ID));
    const missing = inputRows.filter((row) => !bundleIds.has(row.id));
    const expectedSum = inputRows.reduce((sum, row) => sum + row.amount, 0);
    const bundleSum = (bundle.rows ?? []).reduce((sum, row) => sum + Number(row.Loss_Amount_CNY), 0);
    expect(missing.map((row) => row.id)).toEqual(['OR003']);
    expect(expectedSum - bundleSum).toBe(300);
    expect(missing[0]?.amount).toBe(expectedSum - bundleSum);
  });
});
