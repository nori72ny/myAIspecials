import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, describe, it } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { createCodingJobEnvelopeV14 } from '../src/agent/codingJobCryptoV14.js';
import { PostgresCodingJobStoreV14 } from '../src/agent/supabaseCodingJobStoreV14.js';
import { PostgresCodingJobResultStoreV14 } from '../src/agent/codingJobResultStoreV14.js';

// No fallback to POSTGRES_URL or other application credentials. This suite
// creates a private disposable database, never production tables or rows.
const rawUrl = process.env.ORIGIN_CODING_TEST_POSTGRES_URL;
assert.ok(rawUrl, 'A disposable ORIGIN_CODING_TEST_POSTGRES_URL is required');
const testUrl = new URL(rawUrl);
assert.ok(['postgres:', 'postgresql:'].includes(testUrl.protocol));
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(testUrl.hostname), 'Only a loopback test service is allowed');
assert.equal(testUrl.pathname, '/origin_coding_test');
assert.equal(testUrl.search, '', 'Connection query overrides are not allowed');
const databaseName = `origin_coding_test_${randomBytes(8).toString('hex')}`;
const admin = new Pool({ connectionString: rawUrl, max: 1, connectionTimeoutMillis: 3000 });
testUrl.pathname = `/${databaseName}`;
const db = new Pool({ connectionString: testUrl.toString(), max: 6, connectionTimeoutMillis: 3000,
  statement_timeout: 8000, idle_in_transaction_session_timeout: 15000 });
const jobs = new PostgresCodingJobStoreV14(db);
const results = new PostgresCodingJobResultStoreV14(db);
const cryptoEnv = {
  ORIGIN_CODING_JOB_DATA_KEY: randomBytes(32).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: randomBytes(32).toString('hex'),
};
const worker = 'test:worker:1';
const encryptedResult = `r1.${'A'.repeat(16)}.BBBB.${'C'.repeat(22)}`;
let createdDatabase = false;

async function newJob() {
  const envelope = createCodingJobEnvelopeV14({
    ownerBinding: 'integration-test', targetKey: 'origin:self', goal: 'Fix a bounded fixture',
  }, cryptoEnv);
  assert.ok(await jobs.create(envelope));
  return envelope;
}

async function runningJob() {
  const job = await newJob();
  assert.ok(await jobs.claimJob(job.jobId, worker, 120));
  assert.equal(await jobs.startJob(job.jobId, worker), true);
  return job;
}

async function pid(client: PoolClient): Promise<number> {
  return (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
}

// Observe an actual PostgreSQL lock wait. Timing alone is not concurrency proof.
async function waitForBlock(blocked: number, blocker: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const row = (await db.query<{ blocked: boolean }>(
      'select $2::integer = any(pg_blocking_pids($1::integer)) as blocked', [blocked, blocker],
    )).rows[0];
    if (row.blocked) return;
    await delay(10);
  }
  assert.fail('Expected a database row-lock wait was not observed');
}

async function raceClients(run: (a: PoolClient, b: PoolClient) => Promise<void>) {
  const a = await db.connect();
  const b = await db.connect();
  try {
    await run(a, b);
  } finally {
    // Releasing a transaction also unblocks any pending contender on failure.
    await a.query('rollback').catch(() => undefined);
    await b.query('rollback').catch(() => undefined);
    a.release();
    b.release();
  }
}

before(async () => {
  // Emulate Supabase's roles on the ephemeral test cluster. The application
  // migrations themselves are applied unchanged, twice to verify repeatability.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const exists = await admin.query('select 1 from pg_roles where rolname = $1', [role]);
    if (!exists.rowCount) await admin.query(`create role ${role} nologin`);
  }
  await admin.query(`create database ${databaseName}`);
  createdDatabase = true;
  for (let pass = 0; pass < 2; pass++) {
    for (const migration of ['20260911_origin_coding_jobs_v14.sql', '20260912_origin_coding_job_results_v14.sql']) {
      await db.query(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
    }
  }
});

