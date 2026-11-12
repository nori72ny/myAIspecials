import { randomUUID } from 'node:crypto';
import type { McpSqlExecutor } from './mcpPostgresStore.js';

/**
 * Connector audit log (connector framework Phase 1, PR-1a; design §3.5).
 *
 * Records connector-management operations now and connector executions in
 * later phases: when, which owner, which connector, which action, whether
 * the owner's approval was involved, and how it ended. Only identifiers
 * and a short summary are ever recorded — credential values and content
 * bodies have no field to travel in and are rejected by normalization
 * before anything reaches the table (design §2-6, §6-2).
 *
 * Recording is fail-safe by contract: `record()` never rejects, so an
 * audit failure can never break the operation being audited. Failures are
 * logged with the error's name and code only (driver messages can carry
 * host or connection details), mirroring the runs schema-ensure policy.
 *
 * The audit schema is carried as a migration file plus an in-code
 * constant (pinned identical by connectorAuditLog.test.ts) and ensured
 * lazily through the application's own database connection, following
 * the agent runs precedent (agentRunSchema.ts): the production database
 * was never migrated through the dashboard route, so the table
 * materializes on first use. A successful ensure runs at most once per
 * process; a failed ensure is not cached and never blocks recording
 * attempts (the insert then fails and is swallowed the same way).
 */
export const CONNECTOR_AUDIT_MIGRATION_SQL = `-- Connector audit log (connector framework Phase 1, PR-1a).
-- One row per connector-management operation (and, in later phases, per
-- connector execution): when it happened, which owner it belonged to,
-- which connector and action it concerned, whether it carried the
-- owner's approval, and how it ended. Identifiers and short summaries
-- only -- credential values and personal-content bodies are never
-- written to this table (design section 2-6 and 6-2); the recording
-- module enforces that contract before any row reaches the table.
--
-- Retention is 90 days from occurred_at, pruned manually for now (the
-- automated pruning job belongs to a later phase). The occurred_at
-- index exists so pruning stays cheap, and the owner index supports
-- owner-scoped review of the log.

create table if not exists public.origin_connector_audit (
  audit_id uuid primary key,
  occurred_at timestamptz not null default now(),
  owner_id text not null,
  connector_id text not null,
  action text not null,
  kind text not null,
  approved boolean not null default false,
  approval_token_hash text,
  outcome text not null,
  error_code text,
  duration_ms integer,
  result_size_bytes integer,
  summary text not null default '',

  constraint origin_connector_audit_owner_format
    check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  constraint origin_connector_audit_connector_format
    check (connector_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  constraint origin_connector_audit_action_format
    check (action ~ '^[a-z][a-z0-9._-]{0,63}$'),
  constraint origin_connector_audit_kind_valid
    check (kind in ('read', 'write', 'manage')),
  constraint origin_connector_audit_approval_hash_format
    check (approval_token_hash is null or approval_token_hash ~ '^[0-9a-f]{64}$'),
  constraint origin_connector_audit_outcome_valid
    check (outcome in ('succeeded', 'failed')),
  constraint origin_connector_audit_error_code_format
    check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint origin_connector_audit_duration_range
    check (duration_ms is null or (duration_ms between 0 and 3600000)),
  constraint origin_connector_audit_result_size_range
    check (result_size_bytes is null or (result_size_bytes between 0 and 1073741824)),
  constraint origin_connector_audit_summary_size
    check (octet_length(summary) <= 256)
);

create index if not exists origin_connector_audit_occurred_at_idx
  on public.origin_connector_audit (occurred_at asc);
create index if not exists origin_connector_audit_owner_occurred_idx
  on public.origin_connector_audit (owner_id, occurred_at desc);

alter table public.origin_connector_audit enable row level security;
revoke all on table public.origin_connector_audit from public;
revoke all on table public.origin_connector_audit from anon;
revoke all on table public.origin_connector_audit from authenticated;
-- Append-only for the runtime role: rows are never updated in place.
-- Delete exists solely for the 90-day retention pruning.
grant select, insert, delete on table public.origin_connector_audit to service_role;

comment on table public.origin_connector_audit is
  'Server-only connector audit log. Identifiers and short summaries only; never credential values or content bodies.';`;

export type ConnectorAuditKind = 'read' | 'write' | 'manage';
export type ConnectorAuditOutcome = 'succeeded' | 'failed';

export interface ConnectorAuditEntry {
  ownerId: string;
  connectorId: string;
  action: string;
  kind: ConnectorAuditKind;
  /** True when the operation was the owner's approval act or carried an approval. */
  approved?: boolean;
  /**
   * SHA-256 hex of an approval token. Callers must pass the hash only —
   * a raw approval token has no legitimate path into this log, and
   * normalization drops any entry whose value is not exactly 64 hex.
   */
  approvalTokenHash?: string;
  outcome: ConnectorAuditOutcome;
  errorCode?: string;
  durationMs?: number;
  resultSizeBytes?: number;
  /** Identifiers and a short note only. Never credential values or content bodies. */
  summary?: string;
}

export interface ConnectorAuditRecorder {
  /** Records one entry. Implementations must never reject. */
  record(entry: ConnectorAuditEntry): Promise<void>;
}

const OWNER = /^[A-Za-z0-9:_-]{1,192}$/;
const CONNECTOR = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ACTION = /^[a-z][a-z0-9._-]{0,63}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const APPROVAL_HASH = /^[0-9a-f]{64}$/;
const KINDS = new Set<string>(['read', 'write', 'manage']);
const OUTCOMES = new Set<string>(['succeeded', 'failed']);
const MAX_DURATION_MS = 3_600_000;
const MAX_RESULT_SIZE_BYTES = 1_073_741_824;
const SUMMARY_MAX_BYTES = 256;

