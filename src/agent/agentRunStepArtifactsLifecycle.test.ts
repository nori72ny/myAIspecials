// @vitest-environment node
import type { QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS,
  type AgentRunPlanStep,
  type PutAgentRunStepArtifactInput,
} from './agentRunRecord.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { PostgresAgentRunStore, type AgentRunSqlExecutor } from './supabaseAgentRunStore.js';

// Step-artifact lifecycle (step-artifact persistence, PR-3; design
// §4.6, §6 PR-3): the retention sweep wired into the piggyback
// evaluation deletes a run's artifacts once the artifact's own expiry
// has passed (PR-1) OR once the run has been terminal for longer than
// the 24-hour grace — whichever comes first. Live runs (including
// held and recovered-to-queued runs) never lose artifacts to the
// terminal rule. One exception (K-17 PR-γ, design
// AGENT_K17_FAILED_STEP_ARTIFACT_DESIGN_2026-11-24 §4): a diagnostic
// row of a run that terminated as failed is exempt from the terminal
// grace and is judged by its own expiry alone. The semantic matrix
// runs against the in-memory store; the Postgres statement shape is
// pinned with a recorder and the SQL itself is verified against a
// real Postgres (PGlite) before this PR is reported, per the 42P08
// lesson.

const fingerprint = 'b'.repeat(64);
const ownerBinding = 'a'.repeat(64);
const digest = 'c'.repeat(64);
const driverId = 'driver-alpha-1';
const T0 = 1_700_000_000_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const plan: AgentRunPlanStep[] = [
  { toolName: 'repository_explorer', params: {}, dependsOn: [] },
  { toolName: 'file_writer', params: { path: 'docs/out.md' }, dependsOn: [0], inputFrom: 0 },
];

function artifactInput(overrides: Partial<PutAgentRunStepArtifactInput> = {}): PutAgentRunStepArtifactInput {
  return {
    stepIndex: 0,
    stepFingerprint: fingerprint,
    attempt: 1,
    artifact: 'step output body',
    ...overrides,
  };
}

/** A claimed store whose run carries one saved artifact. The run TTL
 * is the 7-day maximum, so the artifact's own expiry is far in the
 * future and only the terminal rule can make it due. */
async function storeWithArtifact(now: () => number, runId: string) {
  const store = new InMemoryAgentRunStore(now);
  const created = await store.create({
    runId,
    ownerBinding,
    goal: 'Survey the repository and write a summary',
    status: 'queued',
    plan,
    planDigest: digest,
    expiresAt: now() + SEVEN_DAYS_MS,
  }, now());
  expect(created?.status).toBe('queued');
  const lease = await store.claim(runId, driverId, 300);
  expect(lease?.driverId).toBe(driverId);
  const applied = await store.updateProgress(runId, driverId, { artifacts: [artifactInput()] });
  expect(applied).toBe(true);
  expect(await store.listStepArtifacts(runId)).toHaveLength(1);
  return store;
}

