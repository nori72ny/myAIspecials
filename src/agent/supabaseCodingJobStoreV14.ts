import { Pool, type QueryResult } from 'pg';
import { CODING_JOB_CIPHERTEXT_PATTERN, CODING_JOB_ID_PATTERN, CODING_JOB_OWNER_HASH_PATTERN, MAX_CODING_JOB_TTL_MS, type CodingJobEnvelopeV14 } from './codingJobCryptoV14.js';
import { normalizeCodingMutablePathV14 } from './codingPathPolicyV14.js';

export const CODING_JOB_MAX_ATTEMPTS = 3;
export const CODING_JOB_MIN_LEASE_SECONDS = 30;
export const CODING_JOB_MAX_LEASE_SECONDS = 300;
const TARGET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const WORKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const RESULT_CODE_PATTERN = /^CODING_[A-Z0-9_]{1,120}$/;
const ACTIVE_STATUSES = ['leased', 'running', 'repairing'] as const;
const TERMINAL_STATUSES = ['verified', 'blocked', 'failed', 'cancelled'] as const;

export type CodingJobStatusV14 = 'queued' | typeof ACTIVE_STATUSES[number] | typeof TERMINAL_STATUSES[number];
export type CodingJobCompletionStatusV14 = 'verified' | 'blocked' | 'failed';
export type CodingJobPublicRecordV14 = {
  jobId: string;
  targetKey: string;
  status: CodingJobStatusV14;
  attempt: number;
  version: number;
  cancelRequested: boolean;
  resultCode: string | null;
  changedPaths: string[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};
export type CodingJobLeaseV14 = CodingJobPublicRecordV14 & {
  payloadCiphertext: string;
  leaseOwner: string;
  leaseExpiresAt: number;
};

type DbRow = Record<string, unknown>;
export interface CodingJobSqlExecutorV14 {
  query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

const PUBLIC_RETURNING = `job_id, target_key, status, attempt, version,
  (cancel_requested_at is not null) as cancel_requested,
  result_code, changed_paths,
  floor(extract(epoch from created_at) * 1000)::text as created_ms,
  floor(extract(epoch from updated_at) * 1000)::text as updated_ms,
  floor(extract(epoch from expires_at) * 1000)::text as expires_ms`;
const LEASE_RETURNING = `${PUBLIC_RETURNING}, payload_ciphertext, lease_owner,
  floor(extract(epoch from lease_expires_at) * 1000)::text as lease_ms`;

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}
function validTargetKey(value: unknown): value is string { return typeof value === 'string' && TARGET_KEY_PATTERN.test(value); }
function validWorkerId(value: unknown): value is string { return typeof value === 'string' && WORKER_ID_PATTERN.test(value); }
function validResultCode(value: unknown): value is string { return typeof value === 'string' && RESULT_CODE_PATTERN.test(value); }
function validLeaseSeconds(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= CODING_JOB_MIN_LEASE_SECONDS && Number(value) <= CODING_JOB_MAX_LEASE_SECONDS; }
function isStatus(value: unknown): value is CodingJobStatusV14 { return value === 'queued' || ACTIVE_STATUSES.includes(value as typeof ACTIVE_STATUSES[number]) || TERMINAL_STATUSES.includes(value as typeof TERMINAL_STATUSES[number]); }
function milliseconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('CODING_JOB_DB_ROW_INVALID');
  return parsed;
}
function parseChangedPaths(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) as unknown; } catch { throw new Error('CODING_JOB_DB_ROW_INVALID'); }
  }
  if (!Array.isArray(parsed) || parsed.length > 12 || parsed.some(item => typeof item !== 'string')) throw new Error('CODING_JOB_DB_ROW_INVALID');
  const paths: string[] = [];
  for (const item of parsed) {
    try { paths.push(normalizeCodingMutablePathV14(item as string)); }
    catch { throw new Error('CODING_JOB_DB_ROW_INVALID'); }
  }
  if (new Set(paths).size !== paths.length) throw new Error('CODING_JOB_DB_ROW_INVALID');
  return paths;
}
function publicRecord(row: DbRow): CodingJobPublicRecordV14 {
  const jobId = row.job_id;
  const targetKey = row.target_key;
  const status = row.status;
  const rawResultCode = row.result_code;
  if (typeof jobId !== 'string' || !CODING_JOB_ID_PATTERN.test(jobId) || !validTargetKey(targetKey) || !isStatus(status)) throw new Error('CODING_JOB_DB_ROW_INVALID');
  const attempt = Number(row.attempt);
  const version = Number(row.version);
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > CODING_JOB_MAX_ATTEMPTS || !Number.isInteger(version) || version < 1 || typeof row.cancel_requested !== 'boolean') throw new Error('CODING_JOB_DB_ROW_INVALID');
  let resultCode: string | null;
  if (rawResultCode === null) resultCode = null;
  else if (validResultCode(rawResultCode)) resultCode = rawResultCode;
  else throw new Error('CODING_JOB_DB_ROW_INVALID');
  return {
    jobId,
    targetKey,
    status,
    attempt,
    version,
    cancelRequested: row.cancel_requested,
    resultCode,
    changedPaths: parseChangedPaths(row.changed_paths),
    createdAt: milliseconds(row.created_ms),
    updatedAt: milliseconds(row.updated_ms),
    expiresAt: milliseconds(row.expires_ms),
  };
}
function leaseRecord(row: DbRow): CodingJobLeaseV14 {
  const record = publicRecord(row);
  const payloadCiphertext = row.payload_ciphertext;
  const leaseOwner = row.lease_owner;
  if (typeof payloadCiphertext !== 'string' || !CODING_JOB_CIPHERTEXT_PATTERN.test(payloadCiphertext) || !validWorkerId(leaseOwner)) throw new Error('CODING_JOB_DB_ROW_INVALID');
  return { ...record, payloadCiphertext, leaseOwner, leaseExpiresAt: milliseconds(row.lease_ms) };
}
function validateChangedPaths(input: readonly string[]): string[] {
  if (!Array.isArray(input) || input.length > 12) throw new Error('CODING_JOB_CHANGED_PATHS_INVALID');
  const paths = input.map(item => {
    try { return normalizeCodingMutablePathV14(item); }
    catch { throw new Error('CODING_JOB_CHANGED_PATHS_INVALID'); }
  });
  if (new Set(paths).size !== paths.length) throw new Error('CODING_JOB_CHANGED_PATHS_INVALID');
  return paths;
}

