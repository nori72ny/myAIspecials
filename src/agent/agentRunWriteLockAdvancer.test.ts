// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { advanceAgentRun } from './agentRunAdvancer.js';
import { AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY } from './agentRunWriteLock.js';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { InMemoryAgentRunWriteLockStore } from './agentRunWriteLockStoreMemory.fixture.js';
import type { AgentRunQuotaLedger, AgentRunRecord, AgentRunStore } from './agentRunRecord.js';
import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

const OWNER = createHash('sha256').update('write-lock-test-owner').digest('hex');
const OPERATOR_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');
const DAY_MS = 24 * 60 * 60 * 1_000;
const KEY = AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY;

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
  options: { ownerBinding?: string; quotaLedger?: AgentRunQuotaLedger; now?: number } = {},
): Promise<AgentRunRecord> {
  const created = await store.create({
    runId,
    ownerBinding: options.ownerBinding ?? OWNER,
    goal: 'Write lock test goal',
    status: 'queued',
    plan: steps.map((step, index) => ({
      toolName: step.toolName,
      params: step.params ?? {},
      dependsOn: index === 0 ? [] : [index - 1],
    })),
    planDigest: createHash('sha256').update(`plan:${runId}`).digest('hex'),
    stepsState: steps.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
    quotaLedger: options.quotaLedger,
    expiresAt: (options.now ?? Date.now()) + DAY_MS,
  });
  if (!created) throw new Error('seed failed');
  return created;
}

