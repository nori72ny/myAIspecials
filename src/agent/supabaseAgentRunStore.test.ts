// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { QueryResult } from 'pg';
import { PostgresAgentRunStore, type AgentRunSqlExecutor } from './supabaseAgentRunStore.js';
import type { AgentRunHold, AgentRunPlanStep, CreateAgentRunInput } from './agentRunRecord.js';

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

const now = 1_700_000_000_000;
const ownerBinding = 'a'.repeat(64);
const otherOwnerBinding = 'c'.repeat(64);
const digest = 'b'.repeat(64);
const runId = 'run-12345678-abcd';
const driverId = 'driver-alpha-1';

const plan: AgentRunPlanStep[] = [
  { toolName: 'repository_explorer', params: {}, dependsOn: [] },
  { toolName: 'file_writer', params: { path: 'docs/out.md' }, dependsOn: [0], inputFrom: 0 },
];
const hold: AgentRunHold = {
  reason: 'quota_exhausted',
  resumeCondition: { kind: 'quota_reset', provider: 'openrouter', resetAt: now + 3_600_000 },
  heldSince: now,
  resumeAttempts: 1,
};

function dbRow(overrides: Row = {}): Row {
  return {
    run_id: runId,
    owner_binding: ownerBinding,
    goal: 'Survey the repository and write a summary',
    status: 'planning',
    plan: null,
    plan_digest: null,
    steps_state: [],
    parent_run_id: null,
    priority: 0,
    hold: null,
    quota_ledger: {},
    prior_resume_attempts: null,
    approval_deadline_ms: null,
    version: 1,
    created_ms: String(now),
    updated_ms: String(now),
    expires_ms: String(now + 3_600_000),
    ...overrides,
  };
}

function createInput(overrides: Partial<CreateAgentRunInput> = {}): CreateAgentRunInput {
  return {
    runId,
    ownerBinding,
    goal: 'Survey the repository and write a summary',
    expiresAt: now + 3_600_000,
    ...overrides,
  };
}

describe('PostgresAgentRunStore create and read', () => {
  it('creates a planning run through parameters only and returns the parsed record', async () => {
    const database = new Recorder();
    database.responses.push([dbRow()]);
    const store = new PostgresAgentRunStore(database);
    const created = await store.create(createInput(), now);
    expect(created).toMatchObject({ runId, ownerBinding, status: 'planning', plan: null, version: 1 });
    expect(database.calls[0].text).toContain('insert into public.origin_agent_runs');
    expect(database.calls[0].text).toContain('on conflict (run_id) do nothing');
    expect(database.calls[0].text).not.toContain('Survey the repository');
    expect(database.calls[0].values).toContain('Survey the repository and write a summary');
  });

  it('returns null when the run id already exists', async () => {
    const database = new Recorder();
    database.responses.push([]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.create(createInput(), now)).resolves.toBeNull();
  });

  it('creates a held run with its hold record and no plan', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({ status: 'held', hold, prior_resume_attempts: hold.resumeAttempts })]);
    const store = new PostgresAgentRunStore(database);
    const created = await store.create(createInput({ status: 'held', hold }), now);
    expect(created?.status).toBe('held');
    expect(created?.hold).toEqual(hold);
    expect(JSON.parse(String(database.calls[0].values[9]))).toEqual(hold);
  });

  it('scopes reads by owner binding and never queries for malformed identifiers', async () => {
    const database = new Recorder();
    database.responses.push([dbRow()]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.get(runId, ownerBinding)).resolves.toMatchObject({ runId });
    expect(database.calls[0].values).toEqual([runId, ownerBinding]);
    await expect(store.get(runId, 'not-a-hash')).resolves.toBeNull();
    await expect(store.get('bogus', ownerBinding)).resolves.toBeNull();
    expect(database.calls).toHaveLength(1);
    database.responses.push([]);
    await expect(store.get(runId, otherOwnerBinding)).resolves.toBeNull();
  });

  it('lists runs for the board ordered by priority with an optional status filter', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({ priority: 5 }), dbRow({ run_id: 'run-87654321-dcba' })]);
    const store = new PostgresAgentRunStore(database);
    const listed = await store.listByOwner(ownerBinding, { statuses: ['held', 'queued'], limit: 10 });
    expect(listed).toHaveLength(2);
    expect(database.calls[0].text).toContain('order by priority desc, created_at desc');
    expect(database.calls[0].text).toContain('status = any($2::text[])');
    expect(database.calls[0].values[1]).toEqual(['held', 'queued']);
    await expect(store.listByOwner(ownerBinding, { limit: 0 })).rejects.toThrow('AGENT_RUN_LIST_INPUT_INVALID');
    await expect(store.listByOwner('raw-name')).resolves.toEqual([]);
  });
});

