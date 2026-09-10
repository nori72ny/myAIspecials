// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { QueryResult } from 'pg';
import { createCodingJobEnvelopeV14 } from './codingJobCryptoV14.js';
import { CODING_JOB_MAX_ATTEMPTS, PostgresCodingJobStoreV14, type CodingJobSqlExecutorV14 } from './supabaseCodingJobStoreV14.js';

type Row = Record<string, unknown>;
const env = {
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 9).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 13).toString('base64'),
};

function result<T extends Row>(rows: T[]): QueryResult<T> {
  return { command: 'TEST', rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult<T>;
}
class Recorder implements CodingJobSqlExecutorV14 {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: Row[][] = [];
  query<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    return Promise.resolve(result((this.responses.shift() ?? []) as T[]));
  }
}

const now = 1_700_000_000_000;
function dbRow(envelope: ReturnType<typeof createCodingJobEnvelopeV14>, overrides: Row = {}): Row {
  return {
    job_id: envelope.jobId,
    target_key: envelope.targetKey,
    status: 'queued',
    attempt: 0,
    version: 1,
    cancel_requested: false,
    result_code: null,
    changed_paths: [],
    created_ms: String(now),
    updated_ms: String(now),
    expires_ms: String(envelope.expiresAt),
    ...overrides,
  };
}

describe('V1.4 durable coding job store SQL boundary', () => {
  it('creates only encrypted, owner-hashed durable records through parameters', async () => {
    const database = new Recorder();
    const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'user:42', targetKey: 'github:nori72ny/myAIspecials', goal: 'Fix the renderer' }, env, now);
    database.responses.push([dbRow(envelope)]);
    const store = new PostgresCodingJobStoreV14(database);
    const created = await store.create(envelope, now);
    expect(created).toMatchObject({ jobId: envelope.jobId, status: 'queued', targetKey: envelope.targetKey, cancelRequested: false });
    expect(database.calls[0].text).toContain('on conflict (job_id) do nothing');
    expect(database.calls[0].text).not.toContain('Fix the renderer');
    expect(database.calls[0].values).toContain(envelope.payloadCiphertext);
    expect(database.calls[0].values).toContain(envelope.ownerHash);
  });

  it('scopes user reads and cancellation by owner hash', async () => {
    const database = new Recorder();
    const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'owner-a', targetKey: 'github:repo/a', goal: 'Fix A' }, env, now);
    database.responses.push([dbRow(envelope, { status: 'running', attempt: 1, version: 3, cancel_requested: true })]);
    const store = new PostgresCodingJobStoreV14(database);
    const cancelled = await store.requestCancel(envelope.jobId, envelope.ownerHash);
    expect(cancelled?.cancelRequested).toBe(true);
    expect(database.calls[0].text).toContain('owner_hash = $2');
    expect(database.calls[0].values).toEqual([envelope.jobId, envelope.ownerHash]);
  });

  it('claims exactly one eligible job with bounded lease, cancellation and retry predicates', async () => {
    const database = new Recorder();
    const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'owner-a', targetKey: 'github:repo/a', goal: 'Fix A' }, env, now);
    database.responses.push([dbRow(envelope, {
      status: 'leased', attempt: 1, version: 2,
      payload_ciphertext: envelope.payloadCiphertext,
      lease_owner: 'gha:123:1', lease_ms: String(now + 60_000),
    })]);
    const store = new PostgresCodingJobStoreV14(database);
    const lease = await store.claimJob(envelope.jobId, 'gha:123:1', 60);
    expect(lease).toMatchObject({ status: 'leased', attempt: 1, leaseOwner: 'gha:123:1' });
    const sql = database.calls[0].text;
    expect(sql).toContain('cancel_requested_at is null');
    expect(sql).toContain('lease_expires_at <= clock_timestamp()');
    expect(sql).toContain('attempt < $4');
    expect(database.calls[0].values).toEqual([envelope.jobId, 'gha:123:1', 60, CODING_JOB_MAX_ATTEMPTS]);
  });

  it('makes cancellation win over a later completion by requiring no cancel request', async () => {
    const database = new Recorder();
    const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'owner-a', targetKey: 'github:repo/a', goal: 'Fix A' }, env, now);
    database.responses.push([]);
    const store = new PostgresCodingJobStoreV14(database);
    await expect(store.completeJob(envelope.jobId, 'gha:123:1', 'verified', 'CODING_CHECKS_PASSED', ['src/app.ts'])).resolves.toBe(false);
    expect(database.calls[0].text).toContain('cancel_requested_at is null');
    expect(database.calls[0].text).toContain('lease_owner = $2');
    expect(database.calls[0].values[4]).toBe(JSON.stringify(['src/app.ts']));
  });

  it('recovers an expired lease to queued/cancelled/failed using the retry budget and clears ownership', async () => {
    const database = new Recorder();
    const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'owner-a', targetKey: 'github:repo/a', goal: 'Fix A' }, env, now);
    database.responses.push([dbRow(envelope, { status: 'failed', attempt: 3, version: 8, result_code: 'CODING_WORKER_RETRY_EXHAUSTED' })]);
    const store = new PostgresCodingJobStoreV14(database);
    const recovered = await store.recoverStaleJob(envelope.jobId);
    expect(recovered).toMatchObject({ status: 'failed', resultCode: 'CODING_WORKER_RETRY_EXHAUSTED' });
    const sql = database.calls[0].text;
    expect(sql).toContain("when cancel_requested_at is not null then 'cancelled'");
    expect(sql).toContain("when attempt >= $2 then 'failed'");
    expect(sql).toContain('lease_owner = null');
  });

  it('fails closed on arbitrary targets, workers and changed paths', async () => {
    const database = new Recorder();
    const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'owner-a', targetKey: '../filesystem', goal: 'Fix A' }, env, now);
    const store = new PostgresCodingJobStoreV14(database);
    await expect(store.create(envelope, now)).rejects.toThrow('CODING_JOB_CREATE_INPUT_INVALID');
    await expect(store.claimJob('coding-1234567890123456789012', 'x', 60)).rejects.toThrow('CODING_JOB_CLAIM_INPUT_INVALID');
    await expect(store.completeJob('coding-1234567890123456789012', 'worker:123', 'verified', 'CODING_CHECKS_PASSED', ['package.json'])).rejects.toThrow('CODING_JOB_CHANGED_PATHS_INVALID');
    expect(database.calls).toHaveLength(0);
  });
});