export class PostgresCodingJobStoreV14 {
  constructor(private readonly database: CodingJobSqlExecutorV14) {}

  async create(envelope: CodingJobEnvelopeV14, now = Date.now()): Promise<CodingJobPublicRecordV14 | null> {
    if (!CODING_JOB_ID_PATTERN.test(envelope.jobId) || !CODING_JOB_OWNER_HASH_PATTERN.test(envelope.ownerHash) || !validTargetKey(envelope.targetKey) || !CODING_JOB_CIPHERTEXT_PATTERN.test(envelope.payloadCiphertext)) throw new Error('CODING_JOB_CREATE_INPUT_INVALID');
    if (!Number.isFinite(envelope.expiresAt) || envelope.expiresAt < now + 60_000 || envelope.expiresAt > now + MAX_CODING_JOB_TTL_MS + 10_000) throw new Error('CODING_JOB_CREATE_INPUT_INVALID');
    const result = await this.database.query(
      `insert into public.origin_coding_jobs_v14
        (job_id, owner_hash, target_key, payload_ciphertext, expires_at)
       values ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
       on conflict (job_id) do nothing
       returning ${PUBLIC_RETURNING}`,
      [envelope.jobId, envelope.ownerHash, envelope.targetKey, envelope.payloadCiphertext, envelope.expiresAt],
    );
    return result.rows[0] ? publicRecord(result.rows[0]) : null;
  }

