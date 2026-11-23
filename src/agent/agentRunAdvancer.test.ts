import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { advanceAgentRun, buildStepLiveDetail, resolveStepParams } from './agentRunAdvancer.js';
import {
  AGENT_RUN_CONSUMPTION_MAX_TTL_MS,
  AGENT_RUN_CONSUMPTION_RESERVATION_TTL_MS,
  type AgentRunConsumptionStore,
} from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { InMemoryAgentRunWriteLockStore } from './agentRunWriteLockStoreMemory.fixture.js';
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
    // PR-D1: the completed outcome carries the final step's artifact body
    // finalized by this advance, as a delivery-only hand-off.
    expect(outcome).toMatchObject({ kind: 'completed', artifact: 'artifact:document_generator' });
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(consumed.has(RUN_ID)).toBe(true);
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('completed');
    expect(record?.stepsState.map((step) => step.status)).toEqual(['completed', 'completed']);
    expect(record?.stepsState[0]?.summary).toBe('completed:repository_explorer');
    expect(record?.quotaLedger.origin?.execution_reserved).toBe(1);
    // The persisted record never gains the artifact body.
    expect(JSON.stringify(record)).not.toContain('artifact:document_generator');
    expect(record?.stepsState[1]).not.toHaveProperty('artifact');
  });

  it('reserves replay protection within the consumption store TTL contract', async () => {
    const store = new InMemoryAgentRunStore();
    // A fake that enforces the Postgres store's contract, which the
    // plain in-memory fake historically did not: the reservation expiry
    // must be in the future and at most the shared maximum TTL out.
    // Passing the record's own expiry (a day here; seven days in
    // production) verbatim used to make every advance fail this check.
    const seen: number[] = [];
    const consumptionStore: AgentRunConsumptionStore = {
      consume: vi.fn(async (_runId: string, expiresAt: number) => {
        const nowMs = Date.now();
        if (!Number.isFinite(expiresAt) || expiresAt <= nowMs || expiresAt > nowMs + AGENT_RUN_CONSUMPTION_MAX_TTL_MS) {
          throw new Error('INVALID_AGENT_RUN_EXPIRY');
        }
        seen.push(expiresAt);
        return true;
      }),
    };
    const runTool = makeRunTool();
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }]);

    const before = Date.now();
    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );
    const after = Date.now();

    expect(outcome.kind).toBe('completed');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(before + AGENT_RUN_CONSUMPTION_RESERVATION_TTL_MS);
    expect(seen[0]).toBeLessThanOrEqual(after + AGENT_RUN_CONSUMPTION_MAX_TTL_MS);
    expect((await store.get(RUN_ID, OWNER))?.status).toBe('completed');
  });

  it('completes without an artifact when this advance finalized no step', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool();
    const created = await store.create({
      runId: RUN_ID,
      ownerBinding: OWNER,
      goal: 'Advancer test goal',
      status: 'queued',
      plan: [{ toolName: 'repository_explorer', params: {}, dependsOn: [] }],
      planDigest: createHash('sha256').update(`plan:${RUN_ID}`).digest('hex'),
      stepsState: [{ id: 'task-1', status: 'completed', attempts: 1, artifactRef: 'task-1', summary: 'completed:repository_explorer' }],
      expiresAt: Date.now() + DAY_MS,
    });
    expect(created).not.toBeNull();

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      created!,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    expect(outcome).not.toHaveProperty('artifact');
    expect(runTool).not.toHaveBeenCalled();
    expect((await store.get(RUN_ID, OWNER))?.status).toBe('completed');
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
    expect(first).not.toHaveProperty('artifact');
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
    // The resuming advance delivers the artifact of the step it finalized.
    expect(second).toMatchObject({ kind: 'completed', artifact: 'artifact:document_generator' });
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
    expect(outcome).not.toHaveProperty('artifact');
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

  it('preserves the tool failure code embedded in its message instead of reporting a verification failure', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName): Promise<ToolResult> => ({
      ok: false,
      tool: name,
      message: 'Grounded research failed closed (NO_RESULTS).',
    }));
    const seeded = await seedRun(store, [{ toolName: 'web_search_grounding', params: { query: '猫の平均寿命' } }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'NO_RESULTS' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.stepsState[0]?.errorCode).toBe('NO_RESULTS');
  });

  it('preserves a bare tool failure code verbatim', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName): Promise<ToolResult> => ({
      ok: false,
      tool: name,
      message: 'AGENT_DOCUMENT_PARAMS_INVALID',
    }));
    const seeded = await seedRun(store, [{ toolName: 'document_generator' }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DOCUMENT_PARAMS_INVALID' });
    expect((await store.get(RUN_ID, OWNER))?.stepsState[0]?.errorCode).toBe('AGENT_DOCUMENT_PARAMS_INVALID');
  });

  it('collapses a tool failure message without a code token to TOOL_EXECUTION_FAILED', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName): Promise<ToolResult> => ({
      ok: false,
      tool: name,
      message: 'A research query is required.',
    }));
    const seeded = await seedRun(store, [{ toolName: 'web_search_grounding', params: {} }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'TOOL_EXECUTION_FAILED' });
    expect((await store.get(RUN_ID, OWNER))?.stepsState[0]?.errorCode).toBe('TOOL_EXECUTION_FAILED');
  });

  it('keeps ARTIFACT_VERIFICATION_FAILED when the tool ran but produced no verifiable artifact', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName): Promise<ToolResult> => ({ ok: true, tool: name, message: 'ok' }));
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'ARTIFACT_VERIFICATION_FAILED' });
    expect((await store.get(RUN_ID, OWNER))?.stepsState[0]?.errorCode).toBe('ARTIFACT_VERIFICATION_FAILED');
  });

  it('runs the repository completion gate for file_writer plans', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedRun(store, [{ toolName: 'file_writer', params: { path: 'src/example.ts', content: 'export {};' } }]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore,
        writeLockStore: new InMemoryAgentRunWriteLockStore(),
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

  it('records live detail for a research step: timing, the executed query and up to three truncated sources (PR-L1)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const artifact = JSON.stringify({
      provider: 'tavily',
      sources: [
        { title: 't'.repeat(150), url: 'https://example.jp/1', excerpt: 'e'.repeat(200), domain: 'example.jp', evidenceLevel: 'extracted', sourceAuthority: null, freshness: 'recent' },
        { title: 'Second', url: 'https://example.jp/2', excerpt: 'short', domain: 'example.jp' },
        { title: 'Third', url: 'https://example.jp/3', excerpt: 'short', domain: 'example.jp' },
        { title: 'Fourth', url: 'https://example.jp/4', excerpt: 'short', domain: 'example.jp' },
        { title: 'Fifth', url: 'https://example.jp/5', excerpt: 'short', domain: 'example.jp' },
      ],
    });
    const runTool = makeRunTool({ web_search_grounding: artifact });
    const seeded = await seedRun(store, [{ toolName: 'web_search_grounding', params: { query: '富士山の標高' } }]);

    const before = Date.now();
    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );
    const after = Date.now();

    expect(outcome.kind).toBe('completed');
    const detail = (await store.get(RUN_ID, OWNER))?.stepsState[0]?.liveDetail;
    expect(detail?.query).toBe('富士山の標高');
    expect(detail?.startedAt).toBeGreaterThanOrEqual(before);
    expect(detail?.finishedAt).toBeLessThanOrEqual(after);
    expect(detail?.finishedAt).toBeGreaterThanOrEqual(detail?.startedAt ?? 0);
    expect(detail?.sources).toHaveLength(3);
    expect(detail?.sources?.[0]).toEqual({
      title: 't'.repeat(120),
      url: 'https://example.jp/1',
      domain: 'example.jp',
      excerpt: 'e'.repeat(160),
    });
    expect(detail?.sources?.map((source) => source.title)).not.toContain('Fourth');
    // Only the display fields are recorded: provider bookkeeping from the
    // artifact (evidence level, authority, freshness) never enters it.
    expect(JSON.stringify(detail)).not.toContain('evidenceLevel');
    expect(JSON.stringify(detail)).not.toContain('sourceAuthority');
  });

  it('records timing-only live detail for a non-research step (PR-L1)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedRun(store, [{ toolName: 'repository_explorer' }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool: makeRunTool(), verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    const detail = (await store.get(RUN_ID, OWNER))?.stepsState[0]?.liveDetail;
    expect(typeof detail?.startedAt).toBe('number');
    expect(typeof detail?.finishedAt).toBe('number');
    expect(detail?.query).toBeUndefined();
    expect(detail?.sources).toBeUndefined();
  });

  it('still completes and persists progress when the research artifact cannot be parsed for live detail (PR-L1 fail-soft)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = makeRunTool({ web_search_grounding: 'not-json{{{' });
    const seeded = await seedRun(store, [{ toolName: 'web_search_grounding', params: { query: '猫の平均寿命' } }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('completed');
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('completed');
    expect(record?.stepsState[0]?.status).toBe('completed');
    const detail = record?.stepsState[0]?.liveDetail;
    expect(detail?.query).toBe('猫の平均寿命');
    expect(typeof detail?.startedAt).toBe('number');
    expect(detail?.sources).toBeUndefined();
  });

  it('drops secret-tripping live fields instead of failing the progress write (PR-L1 fail-soft)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const artifact = JSON.stringify({
      provider: 'tavily',
      sources: [
        { title: 'Clean', url: 'https://example.jp/clean', excerpt: 'plain excerpt', domain: 'example.jp' },
        { title: 'Leaky excerpt', url: 'https://example.jp/leaky', excerpt: "the token = 'supersecretvalue' appears here", domain: 'example.jp' },
        { title: "password = 'hunter2' の解説", url: 'https://example.jp/dropped', excerpt: 'short', domain: 'example.jp' },
      ],
    });
    const runTool = makeRunTool({ web_search_grounding: artifact });
    const seeded = await seedRun(store, [{ toolName: 'web_search_grounding', params: { query: '富士山の標高' } }]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    // Without the fail-soft screening, the steps-state secret check
    // would reject the progress write and fail the whole run.
    expect(outcome.kind).toBe('completed');
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('completed');
    const sources = record?.stepsState[0]?.liveDetail?.sources;
    expect(sources).toHaveLength(2);
    expect(sources?.[0]?.title).toBe('Clean');
    expect(sources?.[1]?.title).toBe('Leaky excerpt');
    expect(sources?.[1]?.excerpt).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('supersecretvalue');
    expect(JSON.stringify(record)).not.toContain('hunter2');
  });

  it('records the analyzer parse failure (chunk index + reason, no body) in the step live detail (Basel observability)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message: 'AGENT_DATA_OUTPUT_INVALID (chunk 2, parse: row-key-missing)' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 0, chunkCount: 4 } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    // The terminal code is still the bare AGENT_DATA_OUTPUT_INVALID.
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_OUTPUT_INVALID' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[1]).toMatchObject({ status: 'failed', errorCode: 'AGENT_DATA_OUTPUT_INVALID' });
    // The live detail says which chunk failed and why — index and
    // reason token only; nothing of any response body is recorded.
    expect(record?.stepsState[1]?.liveDetail?.parseFailure).toEqual({ chunkIndex: 2, reason: 'row-key-missing' });
    expect(JSON.stringify(record?.stepsState[1]?.liveDetail)).not.toContain('rows');
    expect(record?.stepsState[0]?.liveDetail?.parseFailure).toBeUndefined();
  });

  it('records no parse failure for an analyzer failure without the fixed message shape', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message: 'AGENT_DATA_OUTPUT_INVALID' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 0, chunkCount: 4 } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_OUTPUT_INVALID' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[1]?.liveDetail?.parseFailure).toBeUndefined();
  });

  it('records the analyzer coverage failure breakdown (scope, range, counts, numeric columns) in the step live detail (Basel segment-2 observability)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    // The production-shaped message: human-readable counts first,
    // then the fixed machine-readable parenthetical.
    const message = 'AGENT_DATA_COVERAGE_INSUFFICIENT (対象60件中59件を処理、未処理1件、重複0件、対象外0件、数値不一致1件) (coverage: scope=local, range=0+4, expected=60, covered=59, missing=1, duplicated=0, unexpected=0, numericMismatch=Loss_Amount_CNY)';
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 0, chunkCount: 4 } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    // The terminal code is still the bare AGENT_DATA_COVERAGE_INSUFFICIENT.
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_COVERAGE_INSUFFICIENT' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[1]).toMatchObject({ status: 'failed', errorCode: 'AGENT_DATA_COVERAGE_INSUFFICIENT' });
    // The live detail carries the deterministic breakdown only —
    // counts and the disagreeing column's name; no key values, no
    // row data.
    expect(record?.stepsState[1]?.liveDetail?.coverageFailure).toEqual({
      scope: 'local',
      chunkOffset: 0,
      chunkCount: 4,
      expected: 60,
      covered: 59,
      missing: 1,
      duplicated: 0,
      unexpected: 0,
      numericMismatch: ['Loss_Amount_CNY'],
    });
    expect(record?.stepsState[0]?.liveDetail?.coverageFailure).toBeUndefined();
  });

  it('records the per-column sums of an analyzer coverage failure in the step live detail (coverage observability follow-on)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    // The production Basel signature: all 60 keys covered, the one
    // numeric column short by exactly 10,000,000 with no unreadable
    // values — a transcription error, now readable from the record
    // itself instead of being indistinguishable from a notation
    // failure.
    const message = 'AGENT_DATA_COVERAGE_INSUFFICIENT (対象60件中60件を処理、未処理0件、重複0件、対象外0件、数値不一致1件) (coverage: scope=local, range=0+2, expected=60, covered=60, missing=0, duplicated=0, unexpected=0, numericMismatch=Loss_Amount_CNY, numeric=Loss_Amount_CNY:212750000:202750000:-10000000:0)';
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 0, chunkCount: 2 } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_COVERAGE_INSUFFICIENT' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[1]?.liveDetail?.coverageFailure).toEqual({
      scope: 'local',
      chunkOffset: 0,
      chunkCount: 2,
      expected: 60,
      covered: 60,
      missing: 0,
      duplicated: 0,
      unexpected: 0,
      numericMismatch: ['Loss_Amount_CNY'],
      numericDetails: [
        { column: 'Loss_Amount_CNY', expectedSum: 212750000, outputSum: 202750000, difference: -10000000, unparseableCount: 0 },
      ],
    });
  });

  it('records no coverage failure for an analyzer coverage failure without the fixed message shape', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message: 'AGENT_DATA_COVERAGE_INSUFFICIENT' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 0, chunkCount: 4 } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_DATA_COVERAGE_INSUFFICIENT' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[1]?.liveDetail?.coverageFailure).toBeUndefined();
  });

  it('records the failover attempts of the failed dispatch in the step live detail (AGORA observability)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message: 'PROVIDER_TIMEOUT (attempts: cloudflare-workers-ai-free|@cf/openai/gpt-oss-120b|availability-error|PROVIDER_TIMEOUT|25000|2; groq-free|openai/gpt-oss-120b|failed|PROVIDER_TIMEOUT|45000|1)' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 4, chunkCount: 2 } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    // The terminal code is still the bare PROVIDER_TIMEOUT.
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'PROVIDER_TIMEOUT' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[1]).toMatchObject({ status: 'failed', errorCode: 'PROVIDER_TIMEOUT' });
    // The live detail now says which routes the failing dispatch
    // tried, how each attempt ended and how long it took — the
    // breakdown the AGORA timeout diagnosis could not recover.
    expect(record?.stepsState[1]?.liveDetail?.providerAttempts).toEqual([
      { providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'availability-error', errorCode: 'PROVIDER_TIMEOUT', durationMs: 25_000, transportRequestCount: 2 },
      { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_TIMEOUT', durationMs: 45_000, transportRequestCount: 1 },
    ]);
    expect(record?.stepsState[0]?.liveDetail?.providerAttempts).toBeUndefined();
  });

  it('records no provider attempts for an analyzer failure without the fixed message shape, and drops malformed entries', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message: 'PROVIDER_TIMEOUT (attempts: groq-free|openai/gpt-oss-120b|failed|PROVIDER_TIMEOUT|45000|1; bad entry; groq-free|openai/gpt-oss-120b|melted|PROVIDER_TIMEOUT|1|1)' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'attachment_analyzer', params: { outputKind: 'rows', chunkOffset: 4, chunkCount: 2 } },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'PROVIDER_TIMEOUT' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.stepsState[1]?.liveDetail?.providerAttempts).toEqual([
      { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_TIMEOUT', durationMs: 45_000, transportRequestCount: 1 },
    ]);
  });

  it('records the throwing step as failed with the restored code when a tool throws', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    // A tool that throws instead of returning ok:false — the
    // production shape of the repository writer failing on the
    // read-only deployment bundle (ALE attempt 3). The exception
    // escapes the step loop; the run must still record which step
    // failed and why, instead of leaving it queued with no code.
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => {
      if (name === 'file_writer') throw new Error('AGENT_REPOSITORY_WRITE_FAILED');
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const seeded = await seedRun(store, [
      { toolName: 'repository_explorer' },
      { toolName: 'file_writer', params: { path: 'artifacts/attachment-result.md', content: 'composed result' } },
    ]);

    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore,
        writeLockStore: new InMemoryAgentRunWriteLockStore(),
        runTool,
        verifyArtifact: okVerifier,
      },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'AGENT_REPOSITORY_WRITE_FAILED' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.stepsState[0]?.status).toBe('completed');
    expect(record?.stepsState[1]?.status).toBe('failed');
    expect(record?.stepsState[1]?.errorCode).toBe('AGENT_REPOSITORY_WRITE_FAILED');
  });
});