describe('advanceAgentRun writer lock', () => {
  it('waits at the write step when another run holds the lock: no write, no failure, no hold', async () => {
    const store = new InMemoryAgentRunStore();
    const lockStore = new InMemoryAgentRunWriteLockStore();
    const other = await lockStore.acquire(KEY, 'run-other-writer-1', 'driver-other-1', 120);
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, 'run-lock-waiter-01', [
      { toolName: 'repository_explorer' },
      { toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, writeLockStore: lockStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('write_lock_busy');
    if (outcome.kind !== 'write_lock_busy') throw new Error('expected write_lock_busy');
    expect(outcome.holderRunId).toBe('run-other-writer-1');
    expect(outcome.lockExpiresAt).toBe(other?.leaseExpiresAt);
    // The read step before the write ran and persisted; the write did not.
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool.mock.calls.map(([name]) => name)).toEqual(['repository_explorer']);
    const record = await store.get('run-lock-waiter-01', OWNER);
    expect(record?.status).toBe('running');
    expect(record?.hold).toBeNull();
    expect(record?.stepsState.map((step) => step.status)).toEqual(['completed', 'queued']);
    // The other run's lock is untouched.
    expect((await lockStore.inspect(KEY))?.holderRunId).toBe('run-other-writer-1');
  });

  it('holds the lock across the write step and the completion verification, then releases it', async () => {
    const store = new InMemoryAgentRunStore();
    const lockStore = new InMemoryAgentRunWriteLockStore();
    const { store: consumptionStore } = makeConsumptionStore();
    let holderDuringWrite: string | null = null;
    let holderDuringVerify: string | null = null;
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => {
      if (name === 'file_writer') {
        holderDuringWrite = (await lockStore.inspect(KEY))?.holderRunId ?? null;
      }
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const seeded = await seedRun(store, 'run-lock-holder-01', [
      { toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } },
    ]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore,
        writeLockStore: lockStore,
        runTool,
        verifyArtifact: okVerifier,
        verifyCompletion: async () => {
          holderDuringVerify = (await lockStore.inspect(KEY))?.holderRunId ?? null;
          return { ok: true };
        },
      },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    expect(holderDuringWrite).toBe('run-lock-holder-01');
    expect(holderDuringVerify).toBe('run-lock-holder-01');
    expect(await lockStore.inspect(KEY)).toBeNull();
  });

  it('releases the lock when the run fails after writing', async () => {
    const store = new InMemoryAgentRunStore();
    const lockStore = new InMemoryAgentRunWriteLockStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedRun(store, 'run-lock-failure-01', [
      { toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } },
    ]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore,
        writeLockStore: lockStore,
        runTool: makeRunTool(),
        verifyArtifact: okVerifier,
        verifyCompletion: async () => ({ ok: false }),
      },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'COMPLETION_VERIFICATION_FAILED' });
    expect(await lockStore.inspect(KEY)).toBeNull();
  });

  it('never touches the lock for read-only plans, even while another run holds it', async () => {
    const store = new InMemoryAgentRunStore();
    const lockStore = new InMemoryAgentRunWriteLockStore();
    await lockStore.acquire(KEY, 'run-other-writer-1', 'driver-other-1', 120);
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, 'run-lock-reader-01', [
      { toolName: 'repository_explorer' },
      { toolName: 'document_generator', params: { title: 'Read only' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, writeLockStore: lockStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(2);
    expect((await lockStore.inspect(KEY))?.holderRunId).toBe('run-other-writer-1');
  });

  it('refuses to write when no lock store is configured (fail closed)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, 'run-lock-missing-01', [
      { toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'unavailable', errorCode: 'AGENT_WRITE_LOCK_UNAVAILABLE' });
    expect(runTool).not.toHaveBeenCalled();
    expect((await store.get('run-lock-missing-01', OWNER))?.stepsState[0]?.status).toBe('queued');
  });

  it('keeps the gate before the lock: a quota-blocked search step holds before any write is attempted', async () => {
    const store = new InMemoryAgentRunStore();
    const lockStore = new InMemoryAgentRunWriteLockStore();
    await lockStore.acquire(KEY, 'run-other-writer-1', 'driver-other-1', 120);
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    await seedRun(store, 'run-lock-gate-prior', [{ toolName: 'repository_explorer' }], {
      quotaLedger: { tavily: { credits: 800 } },
    });
    const seeded = await seedRun(store, 'run-lock-gate-order', [
      { toolName: 'web_search_grounding', params: { query: 'blocked first' } },
      { toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, writeLockStore: lockStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    // The gate fires at the first step, so the run is held for quota and
    // the write step (and its lock) is never reached in this advance.
    expect(outcome.kind).toBe('held');
    expect(runTool).not.toHaveBeenCalled();
    expect((await store.get('run-lock-gate-order', OWNER))?.hold?.reason).toBe('quota_exhausted');
  });

  it('proceeds once the contending lock lapses and the claim is recovered', async () => {
    let clock = Date.now();
    const store = new InMemoryAgentRunStore(() => clock);
    const lockStore = new InMemoryAgentRunWriteLockStore(() => clock);
    await lockStore.acquire(KEY, 'run-other-writer-1', 'driver-other-1', 30);
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const seeded = await seedRun(store, 'run-lock-retry-01', [
      { toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } },
    ], { now: clock });
    const deps = {
      runStore: store,
      consumptionStore,
      writeLockStore: lockStore,
      runTool,
      verifyArtifact: okVerifier,
      verifyCompletion: async () => ({ ok: true }),
      now: () => clock,
    };

    const first = await advanceAgentRun(deps, seeded, 'driver-alpha-01', { leaseSeconds: 30 });
    expect(first.kind).toBe('write_lock_busy');
    expect(runTool).not.toHaveBeenCalled();

    clock += 31_000;
    const recovered = await store.recoverStale('run-lock-retry-01');
    expect(recovered?.status).toBe('queued');
    const second = await advanceAgentRun(deps, recovered!, 'driver-beta-02', { leaseSeconds: 30 });
    expect(second.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(await lockStore.inspect(KEY)).toBeNull();
  });
});

describe('runs API writer lock surface', () => {
  const SECRET = 'test-only-'.repeat(5);
  const env = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };

  it('reports a lock-blocked advance as a wait, never as failed or held', async () => {
    const runStore = new InMemoryAgentRunStore();
    const lockStore = new InMemoryAgentRunWriteLockStore();
    await lockStore.acquire(KEY, 'run-other-writer-1', 'driver-other-1', 120);
    const { store: consumptionStore } = makeConsumptionStore();
    await seedRun(runStore, 'run-api-lock-target', [
      { toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } },
    ], { ownerBinding: OPERATOR_BINDING });

    const app = express();
    app.use(express.json());
    app.use(createAgentOrchestratorV3Router(env, consumptionStore, { runStore, writeLockStore: lockStore }));

    const advanced = await request(app).post('/api/agent/v3/runs/run-api-lock-target/advance')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});

    expect(advanced.status).toBe(202);
    expect(advanced.body.ok).toBe(true);
    expect(advanced.body.status).toBe('running');
    expect(advanced.body.advanced).toBe(false);
    expect(advanced.body.code).toBe('AGENT_RUN_WRITE_LOCK_BUSY');
    expect(advanced.body.writeLock.holderRunId).toBe('run-other-writer-1');
    expect(advanced.body.writeLock.expiresAt).toEqual(expect.any(String));
    expect(advanced.body.run.status).toBe('running');
    expect(advanced.body.run.hold).toBeNull();
    expect(JSON.stringify(advanced.body)).not.toContain(OPERATOR_BINDING);
  });
});