after(async () => {
  await db.end();
  try {
    if (createdDatabase) await admin.query(`drop database ${databaseName}`);
  } finally {
    await admin.end();
  }
});

describe('Coding V1.4 real Postgres boundaries', { timeout: 20000 }, () => {
  it('applies both migrations, enables RLS, and denies browser roles', async () => {
    const rows = (await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid in ('public.origin_coding_jobs_v14'::regclass, 'public.origin_coding_job_results_v14'::regclass)",
    )).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.relrowsecurity));
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['origin_coding_jobs_v14', 'origin_coding_job_results_v14']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const row = (await db.query<{ allowed: boolean }>(
            'select has_table_privilege($1, $2, $3) as allowed', [role, `public.${table}`, privilege],
          )).rows[0];
          assert.equal(row.allowed, false);
        }
      }
    }
  });

  it('allows exactly one competing claim and hides the row from another owner', async () => {
    const job = await newJob();
    const claims = await Promise.all(Array.from({ length: 5 }, (_, i) => jobs.claimJob(job.jobId, `test:claim:${i}`, 120)));
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(claims.find(Boolean)?.attempt, 1);
    assert.equal(await jobs.getJob(job.jobId, 'f'.repeat(64)), null);
  });

  it('rejects result publication when cancellation commits while the writer waits', async () => {
    const job = await runningJob();
    await raceClients(async (canceller, writer) => {
      const [cancellerPid, writerPid] = await Promise.all([pid(canceller), pid(writer)]);
      await canceller.query('begin');
      const cancellingJobs = new PostgresCodingJobStoreV14(canceller);
      await cancellingJobs.requestCancel(job.jobId, job.ownerHash);
      assert.equal(await cancellingJobs.acknowledgeCancel(job.jobId, worker), true);
      const write = new PostgresCodingJobResultStoreV14(writer).put(job.jobId, worker, encryptedResult);
      void write.catch(() => undefined);
      await waitForBlock(writerPid, cancellerPid);
      await canceller.query('commit');
      assert.equal(await write, false);
    });
    assert.equal((await jobs.getJob(job.jobId, job.ownerHash))?.status, 'cancelled');
    assert.equal(await results.get(job.jobId), null);
  });

  it('serializes cancellation behind an earlier result write and erases the result', async () => {
    const job = await runningJob();
    await raceClients(async (writer, canceller) => {
      const [writerPid, cancellerPid] = await Promise.all([pid(writer), pid(canceller)]);
      await writer.query('begin');
      assert.equal(await new PostgresCodingJobResultStoreV14(writer).put(job.jobId, worker, encryptedResult), true);
      const cancellation = new PostgresCodingJobStoreV14(canceller).requestCancel(job.jobId, job.ownerHash);
      void cancellation.catch(() => undefined);
      await waitForBlock(cancellerPid, writerPid);
      await writer.query('commit');
      assert.equal((await cancellation)?.cancelRequested, true);
    });
    assert.equal(await jobs.acknowledgeCancel(job.jobId, worker), true);
    assert.equal(await results.get(job.jobId), null);
  });

  it('rechecks a replaced lease before allowing a stale worker to overwrite evidence', async () => {
    const job = await runningJob();
    assert.equal(await results.put(job.jobId, worker, encryptedResult), true);
    await raceClients(async (replacement, staleWriter) => {
      const [replacementPid, stalePid] = await Promise.all([pid(replacement), pid(staleWriter)]);
      await replacement.query('begin');
      // Advance the lease clock without a two-minute wall-clock sleep.
      await replacement.query("update public.origin_coding_jobs_v14 set lease_expires_at = clock_timestamp() - interval '1 second' where job_id = $1", [job.jobId]);
      const replacementJobs = new PostgresCodingJobStoreV14(replacement);
      assert.equal((await replacementJobs.recoverStaleJob(job.jobId))?.status, 'queued');
      assert.ok(await replacementJobs.claimJob(job.jobId, 'test:replacement', 120));
      const write = new PostgresCodingJobResultStoreV14(staleWriter).put(job.jobId, worker, encryptedResult.replace('BBBB', 'DDDD'));
      void write.catch(() => undefined);
      await waitForBlock(stalePid, replacementPid);
      await replacement.query('commit');
      assert.equal(await write, false);
    });
    assert.equal(await results.get(job.jobId), encryptedResult);
    assert.equal(await jobs.completeJob(job.jobId, worker, 'verified', 'CODING_VERIFIED', []), false);
  });

  it('prevents completion when a cancellation request wins the parent-row lock', async () => {
    const job = await runningJob();
    await raceClients(async (canceller, completer) => {
      const [cancellerPid, completerPid] = await Promise.all([pid(canceller), pid(completer)]);
      await canceller.query('begin');
      await new PostgresCodingJobStoreV14(canceller).requestCancel(job.jobId, job.ownerHash);
      const completion = new PostgresCodingJobStoreV14(completer).completeJob(job.jobId, worker, 'verified', 'CODING_VERIFIED', []);
      void completion.catch(() => undefined);
      await waitForBlock(completerPid, cancellerPid);
      await canceller.query('commit');
      assert.equal(await completion, false);
    });
    assert.equal(await jobs.acknowledgeCancel(job.jobId, worker), true);
  });

  it('preserves a verified terminal result when completion wins cancellation', async () => {
    const job = await runningJob();
    assert.equal(await results.put(job.jobId, worker, encryptedResult), true);
    assert.equal(await jobs.completeJob(job.jobId, worker, 'verified', 'CODING_VERIFIED', []), true);
    assert.equal((await jobs.requestCancel(job.jobId, job.ownerHash))?.status, 'verified');
    assert.equal(await results.get(job.jobId), encryptedResult);
  });

  it('recovers expired leases and erases the private payload after three attempts', async () => {
    const job = await newJob();
    for (let attempt = 1; attempt <= 3; attempt++) {
      assert.equal((await jobs.claimJob(job.jobId, worker, 120))?.attempt, attempt);
      await db.query("update public.origin_coding_jobs_v14 set lease_expires_at = clock_timestamp() - interval '1 second' where job_id = $1", [job.jobId]);
      assert.equal((await jobs.recoverStaleJob(job.jobId))?.status, attempt === 3 ? 'failed' : 'queued');
    }
    assert.equal(await jobs.claimJob(job.jobId, worker, 120), null);
    const row = (await db.query('select payload_ciphertext, result_code from public.origin_coding_jobs_v14 where job_id = $1', [job.jobId])).rows[0];
    assert.equal(row.payload_ciphertext, null);
    assert.equal(row.result_code, 'CODING_WORKER_RETRY_EXHAUSTED');
  });

  it('makes cancellation terminal immediately for an expired lease', async () => {
    const job = await runningJob();
    assert.equal(await results.put(job.jobId, worker, encryptedResult), true);
    await db.query("update public.origin_coding_jobs_v14 set lease_expires_at = clock_timestamp() - interval '1 second' where job_id = $1", [job.jobId]);
    assert.equal((await jobs.requestCancel(job.jobId, job.ownerHash))?.status, 'cancelled');
    assert.equal(await results.get(job.jobId), null);
    assert.equal(await jobs.claimJob(job.jobId, 'test:replacement', 120), null);
  });

  it('hides expired jobs and cascades bounded cleanup to result evidence', async () => {
    const job = await runningJob();
    assert.equal(await results.put(job.jobId, worker, encryptedResult), true);
    await db.query("update public.origin_coding_jobs_v14 set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' where job_id = $1", [job.jobId]);
    assert.equal(await jobs.getJob(job.jobId, job.ownerHash), null);
    assert.equal(await jobs.deleteExpired(1), 1);
    assert.equal(await results.get(job.jobId), null);
  });
});