describe('resolveStepParams raw bundle resolution (artifact format)', () => {
  const bundle = JSON.stringify({ kind: 'data-analysis', outputKind: 'findings', findings: [] });
  const rendered = '- 所見1';
  const lookup = {
    previousText: rendered,
    byStep: new Map([[1, rendered]]),
    rawByStep: new Map([[1, bundle]]),
  };

  it('gives a structured document step the raw analyzer bundle', () => {
    const resolved = resolveStepParams(
      { toolName: 'document_generator', params: { format: 'json', jsonTopLevelKeys: ['root_causes'], contentFromStep: 1 } },
      lookup,
    );
    expect(resolved).toEqual({ params: { format: 'json', jsonTopLevelKeys: ['root_causes'], content: bundle } });
  });

  it('keeps giving a plain document step the rendered text', () => {
    const resolved = resolveStepParams(
      { toolName: 'document_generator', params: { format: 'markdown', contentFromStep: 1 } },
      lookup,
    );
    expect(resolved).toEqual({ params: { format: 'markdown', content: rendered } });
  });

  it('fails closed when a structured document step names a step with no raw bundle', () => {
    const resolved = resolveStepParams(
      { toolName: 'document_generator', params: { format: 'json', jsonTopLevelKeys: ['root_causes'], contentFromStep: 2 } },
      lookup,
    );
    expect(resolved).toEqual({ error: 'AGENT_STEP_INPUT_UNAVAILABLE' });
  });
});