describe('PostgresAgentRunStore transitions', () => {
  it('moves planning to awaiting_approval with the plan snapshot bound to its digest', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({ status: 'awaiting_approval', plan, plan_digest: digest, version: 2, approval_deadline_ms: String(now + 720_000) })]);
    const store = new PostgresAgentRunStore(database);
    const moved = await store.transition({
      runId, ownerBinding, expectedStatus: 'planning', expectedVersion: 1,
      nextStatus: 'awaiting_approval', plan, planDigest: digest,
      approvalDeadlineAt: now + 720_000,
    });
    expect(moved).toMatchObject({ status: 'awaiting_approval', version: 2, approvalDeadlineAt: now + 720_000 });
    expect(database.calls[0].text).toContain('status = $14 and version = $15');
    expect(JSON.parse(String(database.calls[0].values[4]))).toEqual(plan);
    // Entering awaiting_approval without a deadline is refused up front.
    await expect(store.transition({
      runId, ownerBinding, expectedStatus: 'planning', expectedVersion: 1,
      nextStatus: 'awaiting_approval', plan, planDigest: digest,
    })).rejects.toThrow('AGENT_RUN_TRANSITION_INPUT_INVALID');
  });

  it('returns null when the expected status or version no longer matches', async () => {
    const database = new Recorder();
    database.responses.push([]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.transition({
      runId, ownerBinding, expectedStatus: 'planning', expectedVersion: 1, nextStatus: 'cancelled',
    })).resolves.toBeNull();
  });

  it('rejects illegal transitions before any SQL is issued', async () => {
    const database = new Recorder();
    const store = new PostgresAgentRunStore(database);
    await expect(store.transition({
      runId, ownerBinding, expectedStatus: 'held', expectedVersion: 3, nextStatus: 'queued',
    })).rejects.toThrow('AGENT_RUN_TRANSITION_DENIED');
    await expect(store.transition({
      runId, ownerBinding, expectedStatus: 'queued', expectedVersion: 1, nextStatus: 'running',
    })).rejects.toThrow('AGENT_RUN_TRANSITION_DENIED');
    await expect(store.transition({
      runId, ownerBinding, expectedStatus: 'queued', expectedVersion: 1, nextStatus: 'held',
    })).rejects.toThrow('AGENT_RUN_TRANSITION_INPUT_INVALID');
    expect(database.calls).toHaveLength(0);
  });

  it('requires hold data when entering held and clears it when leaving held', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({ status: 'held', plan, plan_digest: digest, hold, version: 4, prior_resume_attempts: hold.resumeAttempts })]);
    const store = new PostgresAgentRunStore(database);
    const heldRun = await store.transition({
      runId, ownerBinding, expectedStatus: 'awaiting_approval', expectedVersion: 3,
      nextStatus: 'held', hold,
    });
    expect(heldRun?.hold).toEqual(hold);
    expect(heldRun?.approvalDeadlineAt).toBeNull();
    expect(heldRun?.priorResumeAttempts).toBe(hold.resumeAttempts);
    expect(JSON.parse(String(database.calls[0].values[12]))).toEqual(hold);
    database.responses.push([dbRow({ status: 'awaiting_approval', plan, plan_digest: digest, version: 5, approval_deadline_ms: String(now + 720_000) })]);
    const resumed = await store.transition({
      runId, ownerBinding, expectedStatus: 'held', expectedVersion: 4, nextStatus: 'awaiting_approval',
      approvalDeadlineAt: now + 720_000,
    });
    expect(resumed?.hold).toBeNull();
    expect(resumed?.approvalDeadlineAt).toBe(now + 720_000);
    expect(database.calls[1].text).toContain("when $14 = 'held' then null");
  });
});

