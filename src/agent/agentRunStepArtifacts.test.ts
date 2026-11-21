// @vitest-environment node
import { createHash } from 'node:crypto';
import type { QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_RUN_ARTIFACTS_TOTAL_CHARS,
  computeAgentRunStepFingerprint,
  validatePutAgentRunStepArtifactInput,
  validatePutAgentRunStepArtifacts,
  type AgentRunPlanStep,
  type PutAgentRunStepArtifactInput,
} from './agentRunRecord.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { PostgresAgentRunStore, type AgentRunSqlExecutor } from './supabaseAgentRunStore.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const fingerprint = 'b'.repeat(64);
const ownerBinding = 'a'.repeat(64);
const digest = 'c'.repeat(64);
const runId = 'run-12345678-abcd';
const otherRunId = 'run-87654321-dcba';
const driverId = 'driver-alpha-1';

function artifactInput(overrides: Partial<PutAgentRunStepArtifactInput> = {}): PutAgentRunStepArtifactInput {
  return {
    stepIndex: 0,
    stepFingerprint: fingerprint,
    attempt: 1,
    artifact: 'step output body',
    ...overrides,
  };
}

describe('step artifact record contract', () => {
  it('measures the body itself: byte size and digest are recomputed, never caller-supplied', () => {
    const normalized = validatePutAgentRunStepArtifactInput(artifactInput({ artifact: 'メモです' }));
    expect(normalized.charCount).toBe(4);
    expect(normalized.artifactBytes).toBe(Buffer.byteLength('メモです', 'utf8'));
    expect(normalized.artifactSha256).toBe(sha256('メモです'));
  });

  it('rejects an artifact past the char cap instead of truncating it', () => {
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ artifact: 'x'.repeat(120_001) })))
      .toThrow('AGENT_RUN_ARTIFACT_TOO_LARGE');
    const atCap = validatePutAgentRunStepArtifactInput(artifactInput({ artifact: 'x'.repeat(120_000) }));
    expect(atCap.charCount).toBe(120_000);
  });

  it('rejects secret-bearing bodies whole, with the dedicated code', () => {
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ artifact: 'token = "abc123"' })))
      .toThrow('AGENT_RUN_ARTIFACT_SECRET_CONTENT_BLOCKED');
  });

  it('rejects malformed step references before any size work', () => {
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ stepIndex: -1 }))).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ stepIndex: 20 }))).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ stepIndex: 1.5 }))).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ stepFingerprint: 'not-a-hash' }))).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ attempt: 11 }))).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    expect(() => validatePutAgentRunStepArtifactInput(artifactInput({ attempt: -1 }))).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  });

  it('rejects empty batches and duplicate steps inside one batch', () => {
    expect(() => validatePutAgentRunStepArtifacts([])).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    expect(() => validatePutAgentRunStepArtifacts([artifactInput(), artifactInput()])).toThrow('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    const batch = validatePutAgentRunStepArtifacts([artifactInput(), artifactInput({ stepIndex: 1 })]);
    expect(batch.map((entry) => entry.stepIndex)).toEqual([0, 1]);
  });
});

describe('step fingerprint', () => {
  const params = { contentFromStep: 0, path: 'docs/out.md' };

  it('is a sha256 over the step content, independent of key order', () => {
    const first = computeAgentRunStepFingerprint('file_writer', params);
    const reordered = computeAgentRunStepFingerprint('file_writer', { path: 'docs/out.md', contentFromStep: 0 });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
  });

  it('changes when the tool, the params or a data-flow marker changes', () => {
    const base = computeAgentRunStepFingerprint('file_writer', params);
    expect(computeAgentRunStepFingerprint('web_search', params)).not.toBe(base);
    expect(computeAgentRunStepFingerprint('file_writer', { ...params, path: 'docs/other.md' })).not.toBe(base);
    expect(computeAgentRunStepFingerprint('file_writer', { ...params, contentFromStep: 1 })).not.toBe(base);
    expect(computeAgentRunStepFingerprint('file_writer', { path: 'docs/out.md', contentFromPreviousArtifact: true })).not.toBe(base);
  });
});

// ---------------------------------------------------------------------
// In-memory store semantics (the matrix the Postgres statement shape
// is pinned against below; the SQL itself is verified against a real
// Postgres — PGlite — before this PR is reported, per the 42P08
// lesson that a fake executor cannot see server parse errors).

const plan: AgentRunPlanStep[] = [
  { toolName: 'repository_explorer', params: {}, dependsOn: [] },
  { toolName: 'file_writer', params: { path: 'docs/out.md' }, dependsOn: [0], inputFrom: 0 },
];