describe('advanceAgentRun rate-limit hold (design CAPACITY_RATE_LIMIT_QUANTIFICATION_2026-11-22 §2-B)', () => {
  const rateLimitedTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => ({
    ok: false,
    tool: name,
    message: 'PROVIDER_RATE_LIMITED',
  }));

  /** Succeeds for every step except the analyzer, which is rate-limited. */
  const analyzerRateLimitedTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
    name === 'attachment_analyzer'
      ? { ok: false, tool: name, message: 'PROVIDER_RATE_LIMITED' }
      : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
  ));

  async function seedAnalyzerRun(
    store: AgentRunStore,
    stepsState?: AgentRunRecord['stepsState'],
  ): Promise<AgentRunRecord> {
    const created = await store.create({
      runId: RUN_ID,
      ownerBinding: OWNER,
      goal: 'Advancer rate-limit hold test goal',
      status: 'queued',
      plan: [
        { toolName: 'repository_explorer', params: {}, dependsOn: [] },
        { toolName: 'attachment_analyzer', params: { outputKind: 'findings', chunkOffset: 0, chunkCount: 4 }, dependsOn: [0] },
      ],
      planDigest: createHash('sha256').update(`plan:${RUN_ID}`).digest('hex'),
      stepsState: stepsState ?? [
        { id: 'task-1', status: 'queued' as const, attempts: 0 },
        { id: 'task-2', status: 'queued' as const, attempts: 0 },
      ],
      expiresAt: Date.now() + DAY_MS,
    });
    if (!created) throw new Error('seed failed');
    return created;
  }

  it('with the switch OFF (default), a rate-limited analyzer step fails the run exactly as before', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message: 'PROVIDER_RATE_LIMITED' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedAnalyzerRun(store);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'PROVIDER_RATE_LIMITED' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.stepsState[1]).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'PROVIDER_RATE_LIMITED' });
    expect(record?.stepsState[1]?.rateLimitHolds).toBeUndefined();
  });

  it('with the switch ON, a rate-limited analyzer step parks the run as held instead of failing it', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer'
        ? { ok: false, tool: name, message: 'PROVIDER_RATE_LIMITED' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedAnalyzerRun(store);
    const fixedNow = Date.now();

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true, now: () => fixedNow },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('rate_limited');
    expect(outcome).toMatchObject({ kind: 'rate_limited', retryAt: fixedNow + 60_000 });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('held');
    expect(record?.hold).toEqual({
      reason: 'rate_limited',
      resumeCondition: { kind: 'at_time', at: fixedNow + 60_000 },
      heldSince: fixedNow,
      resumeAttempts: 0,
    });
    // The completed step stays completed; the parked step returns to
    // queued with its pre-execution attempt count, the provider code
    // kept, and its park count incremented.
    expect(record?.stepsState[0]).toMatchObject({ status: 'completed', attempts: 1 });
    expect(record?.stepsState[1]).toMatchObject({
      status: 'queued',
      attempts: 0,
      errorCode: 'PROVIDER_RATE_LIMITED',
      rateLimitHolds: 1,
    });
    // The executed step's declared charge stays journaled (the ledger
    // counts attempts, not outcomes). The seeded step declares 4
    // chunks, but the charge is capped at the 2-chunk segment size.
    expect(record?.quotaLedger['origin-llm']?.calls).toBe(2);
  });

  it('resumes the parked run through the §8 flow and completes it from the parked step', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    let analyzerFails = true;
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer' && analyzerFails
        ? { ok: false, tool: name, message: 'PROVIDER_RATE_LIMITED' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedAnalyzerRun(store);
    const parked = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true },
      seeded,
      'driver-alpha-01',
    );
    expect(parked.kind).toBe('rate_limited');

    // §8 resume: held -> awaiting_approval -> queued, fresh approval
    // each time; the record's progress is never rewritten by the
    // transitions themselves.
    const held = await store.get(RUN_ID, OWNER);
    if (!held) throw new Error('held record missing');
    const awaiting = await store.transition({
      runId: RUN_ID,
      ownerBinding: OWNER,
      expectedStatus: 'held',
      expectedVersion: held.version,
      nextStatus: 'awaiting_approval',
      approvalDeadlineAt: Date.now() + 10 * 60_000,
    });
    if (!awaiting) throw new Error('held -> awaiting_approval failed');
    const queued = await store.transition({
      runId: RUN_ID,
      ownerBinding: OWNER,
      expectedStatus: 'awaiting_approval',
      expectedVersion: awaiting.version,
      nextStatus: 'queued',
    });
    if (!queued) throw new Error('awaiting_approval -> queued failed');
    expect(queued.stepsState[1]).toMatchObject({ status: 'queued', attempts: 0, rateLimitHolds: 1 });

    analyzerFails = false;
    runTool.mockClear();
    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true },
      queued,
      'driver-alpha-02',
    );

    expect(outcome.kind).toBe('completed');
    // Only the parked step re-executed; the completed step did not.
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith('attachment_analyzer', expect.anything());
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('completed');
    expect(record?.stepsState.map((step) => step.status)).toEqual(['completed', 'completed']);
  });

  it('fails terminally once the step has been parked the maximum number of times', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedAnalyzerRun(store, [
      { id: 'task-1', status: 'completed', attempts: 1, artifactRef: 'task-1', summary: 'completed:repository_explorer' },
      { id: 'task-2', status: 'queued', attempts: 0, rateLimitHolds: 5 },
    ]);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool: rateLimitedTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'PROVIDER_RATE_LIMITED' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.hold).toBeNull();
  });

  it('fails terminally when the run is older than the hold elapsed cap', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedAnalyzerRun(store);
    const future = Date.now() + 61 * 60_000;

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool: analyzerRateLimitedTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true, now: () => future },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'PROVIDER_RATE_LIMITED' });
    expect((await store.get(RUN_ID, OWNER))?.status).toBe('failed');
  });

  it('parks only analyzer steps and only on PROVIDER_RATE_LIMITED', async () => {
    // A non-analyzer step failing with the same code still fails.
    const storeA = new InMemoryAgentRunStore();
    const { store: consumptionA } = makeConsumptionStore();
    const seededA = await seedRun(storeA, [{ toolName: 'document_generator' }]);
    const outcomeA = await advanceAgentRun(
      { runStore: storeA, consumptionStore: consumptionA, runTool: rateLimitedTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true },
      seededA,
      'driver-alpha-01',
    );
    expect(outcomeA.kind).toBe('failed');
    expect((await storeA.get(RUN_ID, OWNER))?.status).toBe('failed');

    // An analyzer step failing with another transient code still fails.
    const storeB = new InMemoryAgentRunStore();
    const { store: consumptionB } = makeConsumptionStore();
    const unavailableTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => ({
      ok: false,
      tool: name,
      message: 'PROVIDER_UNAVAILABLE',
    }));
    const seededB = await seedAnalyzerRun(storeB);
    const outcomeB = await advanceAgentRun(
      { runStore: storeB, consumptionStore: consumptionB, runTool: unavailableTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true },
      seededB,
      'driver-alpha-01',
    );
    expect(outcomeB.kind).toBe('failed');
    expect(outcomeB).toMatchObject({ kind: 'failed', errorCode: 'PROVIDER_UNAVAILABLE' });
    expect((await storeB.get(RUN_ID, OWNER))?.status).toBe('failed');
  });

  it('honors the env switch when the deps override is absent', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const seeded = await seedAnalyzerRun(store);
    process.env.ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED = 'true';
    try {
      const outcome = await advanceAgentRun(
        { runStore: store, consumptionStore, runTool: analyzerRateLimitedTool, verifyArtifact: okVerifier },
        seeded,
        'driver-alpha-01',
      );
      expect(outcome.kind).toBe('rate_limited');
    } finally {
      delete process.env.ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED;
    }
  });
});

