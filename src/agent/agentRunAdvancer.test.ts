import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { advanceAgentRun } from './agentRunAdvancer.js';
import type { AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import type { AgentRunRecord, AgentRunStore } from './agentRunRecord.js';
import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

const OWNER = createHash('sha256').update('advancer-test-owner').digest('hex');
const RUN_ID = 'run-advancer-0001';
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
  steps: Array<{ toolName: ToolName; params?: ToolParams }>,
  status: 'queued' | 'awaiting_approval' = 'queued',
): Promise<AgentRunRecord> {
  const created = await store.create({
    runId: RUN_ID,
    ownerBinding: OWNER,
    goal: 'Advancer test goal',
    status,
    plan: steps.map((step, index) => ({
      toolName: step.toolName,
      params: step.params ?? {},
      dependsOn: index === 0 ? [] : [index - 1],
      ...(step.params?.contentFromPreviousArtifact === true && index > 0 ? { inputFrom: index - 1 } : {}),
    })),
    planDigest: createHash('sha256').update(`plan:${RUN_ID}`).digest('hex'),
    stepsState: steps.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
    expiresAt: Date.now() + DAY_MS,
  });
  if (!created) throw new Error('seed failed');
  return created;
}

describe('advanceAgentRun', () => {
  it('completes a two-step run in one advance and reserves consumption once', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore, consumed } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }, { toolName: 'document_generator' }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(consumed.has(RUN_ID)).toBe(true);
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('completed');
    expect(record?.stepsState.map((step) => step.status)).toEqual(['completed', 'completed']);
    expect(record?.stepsState[0]?.summary).toBe('completed:repository_explorer');
    expect(record?.quotaLedger.origin?.execution_reserved).toBe(1);
  });

  it('stops at the budget between steps and a live lease blocks a second advance', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    let clock = 1_000_000;
    const baseTool = makeRunTool();
    const runTool = vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
      clock += 5;
      return baseTool(name, input);
    });
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }, { toolName: 'document_generator' }]);
    const deps = {
      runStore: store,
      consumptionStore,
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
    };

    const first = await advanceAgentRun(deps, seeded, 'driver-alpha-01', { budgetMs: 1 });
    expect(first.kind).toBe('progress');
    expect(runTool).toHaveBeenCalledTimes(1);
    const midway = await store.get(RUN_ID, OWNER);
    expect(midway?.status).toBe('running');
    expect(midway?.stepsState[0]?.status).toBe('completed');
    expect(midway?.stepsState[1]?.status).toBe('queued');

    // The first driver still holds a live lease, so another advance is busy
    // and runs nothing. Resumption after lease expiry is covered separately.
    const second = await advanceAgentRun(deps, midway!, 'driver-alpha-01', { budgetMs: 60_000 });
    expect(second.kind).toBe('busy');
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it('resumes after the lease expires and does not consume twice', async () => {
    let clock = Date.now();
    const store = new InMemoryAgentRunStore(() => clock);
    const { store: consumptionStore } = makeConsumptionStore();
    const consumeSpy = consumptionStore.consume as ReturnType<typeof vi.fn>;
    const baseTool = makeRunTool();
    const runTool = vi.fn(async (name: ToolName, input: ToolParams): Promise<ToolResult> => {
      clock += 5;
      return baseTool(name, input);
    });
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }, { toolName: 'document_generator' }]);
    const deps = {
      runStore: store,
      consumptionStore,
      runTool,
      verifyArtifact: okVerifier,
      now: () => clock,
    };

    const first = await advanceAgentRun(deps, seeded, 'driver-alpha-01', { budgetMs: 1, leaseSeconds: 30 });
    expect(first.kind).toBe('progress');
    clock += 31_000;
    const recovered = await store.recoverStale(RUN_ID);
    expect(recovered?.status).toBe('queued');
    const second = await advanceAgentRun(deps, recovered!, 'driver-beta-02', { budgetMs: 60_000, leaseSeconds: 30 });
    expect(second.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(consumeSpy).toHaveBeenCalledTimes(1);
  });

  it('fails the run when the shared reservation was already taken', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore(false);
    const runTool = makeRunTool();
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_RUN_ALREADY_CONSUMED' });
    expect(runTool).not.toHaveBeenCalled();
    expect((await store.get(RUN_ID, OWNER))?.status).toBe('failed');
  });

  it('refuses to advance without replay protection and leaves the run queued', async () => {
    const store = new InMemoryAgentRunStore();
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }]);

    const outcome = await advanceAgentRun(
      { runStore: store, runTool: makeRunTool(), verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'unavailable', errorCode: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' });
    expect((await store.get(RUN_ID, OWNER))?.status).toBe('queued');
  });

  it('never advances a non-runnable record (approval pending, terminal)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const pending = await seedRun(store, [{ toolName: 'repository_explorer' }], 'awaiting_approval');

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      pending,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('not_runnable');
    expect(runTool).not.toHaveBeenCalled();
  });

  it('reports busy while another driver holds a live lease', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }]);
    const lease = await store.claim(RUN_ID, 'driver-other-99', 120);
    expect(lease).not.toBeNull();

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool: makeRunTool(), verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('busy');
  });

  it('fails the run when a step fails verification', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore,
        runTool: makeRunTool(),
        verifyArtifact: async (artifact) => ({ ok: false, artifact, attempts: 2 }),
      },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'ARTIFACT_VERIFICATION_FAILED' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.stepsState[0]?.errorCode).toBe('ARTIFACT_VERIFICATION_FAILED');
  });

  it('threads the previous textual artifact into a dataflow step in the same advance', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool({ file_reader: 'PREVIOUS FILE TEXT' });
    const seeded = await seedRun(store, [
      { toolName: 'file_reader', params: { path: 'README.md' } },
      { toolName: 'document_generator', params: { title: 'Summary', contentFromPreviousArtifact: true } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    const secondCall = runTool.mock.calls[1];
    expect(secondCall?.[0]).toBe('document_generator');
    expect(secondCall?.[1]).toMatchObject({ title: 'Summary', content: 'PREVIOUS FILE TEXT' });
    expect(secondCall?.[1]).not.toHaveProperty('contentFromPreviousArtifact');
  });

  it('fails closed when a dataflow step has no artifact from this advance', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, [
      { toolName: 'document_generator', params: { title: 'Only step', contentFromPreviousArtifact: true } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_STEP_INPUT_UNAVAILABLE' });
    expect(runTool).not.toHaveBeenCalled();
  });

  it('runs the repository completion gate for file_writer plans', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedRun(store, [{ toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } }]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore,
        runTool: makeRunTool(),
        verifyArtifact: okVerifier,
        verifyCompletion: async () => ({ ok: false }),
      },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'COMPLETION_VERIFICATION_FAILED' });
    expect((await store.get(RUN_ID, OWNER))?.status).toBe('failed');
  });
});