async function claimedStore(now: () => number) {
  const store = new InMemoryAgentRunStore(now);
  const created = await store.create({
    runId,
    ownerBinding,
    goal: 'Survey the repository and write a summary',
    status: 'queued',
    plan,
    planDigest: digest,
    expiresAt: now() + 3_600_000,
  }, now());
  expect(created?.status).toBe('queued');
  const lease = await store.claim(runId, driverId, 300);
  expect(lease?.driverId).toBe(driverId);
  return store;
}

describe('in-memory step artifact store', () => {
  it('saves artifacts with the progress write and lists them by step index', async () => {
    const current = 1_700_000_000_000;
    const store = await claimedStore(() => current);
    const applied = await store.updateProgress(runId, driverId, {
      stepsState: [{ id: 'step-1', status: 'completed', attempts: 1 }],
      artifacts: [artifactInput({ stepIndex: 1, artifact: 'second' }), artifactInput({ stepIndex: 0, artifact: 'first' })],
    });
    expect(applied).toBe(true);
    const listed = await store.listStepArtifacts(runId);
    expect(listed.map((entry) => entry.stepIndex)).toEqual([0, 1]);
    expect(listed[0]).toMatchObject({
      runId,
      stepFingerprint: fingerprint,
      attempt: 1,
      artifact: 'first',
      artifactBytes: 5,
      artifactSha256: sha256('first'),
      expiresAt: current + 3_600_000,
    });
    expect(await store.listStepArtifacts(otherRunId)).toEqual([]);
    expect(await store.listStepArtifacts('bogus')).toEqual([]);
  });

  it('accepts an artifacts-only progress write, and still rejects an empty patch', async () => {
    const store = await claimedStore(() => 1_700_000_000_000);
    await expect(store.updateProgress(runId, driverId, {})).rejects.toThrow('AGENT_RUN_PROGRESS_INPUT_INVALID');
    await expect(store.updateProgress(runId, driverId, { artifacts: [artifactInput()] })).resolves.toBe(true);
    expect(await store.listStepArtifacts(runId)).toHaveLength(1);
  });

  it('writes nothing when the driver fence does not match', async () => {
    const store = await claimedStore(() => 1_700_000_000_000);
    await expect(store.updateProgress(runId, 'driver-other-2', { artifacts: [artifactInput()] })).resolves.toBe(false);
    expect(await store.listStepArtifacts(runId)).toEqual([]);
  });

  it('overwrites a step artifact on a later completion of the same step', async () => {
    const store = await claimedStore(() => 1_700_000_000_000);
    await store.updateProgress(runId, driverId, { artifacts: [artifactInput({ artifact: 'draft', attempt: 1 })] });
    await store.updateProgress(runId, driverId, {
      artifacts: [artifactInput({ artifact: 'final', attempt: 2, stepFingerprint: 'd'.repeat(64) })],
    });
    const listed = await store.listStepArtifacts(runId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ artifact: 'final', attempt: 2, stepFingerprint: 'd'.repeat(64) });
  });

  it('keeps the progress write but skips saving when the run total cap would be exceeded', async () => {
    const store = await claimedStore(() => 1_700_000_000_000);
    const chunk = 'x'.repeat(117_000);
    for (let stepIndex = 0; stepIndex < 17; stepIndex += 1) {
      await store.updateProgress(runId, driverId, { artifacts: [artifactInput({ stepIndex, artifact: chunk })] });
    }
    expect(await store.listStepArtifacts(runId)).toHaveLength(17);
    const applied = await store.updateProgress(runId, driverId, {
      stepsState: [{ id: 'step-18', status: 'completed', attempts: 1 }],
      artifacts: [artifactInput({ stepIndex: 17, artifact: 'y'.repeat(20_000) })],
    });
    // 17 * 117,000 + 20,000 = 2,009,000 > 2,000,000: the step's
    // progress is recorded, its artifact is not (and not truncated).
    expect(applied).toBe(true);
    const record = await store.get(runId, ownerBinding);
    expect(record?.stepsState).toEqual([{ id: 'step-18', status: 'completed', attempts: 1 }]);
    expect(await store.listStepArtifacts(runId)).toHaveLength(17);
    // Replacing an existing step does not double-count against the cap.
    await store.updateProgress(runId, driverId, { artifacts: [artifactInput({ stepIndex: 0, artifact: 'z'.repeat(120_000) })] });
    const listed = await store.listStepArtifacts(runId);
    expect(listed).toHaveLength(17);
    expect(listed[0]?.artifact).toHaveLength(120_000);
    expect(MAX_AGENT_RUN_ARTIFACTS_TOTAL_CHARS).toBe(2_000_000);
  });

  it('hides artifacts once their retention passes and sweeps them', async () => {
    let current = 1_700_000_000_000;
    const store = await claimedStore(() => current);
    await store.updateProgress(runId, driverId, { artifacts: [artifactInput()] });
    current += 3_600_001;
    expect(await store.listStepArtifacts(runId)).toEqual([]);
    await expect(store.sweepExpiredArtifacts(0)).rejects.toThrow('AGENT_RUN_ARTIFACT_CLEANUP_LIMIT_INVALID');
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(1);
    await expect(store.sweepExpiredArtifacts()).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------
// Postgres store: a recorder pins the statement shape (the semantic
// matrix above runs against the in-memory store). The fenced CTE's
// atomicity — a lost fence leaves no artifact rows — is a property of
// the SQL itself and is verified against a real Postgres (PGlite)
// before this PR is reported.

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

describe('postgres step artifact statements', () => {
  it('upserts artifacts inside the same fenced statement as the progress write', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: runId }]);
    const store = new PostgresAgentRunStore(database);
    const applied = await store.updateProgress(runId, driverId, {
      stepsState: [{ id: 'step-1', status: 'completed', attempts: 1 }],
      artifacts: [artifactInput({ artifact: 'first' })],
    });
    expect(applied).toBe(true);
    expect(database.calls).toHaveLength(1);
    const { text, values } = database.calls[0];
    expect(text).toContain('with progress as');
    expect(text).toContain("status = 'running'");
    expect(text).toContain('insert into public.origin_agent_run_artifacts');
    expect(text).toContain('from progress p');
    expect(text).toContain('on conflict (run_id, step_index) do update');
    // The batch travels as one jsonb parameter so no parameter type
    // is ever deduced from two different uses (the 42P08 lesson).
    expect(text).toContain('jsonb_to_recordset($7::jsonb)');
    const batch = JSON.parse(String(values[6])) as Array<Record<string, unknown>>;
    expect(batch).toEqual([{
      step_index: 0,
      step_fingerprint: fingerprint,
      attempt: 1,
      artifact: 'first',
      artifact_bytes: 5,
      artifact_sha256: sha256('first'),
    }]);
    expect(values[7]).toBe(5);
    expect(values[8]).toBe(MAX_AGENT_RUN_ARTIFACTS_TOTAL_CHARS);
  });

  it('keeps the plain progress statement when no artifacts ride along', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: runId }]);
    const store = new PostgresAgentRunStore(database);
    await store.updateProgress(runId, driverId, { stepsState: [{ id: 'step-1', status: 'running', attempts: 1 }] });
    expect(database.calls[0].text).toContain('update public.origin_agent_runs');
    expect(database.calls[0].text).not.toContain('origin_agent_run_artifacts');
  });

  it('parses artifact rows and verifies their integrity fields against the body', async () => {
    const database = new Recorder();
    const now = 1_700_000_000_000;
    database.responses.push([{
      run_id: runId, step_index: 0, step_fingerprint: fingerprint, attempt: 1,
      artifact: 'first', artifact_bytes: 5, artifact_sha256: sha256('first'),
      created_ms: String(now), expires_ms: String(now + 3_600_000),
    }]);
    const store = new PostgresAgentRunStore(database);
    const listed = await store.listStepArtifacts(runId);
    expect(listed).toEqual([{
      runId, stepIndex: 0, stepFingerprint: fingerprint, attempt: 1,
      artifact: 'first', artifactBytes: 5, artifactSha256: sha256('first'),
      createdAt: now, expiresAt: now + 3_600_000,
    }]);
    expect(database.calls[0].text).toContain('order by step_index asc');

    database.responses.push([{
      run_id: runId, step_index: 0, step_fingerprint: fingerprint, attempt: 1,
      artifact: 'first', artifact_bytes: 5, artifact_sha256: sha256('tampered'),
      created_ms: String(now), expires_ms: String(now + 3_600_000),
    }]);
    await expect(store.listStepArtifacts(runId)).rejects.toThrow('AGENT_RUN_DB_ROW_INVALID');
  });

  it('sweeps expired artifacts oldest first with a bounded limit', async () => {
    const database = new Recorder();
    database.responses.push([{ run_id: runId }, { run_id: otherRunId }]);
    const store = new PostgresAgentRunStore(database);
    await expect(store.sweepExpiredArtifacts(50)).resolves.toBe(2);
    expect(database.calls[0].text).toContain('delete from public.origin_agent_run_artifacts');
    expect(database.calls[0].text).toContain('order by expires_at asc limit $1');
    await expect(store.sweepExpiredArtifacts(0)).rejects.toThrow('AGENT_RUN_ARTIFACT_CLEANUP_LIMIT_INVALID');
  });
});