interface NormalizedConnectorAuditEntry {
  ownerId: string;
  connectorId: string;
  action: string;
  kind: ConnectorAuditKind;
  approved: boolean;
  approvalTokenHash: string | null;
  outcome: ConnectorAuditOutcome;
  errorCode: string | null;
  durationMs: number | null;
  resultSizeBytes: number | null;
  summary: string;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const char of value) {
    bytes += Buffer.byteLength(char, 'utf8');
    if (bytes > maxBytes) break;
    end += char.length;
  }
  return value.slice(0, end);
}

/**
 * Validates and sanitizes an entry before it may reach the table.
 * Returns undefined when the entry must be dropped: any identifier,
 * kind or outcome that does not match its contract, or an approval-hash
 * field holding something that is not a hash (exactly where a leaked
 * secret would hide). Optional measurements outside their bounds are
 * nulled rather than dropping the row, and the summary is stripped of
 * control characters and truncated to the column's byte budget — it is
 * built by callers from identifiers only, and this is the last net.
 * Fields outside the entry contract are never read, so extra properties
 * a caller may carry (for example a credential) cannot leak into a row.
 */
export function normalizeConnectorAuditEntry(entry: ConnectorAuditEntry): NormalizedConnectorAuditEntry | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  if (typeof entry.ownerId !== 'string' || !OWNER.test(entry.ownerId)) return undefined;
  if (typeof entry.connectorId !== 'string' || !CONNECTOR.test(entry.connectorId)) return undefined;
  if (typeof entry.action !== 'string' || !ACTION.test(entry.action)) return undefined;
  if (!KINDS.has(entry.kind) || !OUTCOMES.has(entry.outcome)) return undefined;
  if (entry.approvalTokenHash !== undefined && (typeof entry.approvalTokenHash !== 'string' || !APPROVAL_HASH.test(entry.approvalTokenHash))) return undefined;
  const summary = typeof entry.summary === 'string'
    ? truncateUtf8(entry.summary.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(), SUMMARY_MAX_BYTES)
    : '';
  return {
    ownerId: entry.ownerId,
    connectorId: entry.connectorId,
    action: entry.action,
    kind: entry.kind,
    approved: entry.approved === true,
    approvalTokenHash: entry.approvalTokenHash ?? null,
    outcome: entry.outcome,
    errorCode: typeof entry.errorCode === 'string' && ERROR_CODE.test(entry.errorCode) ? entry.errorCode : null,
    durationMs: Number.isSafeInteger(entry.durationMs) && (entry.durationMs as number) >= 0 && (entry.durationMs as number) <= MAX_DURATION_MS
      ? (entry.durationMs as number) : null,
    resultSizeBytes: Number.isSafeInteger(entry.resultSizeBytes) && (entry.resultSizeBytes as number) >= 0 && (entry.resultSizeBytes as number) <= MAX_RESULT_SIZE_BYTES
      ? (entry.resultSizeBytes as number) : null,
    summary,
  };
}

const SAFE_AUDIT_ERROR_FIELD = /^[A-Za-z0-9_.:-]{1,80}$/;

function safeAuditErrorField(error: unknown, field: 'name' | 'code'): string {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === 'string' && SAFE_AUDIT_ERROR_FIELD.test(value)) return value;
  }
  return 'UNKNOWN';
}

/**
 * Records an audit failure for production triage. Only the error's name
 * and code are logged — never the message: driver error messages can be
 * composed from host names or connection details.
 */
export function logConnectorAuditRecordFailure(error: unknown): void {
  console.error('ORIGIN_CONNECTOR_AUDIT_RECORD_FAILED', {
    name: safeAuditErrorField(error, 'name'),
    code: safeAuditErrorField(error, 'code'),
  });
}

const INSERT_SQL = `insert into public.origin_connector_audit
  (audit_id, owner_id, connector_id, action, kind, approved,
   approval_token_hash, outcome, error_code, duration_ms, result_size_bytes, summary)
 values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

/** Durable Postgres recorder. Auditing never breaks the audited operation. */
export class PostgresConnectorAuditLog implements ConnectorAuditRecorder {
  private ensured = false;
  private ensureInFlight: Promise<void> | null = null;

  constructor(private readonly database: McpSqlExecutor) {}

  async record(entry: ConnectorAuditEntry): Promise<void> {
    const normalized = normalizeConnectorAuditEntry(entry);
    if (!normalized) return;
    try {
      await this.ensureSchema();
      await this.database.query(INSERT_SQL, [
        randomUUID(),
        normalized.ownerId,
        normalized.connectorId,
        normalized.action,
        normalized.kind,
        normalized.approved,
        normalized.approvalTokenHash,
        normalized.outcome,
        normalized.errorCode,
        normalized.durationMs,
        normalized.resultSizeBytes,
        normalized.summary,
      ]);
    } catch (error) {
      logConnectorAuditRecordFailure(error);
    }
  }

  /** Idempotent schema ensure: at most once per process on success, retried after failure. */
  private async ensureSchema(): Promise<void> {
    if (this.ensured) return;
    if (!this.ensureInFlight) {
      this.ensureInFlight = (async () => { await this.database.query(CONNECTOR_AUDIT_MIGRATION_SQL); })();
    }
    const attempt = this.ensureInFlight;
    try {
      await attempt;
      this.ensured = true;
    } finally {
      if (this.ensureInFlight === attempt) this.ensureInFlight = null;
    }
  }
}
