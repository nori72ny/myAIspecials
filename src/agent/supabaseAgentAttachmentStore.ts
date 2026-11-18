import { Pool, type QueryResult } from 'pg';
import { createAgentAttachmentSchemaEnsuringExecutor } from './agentAttachmentSchema.js';
import {
  AGENT_ATTACHMENT_SET_ID_PATTERN,
  AGENT_ATTACHMENT_SHA256_PATTERN,
  MAX_AGENT_ATTACHMENT_SET_FILES,
  MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS,
  assertAgentAttachmentOwnerBinding,
  assertAgentAttachmentSetId,
  validateAddAgentAttachmentFileInput,
  validateCreateAgentAttachmentSetInput,
  type AddAgentAttachmentFileInput,
  type AgentAttachmentFileMeta,
  type AgentAttachmentSetRecord,
  type AgentAttachmentStore,
  type CreateAgentAttachmentSetInput,
} from './agentAttachmentRecord.js';
import { AGENT_RUN_ID_PATTERN, AGENT_RUN_OWNER_BINDING_PATTERN } from './agentRunRecord.js';

const MAX_SWEEP_LIMIT = 1000;
const DEFAULT_SWEEP_LIMIT = 100;

type DbRow = Record<string, unknown>;
export interface AgentAttachmentSqlExecutor {
  query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

const SET_RETURNING = `set_id, owner_binding, upload_token_digest, status, claimed_run_id,
  floor(extract(epoch from expires_at) * 1000)::text as expires_ms,
  floor(extract(epoch from created_at) * 1000)::text as created_ms,
  floor(extract(epoch from updated_at) * 1000)::text as updated_ms`;
const FILE_RETURNING = `idx, name, media_type, kind, byte_size, char_count, sha256, extraction_status`;

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

function milliseconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  return parsed;
}

function parseFileMeta(row: DbRow): AgentAttachmentFileMeta {
  const { idx, name, media_type: mediaType, kind, byte_size: byteSize, char_count: charCount, sha256, extraction_status: extractionStatus } = row;
  if (!Number.isInteger(idx) || Number(idx) < 0 || Number(idx) >= MAX_AGENT_ATTACHMENT_SET_FILES) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (typeof name !== 'string' || name.length === 0) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (typeof mediaType !== 'string' || mediaType.length === 0) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (kind !== 'text' && kind !== 'xlsx' && kind !== 'pdf') throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (!Number.isInteger(byteSize) || Number(byteSize) < 0) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (!Number.isInteger(charCount) || Number(charCount) < 0) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (typeof sha256 !== 'string' || !AGENT_ATTACHMENT_SHA256_PATTERN.test(sha256)) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (extractionStatus !== 'ok' && extractionStatus !== 'failed') throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  return {
    idx: Number(idx),
    name,
    mediaType,
    kind,
    byteSize: Number(byteSize),
    charCount: Number(charCount),
    sha256,
    extractionStatus,
  };
}