describe('step live detail: reconciliation summary (misreading countermeasure)', () => {
  it('surfaces the reconciler summary from the step artifact', () => {
    const detail = buildStepLiveDetail({
      toolName: 'attachment_reconciler',
      params: {},
      artifact: JSON.stringify({
        kind: 'data-analysis',
        reconciliation: { mode: 'enforce', candidateCount: 3, keptCount: 2, droppedCount: 1, pickedUpCount: 1 },
      }),
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_005_000,
    });
    expect(detail?.reconciliation).toEqual({
      mode: 'enforce', candidateCount: 3, keptCount: 2, droppedCount: 1, pickedUpCount: 1,
    });
  });

  it('omits the field when the artifact carries no reconciliation block', () => {
    const detail = buildStepLiveDetail({
      toolName: 'attachment_reconciler',
      params: {},
      artifact: JSON.stringify({ kind: 'data-analysis' }),
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_005_000,
    });
    expect(detail?.reconciliation).toBeUndefined();
  });
});
describe('step live detail: analyzer execution trace (coverage observability follow-on)', () => {
  it('surfaces the execution trace from the failure message parenthetical', () => {
    const detail = buildStepLiveDetail({
      toolName: 'attachment_analyzer',
      params: {},
      artifact: undefined,
      failureMessage: 'AGENT_DATA_OUTPUT_INVALID (chunk 3, parse: row-key-missing) (execution: servings=groq-free|openai/gpt-oss-120b; repair=1)',
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_005_000,
    });
    expect(detail?.parseFailure).toEqual({ chunkIndex: 3, reason: 'row-key-missing' });
    expect(detail?.analyzerExecution).toEqual({
      servings: [{ providerId: 'groq-free', modelId: 'openai/gpt-oss-120b' }],
      repairRetried: true,
    });
  });

  it('surfaces the execution trace from the success artifact execution block', () => {
    const detail = buildStepLiveDetail({
      toolName: 'attachment_analyzer',
      params: {},
      artifact: JSON.stringify({
        kind: 'data-analysis',
        execution: { servings: [{ providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b' }], repairRetried: false },
      }),
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_005_000,
    });
    expect(detail?.analyzerExecution).toEqual({
      servings: [{ providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b' }],
      repairRetried: false,
    });
  });

  it('omits the trace when neither carrier is present or the shapes are malformed', () => {
    const bare = buildStepLiveDetail({
      toolName: 'attachment_analyzer',
      params: {},
      artifact: JSON.stringify({ kind: 'data-analysis' }),
      failureMessage: 'AGENT_DATA_OUTPUT_INVALID',
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_005_000,
    });
    expect(bare?.analyzerExecution).toBeUndefined();
    const poisoned = buildStepLiveDetail({
      toolName: 'attachment_analyzer',
      params: {},
      artifact: JSON.stringify({ execution: { servings: [{ providerId: 'Bad Provider' }], repairRetried: 'yes' } }),
      failureMessage: 'PROVIDER_TIMEOUT (execution: servings=bad provider|m; repair=1)',
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_005_000,
    });
    expect(poisoned?.analyzerExecution).toBeUndefined();
  });
});