describe('step artifact terminal retention (in-memory)', () => {
  it('deletes a completed run\'s artifacts once the grace passes, long before the run expiry, and is idempotent', async () => {
    let current = T0;
    const store = await storeWithArtifact(() => current, 'run-12345678-abcd');
    const finished = await store.finish('run-12345678-abcd', driverId, 'completed');
    expect(finished?.status).toBe('completed');

    // Inside the grace the artifact survives (and stays listable:
    // its own expiry is the run's 7-day TTL).
    current = T0 + AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS - 1;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
    expect(await store.listStepArtifacts('run-12345678-abcd')).toHaveLength(1);

    // At the grace boundary the sweep reclaims it; a second sweep
    // finds nothing (idempotent).
    current = T0 + AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(1);
    expect(await store.listStepArtifacts('run-12345678-abcd')).toEqual([]);
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
  });

  it('applies the terminal rule to failed and cancelled runs too', async () => {
    let current = T0;
    const failedStore = await storeWithArtifact(() => current, 'run-12345678-abcd');
    // The failed run's row belongs to a step that completed (a
    // success row in a run that failed later): K-17's grace
    // exemption covers only a failed run's diagnostic rows, so the
    // terminal rule still applies to this row.
    await failedStore.updateProgress('run-12345678-abcd', driverId, {
      stepsState: [
        { id: 'task-1', status: 'completed', attempts: 1 },
        { id: 'task-2', status: 'queued', attempts: 0 },
      ],
    });
    await failedStore.finish('run-12345678-abcd', driverId, 'failed');
    const cancelledStore = await storeWithArtifact(() => current, 'run-87654321-dcba');
    await cancelledStore.finish('run-87654321-dcba', driverId, 'cancelled');

    current = T0 + AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS + 1;
    await expect(failedStore.sweepExpiredArtifacts()).resolves.toBe(1);
    await expect(cancelledStore.sweepExpiredArtifacts()).resolves.toBe(1);
  });

  it('never deletes artifacts of a run that is still running, however old they are', async () => {
    let current = T0;
    const store = await storeWithArtifact(() => current, 'run-12345678-abcd');
    current = T0 + 48 * 60 * 60 * 1000;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
    expect(await store.listStepArtifacts('run-12345678-abcd')).toHaveLength(1);
  });

  it('never deletes artifacts of a held run: held is resumable, not terminal', async () => {
    let current = T0;
    const store = await storeWithArtifact(() => current, 'run-12345678-abcd');
    const held = await store.finish('run-12345678-abcd', driverId, 'held', {
      reason: 'user_paused',
      resumeCondition: { kind: 'manual' },
      heldSince: current,
      resumeAttempts: 0,
    });
    expect(held?.status).toBe('held');
    current = T0 + 48 * 60 * 60 * 1000;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
    expect(await store.listStepArtifacts('run-12345678-abcd')).toHaveLength(1);
  });

  it('never deletes artifacts of a run recovered back to queued after a stale claim', async () => {
    let current = T0;
    const store = await storeWithArtifact(() => current, 'run-12345678-abcd');
    // Let the 300s lease lapse, then recover: the run is queued again
    // with a fresh updatedAt, still mid-flight, not terminal.
    current = T0 + 301_000;
    const recovered = await store.recoverStale('run-12345678-abcd');
    expect(recovered?.status).toBe('queued');
    current = T0 + 48 * 60 * 60 * 1000;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
    expect(await store.listStepArtifacts('run-12345678-abcd')).toHaveLength(1);
  });

  it('exempts a failed run\'s diagnostic rows from the terminal grace: they are judged by their own expiry alone', async () => {
    let current = T0;
    const store = await storeWithArtifact(() => current, 'run-12345678-abcd');
    // A second row for step 1; the step states make step 0 a success
    // row and step 1 the failed step's diagnostic row.
    await store.updateProgress('run-12345678-abcd', driverId, { artifacts: [artifactInput({ stepIndex: 1 })] });
    await store.updateProgress('run-12345678-abcd', driverId, {
      stepsState: [
        { id: 'task-1', status: 'completed', attempts: 1 },
        { id: 'task-2', status: 'failed', attempts: 1 },
      ],
    });
    await store.finish('run-12345678-abcd', driverId, 'failed');

    // At the grace boundary the success row is reclaimed, while the
    // diagnostic row survives — and stays listable, because its own
    // expiry is the run's 7-day TTL.
    current = T0 + AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(1);
    const remaining = await store.listStepArtifacts('run-12345678-abcd');
    expect(remaining.map((row) => row.stepIndex)).toEqual([1]);

    // The diagnostic row is reclaimed only once its own expiry (the
    // run's TTL) passes, not before.
    current = T0 + SEVEN_DAYS_MS - 1;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
    current = T0 + SEVEN_DAYS_MS;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(1);
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
  });

  it('treats a failed run\'s row without any recorded step state as diagnostic', async () => {
    let current = T0;
    const store = await storeWithArtifact(() => current, 'run-12345678-abcd');
    await store.finish('run-12345678-abcd', driverId, 'failed');
    current = T0 + AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS + 1;
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
    expect(await store.listStepArtifacts('run-12345678-abcd')).toHaveLength(1);
  });

  it('keeps the per-sweep limit: a backlog drains oldest-expiry first across sweeps', async () => {
    let current = T0;
    const store = await storeWithArtifact(() => current, 'run-12345678-abcd');
    await store.updateProgress('run-12345678-abcd', driverId, { artifacts: [artifactInput({ stepIndex: 1 })] });
    await store.finish('run-12345678-abcd', driverId, 'completed');
    current = T0 + AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS;
    await expect(store.sweepExpiredArtifacts(1)).resolves.toBe(1);
    await expect(store.sweepExpiredArtifacts(1)).resolves.toBe(1);
    await expect(store.sweepExpiredArtifacts(1)).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------
// Postgres store: a recorder pins the terminal-aware sweep statement
// shape (the semantic matrix above runs against the in-memory store).

type Row = Record<string, unknown>;

function result<T extends Row>(rows: T[]): QueryResult<T> {
  return { command: 'TEST', rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult<T>;
}

class Recorder implements AgentRunSqlExecutor {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: Row[][] = [];
  query<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    return Promise.resolve(result((this.responses.shift() ?? []) as T[]));
  }
}

describe('postgres step artifact lifecycle statements', () => {
  it('sweeps by own expiry or by terminal-plus-grace, oldest expiry first, with a bounded limit', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: 'run-12345678-abcd' }, { run_id: 'run-87654321-dcba' }]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.sweepExpiredArtifacts(50)).resolves.toBe(2);
    expect(database.calls).toHaveLength(1);
    const { text, values } = database.calls[0];
    expect(text).toContain('delete from public.origin_agent_run_artifacts');
    expect(text).toContain('a.expires_at <= clock_timestamp()');
    // The terminal rule joins the run row; the left join keeps any
    // orphan row on the expiry rule alone.
    expect(text).toContain('left join public.origin_agent_runs r on r.run_id = a.run_id');
    expect(text).toContain("r.status in ('completed', 'failed', 'cancelled', 'expired')");
    expect(text).toContain("r.updated_at <= clock_timestamp() - interval '24 hours'");
    // K-17: diagnostic rows of failed runs are carved out of the
    // terminal rule by the same steps_state derivation the read side
    // applies — a step entry that is missing or not completed marks
    // the row diagnostic.
    expect(text).toContain("not (r.status = 'failed'");
    expect(text).toContain("coalesce(r.steps_state -> a.step_index ->> 'status', '') <> 'completed'");
    expect(text).toContain('order by a.expires_at asc limit $1');
    expect(values).toEqual([50]);
    await expect(store.sweepExpiredArtifacts(0)).rejects.toThrow('AGENT_RUN_ARTIFACT_CLEANUP_LIMIT_INVALID');
  });

  it('pins the terminal grace constant to 24 hours', () => {
    expect(AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS).toBe(24 * 60 * 60 * 1000);
  });
});