  async getJob(jobId: string, ownerHash: string): Promise<CodingJobPublicRecordV14 | null> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !CODING_JOB_OWNER_HASH_PATTERN.test(ownerHash)) return null;
    const result = await this.database.query(
      `select ${PUBLIC_RETURNING}
       from public.origin_coding_jobs_v14
       where job_id = $1 and owner_hash = $2 and expires_at > clock_timestamp()
       limit 1`,
      [jobId, ownerHash],
    );
    return result.rows[0] ? publicRecord(result.rows[0]) : null;
  }

  async requestCancel(jobId: string, ownerHash: string): Promise<CodingJobPublicRecordV14 | null> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !CODING_JOB_OWNER_HASH_PATTERN.test(ownerHash)) return null;
    const result = await this.database.query(
      `update public.origin_coding_jobs_v14
       set cancel_requested_at = coalesce(cancel_requested_at, clock_timestamp()),
           status = case
             when status = 'queued' then 'cancelled'
             when status in ('leased','running','repairing') and lease_expires_at <= clock_timestamp() then 'cancelled'
             else status
           end,
           payload_ciphertext = case
             when status = 'queued' or (status in ('leased','running','repairing') and lease_expires_at <= clock_timestamp()) then null
             else payload_ciphertext
           end,
           result_code = case
             when status = 'queued' or (status in ('leased','running','repairing') and lease_expires_at <= clock_timestamp()) then 'CODING_CANCELLED_BY_USER'
             else result_code
           end,
           lease_owner = case
             when status = 'queued' or (status in ('leased','running','repairing') and lease_expires_at <= clock_timestamp()) then null
             else lease_owner
           end,
           lease_expires_at = case
             when status = 'queued' or (status in ('leased','running','repairing') and lease_expires_at <= clock_timestamp()) then null
             else lease_expires_at
           end,
           updated_at = clock_timestamp(), version = version + 1
       where job_id = $1 and owner_hash = $2 and expires_at > clock_timestamp()
         and status in ('queued','leased','running','repairing')
       returning ${PUBLIC_RETURNING}`,
      [jobId, ownerHash],
    );
    if (result.rows[0]) return publicRecord(result.rows[0]);
    return this.getJob(jobId, ownerHash);
  }

  async claimJob(jobId: string, workerId: string, leaseSeconds: number): Promise<CodingJobLeaseV14 | null> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !validWorkerId(workerId) || !validLeaseSeconds(leaseSeconds)) throw new Error('CODING_JOB_CLAIM_INPUT_INVALID');
    const result = await this.database.query(
      `update public.origin_coding_jobs_v14
       set status = 'leased', lease_owner = $2,
           lease_expires_at = clock_timestamp() + ($3 * interval '1 second'),
           attempt = attempt + 1, updated_at = clock_timestamp(), version = version + 1
       where job_id = $1 and expires_at > clock_timestamp()
         and cancel_requested_at is null and attempt < $4
         and (
           status = 'queued'
           or (status in ('leased','running','repairing') and lease_expires_at <= clock_timestamp())
         )
       returning ${LEASE_RETURNING}`,
      [jobId, workerId, leaseSeconds, CODING_JOB_MAX_ATTEMPTS],
    );
    return result.rows[0] ? leaseRecord(result.rows[0]) : null;
  }

  async startJob(jobId: string, workerId: string): Promise<boolean> {
    return this.moveActive(jobId, workerId, 'running', ['leased']);
  }

  async markRepairing(jobId: string, workerId: string): Promise<boolean> {
    return this.moveActive(jobId, workerId, 'repairing', ['running', 'repairing']);
  }

  private async moveActive(jobId: string, workerId: string, destination: 'running' | 'repairing', sourceStatuses: readonly ('leased' | 'running' | 'repairing')[]): Promise<boolean> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !validWorkerId(workerId)) throw new Error('CODING_JOB_WORKER_INPUT_INVALID');
    const result = await this.database.query(
      `update public.origin_coding_jobs_v14
       set status = $3, updated_at = clock_timestamp(), version = version + 1
       where job_id = $1 and lease_owner = $2 and status = any($4::text[])
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
         and cancel_requested_at is null
       returning job_id`,
      [jobId, workerId, destination, sourceStatuses],
    );
    return result.rowCount === 1;
  }

  async renewLease(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !validWorkerId(workerId) || !validLeaseSeconds(leaseSeconds)) throw new Error('CODING_JOB_WORKER_INPUT_INVALID');
    const result = await this.database.query(
      `update public.origin_coding_jobs_v14
       set lease_expires_at = clock_timestamp() + ($3 * interval '1 second'),
           updated_at = clock_timestamp(), version = version + 1
       where job_id = $1 and lease_owner = $2 and status in ('leased','running','repairing')
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
         and cancel_requested_at is null
       returning job_id`,
      [jobId, workerId, leaseSeconds],
    );
    return result.rowCount === 1;
  }

  async cancellationRequested(jobId: string, workerId: string): Promise<boolean> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !validWorkerId(workerId)) return true;
    const result = await this.database.query<{ cancel_requested: boolean }>(
      `select (cancel_requested_at is not null) as cancel_requested
       from public.origin_coding_jobs_v14
       where job_id = $1 and lease_owner = $2 and status in ('leased','running','repairing')
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
       limit 1`,
      [jobId, workerId],
    );
    const row = result.rows[0];
    return !row || row.cancel_requested !== false;
  }

  async acknowledgeCancel(jobId: string, workerId: string): Promise<boolean> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !validWorkerId(workerId)) throw new Error('CODING_JOB_WORKER_INPUT_INVALID');
    const result = await this.database.query(
      `update public.origin_coding_jobs_v14
       set status = 'cancelled', payload_ciphertext = null,
           result_code = 'CODING_CANCELLED_BY_USER', lease_owner = null, lease_expires_at = null,
           updated_at = clock_timestamp(), version = version + 1
       where job_id = $1 and lease_owner = $2 and status in ('leased','running','repairing')
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
         and cancel_requested_at is not null
       returning job_id`,
      [jobId, workerId],
    );
    return result.rowCount === 1;
  }

  async completeJob(jobId: string, workerId: string, status: CodingJobCompletionStatusV14, resultCode: string, changedPathsInput: readonly string[]): Promise<boolean> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !validWorkerId(workerId) || !['verified', 'blocked', 'failed'].includes(status) || !validResultCode(resultCode)) throw new Error('CODING_JOB_COMPLETION_INPUT_INVALID');
    const changedPaths = validateChangedPaths(changedPathsInput);
    const result = await this.database.query(
      `update public.origin_coding_jobs_v14
       set status = $3, result_code = $4, changed_paths = $5::jsonb,
           payload_ciphertext = null, lease_owner = null, lease_expires_at = null,
           updated_at = clock_timestamp(), version = version + 1
       where job_id = $1 and lease_owner = $2 and status in ('leased','running','repairing')
         and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp()
         and cancel_requested_at is null
       returning job_id`,
      [jobId, workerId, status, resultCode, JSON.stringify(changedPaths)],
    );
    return result.rowCount === 1;
  }

  async recoverStaleJob(jobId: string): Promise<CodingJobPublicRecordV14 | null> {
    if (!CODING_JOB_ID_PATTERN.test(jobId)) return null;
    const result = await this.database.query(
      `update public.origin_coding_jobs_v14
       set status = case
             when cancel_requested_at is not null then 'cancelled'
             when attempt >= $2 then 'failed'
             else 'queued'
           end,
           result_code = case
             when cancel_requested_at is not null then 'CODING_CANCELLED_BY_USER'
             when attempt >= $2 then 'CODING_WORKER_RETRY_EXHAUSTED'
             else null
           end,
           payload_ciphertext = case when cancel_requested_at is not null or attempt >= $2 then null else payload_ciphertext end,
           lease_owner = null, lease_expires_at = null,
           updated_at = clock_timestamp(), version = version + 1
       where job_id = $1 and expires_at > clock_timestamp()
         and status in ('leased','running','repairing') and lease_expires_at <= clock_timestamp()
       returning ${PUBLIC_RETURNING}`,
      [jobId, CODING_JOB_MAX_ATTEMPTS],
    );
    return result.rows[0] ? publicRecord(result.rows[0]) : null;
  }

  async deleteExpired(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('CODING_JOB_CLEANUP_LIMIT_INVALID');
    const result = await this.database.query(
      `with expired as (
         select ctid from public.origin_coding_jobs_v14
         where expires_at <= clock_timestamp()
         order by expires_at asc limit $1
       )
       delete from public.origin_coding_jobs_v14
       where ctid in (select ctid from expired)
       returning job_id`,
      [limit],
    );
    return result.rowCount ?? result.rows.length;
  }
}

export function createCodingJobStoreFromEnvV14(env: NodeJS.ProcessEnv = process.env): PostgresCodingJobStoreV14 | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000, allowExitOnIdle: true });
  return new PostgresCodingJobStoreV14(pool);
}