function parseSetRow(row: DbRow, files: AgentAttachmentFileMeta[]): AgentAttachmentSetRecord {
  const { set_id: setId, owner_binding: ownerBinding, upload_token_digest: uploadTokenDigest, status, claimed_run_id: claimedRunId } = row;
  if (typeof setId !== 'string' || !AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (typeof ownerBinding !== 'string' || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (typeof uploadTokenDigest !== 'string' || !AGENT_ATTACHMENT_SHA256_PATTERN.test(uploadTokenDigest)) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (status !== 'open' && status !== 'claimed' && status !== 'deleted') throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if ((status === 'claimed') !== (claimedRunId !== null)) throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  if (claimedRunId !== null && (typeof claimedRunId !== 'string' || !AGENT_RUN_ID_PATTERN.test(claimedRunId))) {
    throw new Error('AGENT_ATTACHMENT_DB_ROW_INVALID');
  }
  return {
    setId,
    ownerBinding,
    uploadTokenDigest,
    status,
    claimedRunId: claimedRunId as string | null,
    files,
    createdAt: milliseconds(row.created_ms),
    updatedAt: milliseconds(row.updated_ms),
    expiresAt: milliseconds(row.expires_ms),
  };
}

/**
 * Postgres-backed AgentAttachmentStore in the same implementation
 * style as the run store: parameterized SQL only, owner scoping on
 * every statement, and set-level limits enforced inside the insert
 * statement itself so the check and the write are one atomic step.
 */
export class PostgresAgentAttachmentStore implements AgentAttachmentStore {
  constructor(private readonly database: AgentAttachmentSqlExecutor) {}

  private async loadFiles(setId: string): Promise<AgentAttachmentFileMeta[]> {
    const result = await this.database.query(
      `select ${FILE_RETURNING}
       from public.origin_agent_attachments
       where set_id = $1
       order by idx asc`,
      [setId],
    );
    return result.rows.map((row) => parseFileMeta(row));
  }

  private async deleteSetRow(setId: string, ownerBinding: string): Promise<boolean> {
    const result = await this.database.query(
      `delete from public.origin_agent_attachment_sets
       where set_id = $1 and owner_binding = $2
       returning set_id`,
      [setId, ownerBinding],
    );
    return result.rowCount === 1;
  }

  async createSet(input: CreateAgentAttachmentSetInput, now = Date.now()): Promise<AgentAttachmentSetRecord | null> {
    const normalized = validateCreateAgentAttachmentSetInput(input, now);
    const result = await this.database.query(
      `insert into public.origin_agent_attachment_sets
        (set_id, owner_binding, upload_token_digest, status, expires_at)
       values ($1, $2, $3, 'open', to_timestamp($4 / 1000.0))
       on conflict (set_id) do nothing
       returning ${SET_RETURNING}`,
      [normalized.setId, normalized.ownerBinding, normalized.uploadTokenDigest, normalized.expiresAt],
    );
    return result.rows[0] ? parseSetRow(result.rows[0], []) : null;
  }

  async getSet(setId: string, ownerBinding: string, now = Date.now()): Promise<AgentAttachmentSetRecord | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return null;
    const result = await this.database.query(
      `select ${SET_RETURNING}
       from public.origin_agent_attachment_sets
       where set_id = $1 and owner_binding = $2
       limit 1`,
      [setId, ownerBinding],
    );
    const row = result.rows[0];
    if (!row) return null;
    const record = parseSetRow(row, []);
    if (record.expiresAt <= now) {
      // Lazy deletion (design §2.3): an expired set is deleted with
      // its bodies (cascade) and is indistinguishable from absence.
      await this.deleteSetRow(setId, ownerBinding);
      return null;
    }
    return { ...record, files: await this.loadFiles(setId) };
  }

  async addFile(setId: string, ownerBinding: string, input: AddAgentAttachmentFileInput, now = Date.now()): Promise<AgentAttachmentFileMeta> {
    assertAgentAttachmentSetId(setId);
    assertAgentAttachmentOwnerBinding(ownerBinding);
    const file = validateAddAgentAttachmentFileInput(input);
    // The set row is locked for the duration of the statement so two
    // uploads to the same set cannot both pass the count/total checks
    // against the same snapshot; the checks themselves are part of
    // the insert, so enforcement and write stay atomic.
    const result = await this.database.query(
      `with locked as (
         select s.set_id
         from public.origin_agent_attachment_sets s
         where s.set_id = $1 and s.owner_binding = $2
         for update of s
       )
       insert into public.origin_agent_attachments
         (set_id, idx, name, media_type, kind, byte_size, char_count, sha256, extracted_text, extraction_status)
       select s.set_id,
              coalesce((select max(a.idx) + 1 from public.origin_agent_attachments a where a.set_id = s.set_id), 0),
              $3, $4, $5, $6, $7, $8, $9, 'ok'
       from public.origin_agent_attachment_sets s
       join locked l on l.set_id = s.set_id
       where s.set_id = $1 and s.owner_binding = $2 and s.status = 'open'
         and s.expires_at > clock_timestamp()
         and (select count(*) from public.origin_agent_attachments a where a.set_id = s.set_id) < $10
         and (select coalesce(sum(a.char_count), 0) from public.origin_agent_attachments a where a.set_id = s.set_id) + $7 <= $11
       returning ${FILE_RETURNING}`,
      [
        setId,
        ownerBinding,
        file.name,
        file.mediaType,
        file.kind,
        file.byteSize,
        file.charCount,
        file.sha256,
        file.extractedText,
        MAX_AGENT_ATTACHMENT_SET_FILES,
        MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS,
      ],
    );
    if (result.rows[0]) return parseFileMeta(result.rows[0]);
    // The insert was refused; label the refusal precisely. This read
    // only names the failure — the insert above remains the gate.
    const existing = await this.getSet(setId, ownerBinding, now);
    if (!existing) throw new Error('AGENT_ATTACHMENT_SET_NOT_FOUND');
    if (existing.status !== 'open') throw new Error('AGENT_ATTACHMENT_SET_NOT_OPEN');
    if (existing.files.length >= MAX_AGENT_ATTACHMENT_SET_FILES) throw new Error('AGENT_ATTACHMENT_SET_FILE_LIMIT');
    throw new Error('AGENT_ATTACHMENT_SET_TOO_LARGE');
  }

  async getFileText(setId: string, ownerBinding: string, idx: number): Promise<string | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return null;
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_AGENT_ATTACHMENT_SET_FILES) return null;
    // Lazy deletion first, so an expired set's bodies cannot be read
    // even by a caller that never touches the metadata path.
    await this.database.query(
      `delete from public.origin_agent_attachment_sets
       where set_id = $1 and owner_binding = $2 and expires_at <= clock_timestamp()`,
      [setId, ownerBinding],
    );
    const result = await this.database.query(
      `select a.extracted_text
       from public.origin_agent_attachments a
       join public.origin_agent_attachment_sets s on s.set_id = a.set_id
       where a.set_id = $1 and s.owner_binding = $2 and a.idx = $3
         and s.status in ('open', 'claimed')
       limit 1`,
      [setId, ownerBinding, idx],
    );
    const text = result.rows[0]?.extracted_text;
    return typeof text === 'string' ? text : null;
  }

  async claimSet(setId: string, ownerBinding: string, runId: string, expiresAt: number, now = Date.now()): Promise<AgentAttachmentSetRecord | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return null;
    if (!AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    const result = await this.database.query(
      `update public.origin_agent_attachment_sets
       set status = 'claimed', claimed_run_id = $3, expires_at = to_timestamp($4 / 1000.0),
           updated_at = clock_timestamp(), version = version + 1
       where set_id = $1 and owner_binding = $2 and status = 'open'
         and expires_at > clock_timestamp()
       returning ${SET_RETURNING}`,
      [setId, ownerBinding, runId, expiresAt],
    );
    if (!result.rows[0]) {
      // Keep the lazy-deletion invariant for a set that lapsed before
      // it could be claimed.
      await this.getSet(setId, ownerBinding, now);
      return null;
    }
    const record = parseSetRow(result.rows[0], []);
    return { ...record, files: await this.loadFiles(setId) };
  }

  async claimSetForRun(setId: string, fromOwnerBinding: string, toOwnerBinding: string, runId: string, expiresAt: number, now = Date.now()): Promise<AgentAttachmentSetRecord | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(fromOwnerBinding) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(toOwnerBinding)) return null;
    if (!AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    // One atomic update: re-bind and claim together, so the set is
    // never observable under both bindings or under neither, and a
    // set that is not open under the source binding does not move.
    const result = await this.database.query(
      `update public.origin_agent_attachment_sets
       set owner_binding = $2, status = 'claimed', claimed_run_id = $3, expires_at = to_timestamp($4 / 1000.0),
           updated_at = clock_timestamp(), version = version + 1
       where set_id = $1 and owner_binding = $5 and status = 'open'
         and expires_at > clock_timestamp()
       returning ${SET_RETURNING}`,
      [setId, toOwnerBinding, runId, expiresAt, fromOwnerBinding],
    );
    if (!result.rows[0]) {
      // Keep the lazy-deletion invariant for a set that lapsed before
      // it could be claimed.
      await this.getSet(setId, fromOwnerBinding, now);
      return null;
    }
    const record = parseSetRow(result.rows[0], []);
    return { ...record, files: await this.loadFiles(setId) };
  }

  async deleteSet(setId: string, ownerBinding: string): Promise<boolean> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return false;
    return this.deleteSetRow(setId, ownerBinding);
  }

  async sweepExpired(limit = DEFAULT_SWEEP_LIMIT): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SWEEP_LIMIT) throw new Error('AGENT_ATTACHMENT_CLEANUP_LIMIT_INVALID');
    const result = await this.database.query(
      `with due as (
         select ctid from public.origin_agent_attachment_sets
         where expires_at <= clock_timestamp()
         order by expires_at asc limit $1
       )
       delete from public.origin_agent_attachment_sets s
       using due
       where s.ctid = due.ctid
       returning s.set_id`,
      [limit],
    );
    return result.rowCount ?? result.rows.length;
  }
}

export function createAgentAttachmentStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PostgresAgentAttachmentStore | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  });
  // Like the env-built run store, the production path lazily ensures
  // the attachment schema (idempotent DDL) before the first store
  // operation of the process. Direct constructions (tests, tools)
  // keep the raw executor and never trigger DDL.
  return new PostgresAgentAttachmentStore(createAgentAttachmentSchemaEnsuringExecutor(pool));
}