describe('PostgresAgentRunStore driver lease lifecycle', () => {
  it('claims a queued run and returns the lease record', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({
      status: 'running', plan, plan_digest: digest, version: 2,
      driver_id: driverId, lease_ms: String(now + 120_000),
    })]);
    const store = new PostgresAgentRunStore(database);
    const lease = await store.claim(runId, driverId, 120);
    expect(lease).toMatchObject({ runId, status: 'running', driverId, leaseExpiresAt: now + 120_000 });
    expect(database.calls[0].text).toContain("status = 'queued'");
    expect(database.calls[0].text).toContain('lease_expires_at <= clock_timestamp()');
  });

  it('cannot claim a run that is not queued or stale', async () => {
    const database = new Recorder();
    database.responses.push([]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.claim(runId, driverId, 120)).resolves.toBeNull();
    await expect(store.claim(runId, 'x', 120)).rejects.toThrow('AGENT_RUN_CLAIM_INPUT_INVALID');
    await expect(store.claim(runId, driverId, 10)).rejects.toThrow('AGENT_RUN_CLAIM_INPUT_INVALID');
  });

  it('renews the lease only for the holding driver', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: runId }]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.renewLease(runId, driverId, 120)).resolves.toBe(true);
    expect(database.calls[0].text).toContain("status = 'running'");
    expect(database.calls[0].text).toContain('lease_expires_at > clock_timestamp()');
    database.responses.push([]);
    await expect(store.renewLease(runId, 'driver-other-2', 120)).resolves.toBe(false);
  });

  it('updates progress only while the driver lease is live', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: runId }]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.updateProgress(runId, driverId, {
      stepsState: [{ id: 'step-1', status: 'running', attempts: 1 }],
      quotaLedger: { tavily: { credits: 1 } },
    })).resolves.toBe(true);
    await expect(store.updateProgress(runId, driverId, {})).rejects.toThrow('AGENT_RUN_PROGRESS_INPUT_INVALID');
    database.responses.push([]);
    await expect(store.updateProgress(runId, driverId, { stepsState: [] })).resolves.toBe(false);
  });

  it('finishes a run from the holding driver and clears the lease', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({ status: 'completed', plan, plan_digest: digest, version: 6 })]);
    const store = new PostgresAgentRunStore(database);
    const finished = await store.finish(runId, driverId, 'completed');
    expect(finished).toMatchObject({ status: 'completed' });
    expect(database.calls[0].text).toContain('driver_id = null, lease_expires_at = null');
    await expect(store.finish(runId, driverId, 'held')).rejects.toThrow('AGENT_RUN_FINISH_INPUT_INVALID');
    database.responses.push([dbRow({ status: 'held', plan, plan_digest: digest, hold, version: 7, prior_resume_attempts: hold.resumeAttempts })]);
    const heldFinish = await store.finish(runId, driverId, 'held', hold);
    expect(heldFinish).toMatchObject({ status: 'held', priorResumeAttempts: hold.resumeAttempts });
    // The finish into held carries the hold's attempt count as a parameter.
    expect(database.calls[1].values[4]).toBe(hold.resumeAttempts);
  });

  it('recovers a stale running run back to queued', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({ status: 'queued', plan, plan_digest: digest, version: 3 })]);
    const store = new PostgresAgentRunStore(database);
    const recovered = await store.recoverStale(runId);
    expect(recovered).toMatchObject({ status: 'queued' });
    expect(database.calls[0].text).toContain("status = 'queued', driver_id = null");
    database.responses.push([]);
    await expect(store.recoverStale(runId)).resolves.toBeNull();
  });

  it('sweeps due non-terminal runs into expired without touching terminal history', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: runId }, { run_id: 'run-87654321-dcba' }]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.markExpired(50)).resolves.toBe(2);
    expect(database.calls[0].text).toContain("status not in ('completed', 'failed', 'cancelled', 'expired')");
    expect(database.calls[0].text).toContain("set status = 'expired'");
    await expect(store.markExpired(0)).rejects.toThrow('AGENT_RUN_CLEANUP_LIMIT_INVALID');
  });
});

describe('PostgresAgentRunStore approval deadline refresh (PR 1-G)', () => {
  it('extends the deadline only while the run awaits approval, without touching version or updated_at', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: runId }]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.refreshApprovalDeadline(runId, ownerBinding, now + 720_000)).resolves.toBe(true);
    expect(database.calls[0].text).toContain("status = 'awaiting_approval'");
    expect(database.calls[0].text).not.toContain('version = version + 1');
    expect(database.calls[0].text).not.toContain('updated_at = clock_timestamp()');
    expect(database.calls[0].values).toEqual([runId, ownerBinding, now + 720_000]);
    database.responses.push([]);
    await expect(store.refreshApprovalDeadline(runId, ownerBinding, now + 720_000)).resolves.toBe(false);
    await expect(store.refreshApprovalDeadline(runId, 'not-a-hash', now + 720_000)).resolves.toBe(false);
  });
});

describe('PostgresAgentRunStore row integrity', () => {
  it('rejects rows whose stored shape violates the record contract', async () => {
    const database = new Recorder();
    const store = new PostgresAgentRunStore(database);
    database.responses.push([dbRow({ status: 'bogus' })]);
    await expect(store.get(runId, ownerBinding)).rejects.toThrow('AGENT_RUN_DB_ROW_INVALID');
    database.responses.push([dbRow({ status: 'held', hold: null })]);
    await expect(store.get(runId, ownerBinding)).rejects.toThrow('AGENT_RUN_DB_ROW_INVALID');
    database.responses.push([dbRow({ plan, plan_digest: null })]);
    await expect(store.get(runId, ownerBinding)).rejects.toThrow('AGENT_RUN_DB_ROW_INVALID');
    database.responses.push([dbRow({ owner_binding: 'raw-owner-name' })]);
    await expect(store.get(runId, ownerBinding)).rejects.toThrow('AGENT_RUN_DB_ROW_INVALID');
  });

  it('parses jsonb columns that arrive as serialized strings', async () => {
    const database = new Recorder();
    database.responses.push([dbRow({
      status: 'awaiting_approval',
      plan: JSON.stringify(plan),
      plan_digest: digest,
      steps_state: JSON.stringify([{ id: 'step-1', status: 'queued', attempts: 0 }]),
      quota_ledger: JSON.stringify({ openrouter: { requests: 2 } }),
      approval_deadline_ms: String(now + 720_000),
    })]);
    const store = new PostgresAgentRunStore(database);
    const record = await store.get(runId, ownerBinding);
    expect(record?.plan).toEqual(plan);
    expect(record?.stepsState).toEqual([{ id: 'step-1', status: 'queued', attempts: 0 }]);
    expect(record?.quotaLedger).toEqual({ openrouter: { requests: 2 } });
  });
});
