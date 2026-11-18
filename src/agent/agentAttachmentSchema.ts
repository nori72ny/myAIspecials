import type { QueryResult } from 'pg';
import type { AgentAttachmentSqlExecutor } from './supabaseAgentAttachmentStore.js';

/**
 * The attachment schema migration from `supabase/migrations/`, carried
 * as an in-code constant because the production bundle cannot read
 * files at runtime. The constant is byte-identical to the .sql file
 * after whitespace normalization at the edges;
 * `agentAttachmentMigration.test.ts` pins that equality so the two can
 * never drift apart.
 *
 * The statement is idempotent (IF NOT EXISTS), so applying it against
 * a database that already has the schema is a no-op.
 */
export const AGENT_ATTACHMENT_MIGRATION_SQL = `-- Agent attachment sets (agent file-input foundation, F1).
-- Files a user hands to the agent live here, never inside the goal
-- text or plan params (both are size-capped far below real file
-- sizes). A set is created first and filled file by file under an
-- upload capability; a plan binds only the set id and a digest of its
-- contents, so approval covers the data itself. Only extracted text
-- and metadata are stored -- original binaries are discarded after
-- extraction (stage 2) -- and retention is bounded: an unclaimed set
-- expires 24 hours after creation, a claimed set follows its run.
-- Owner binding is a SHA-256 hash, never a raw identifier, exactly
-- like the run records. The upload token itself is never stored,
-- only its digest.

create table if not exists public.origin_agent_attachment_sets (
  set_id text primary key,
  owner_binding text not null,
  upload_token_digest text not null,
  status text not null default 'open',
  claimed_run_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,

  constraint origin_agent_attachment_set_id_format
    check (set_id ~ '^att-[A-Za-z0-9-]{8,100}$'),
  constraint origin_agent_attachment_set_owner_binding_format
    check (owner_binding ~ '^[0-9a-f]{64}$'),
  constraint origin_agent_attachment_set_token_digest_format
    check (upload_token_digest ~ '^[0-9a-f]{64}$'),
  constraint origin_agent_attachment_set_status_valid
    check (status in ('open','claimed','deleted')),
  constraint origin_agent_attachment_set_claim_lifecycle
    check ((status = 'claimed' and claimed_run_id is not null) or (status <> 'claimed' and claimed_run_id is null)),
  constraint origin_agent_attachment_set_claimed_run_format
    check (claimed_run_id is null or claimed_run_id ~ '^run-[A-Za-z0-9-]{8,100}$'),
  constraint origin_agent_attachment_set_version_valid
    check (version >= 1),
  constraint origin_agent_attachment_set_expiry
    check (expires_at >= created_at + interval '1 minute')
);

create index if not exists origin_agent_attachment_sets_owner_created_idx
  on public.origin_agent_attachment_sets (owner_binding, created_at desc);
create index if not exists origin_agent_attachment_sets_expires_at_idx
  on public.origin_agent_attachment_sets (expires_at);

alter table public.origin_agent_attachment_sets enable row level security;
revoke all on table public.origin_agent_attachment_sets from public;
revoke all on table public.origin_agent_attachment_sets from anon;
revoke all on table public.origin_agent_attachment_sets from authenticated;
grant select, insert, update, delete on table public.origin_agent_attachment_sets to service_role;

create table if not exists public.origin_agent_attachments (
  set_id text not null references public.origin_agent_attachment_sets (set_id) on delete cascade,
  idx integer not null,
  name text not null,
  media_type text not null,
  kind text not null,
  byte_size integer not null,
  char_count integer not null,
  sha256 text not null,
  extracted_text text not null,
  extraction_status text not null default 'ok',
  created_at timestamptz not null default now(),

  primary key (set_id, idx),

  constraint origin_agent_attachment_idx_range
    check (idx between 0 and 9),
  constraint origin_agent_attachment_name_length
    check (char_length(name) between 1 and 255),
  constraint origin_agent_attachment_kind_valid
    check (kind in ('text','xlsx','pdf')),
  constraint origin_agent_attachment_size_range
    check (byte_size >= 0 and char_count between 0 and 200000),
  constraint origin_agent_attachment_sha256_format
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint origin_agent_attachment_extraction_status_valid
    check (extraction_status in ('ok','failed'))
);

create index if not exists origin_agent_attachments_set_idx
  on public.origin_agent_attachments (set_id, idx);

alter table public.origin_agent_attachments enable row level security;
revoke all on table public.origin_agent_attachments from public;
revoke all on table public.origin_agent_attachments from anon;
revoke all on table public.origin_agent_attachments from authenticated;
grant select, insert, update, delete on table public.origin_agent_attachments to service_role;`;

/** The attachment schema migrations in application order. */
export const AGENT_ATTACHMENT_SCHEMA_MIGRATIONS: readonly string[] = [
  AGENT_ATTACHMENT_MIGRATION_SQL,
];

const SAFE_SCHEMA_ENSURE_ERROR_FIELD = /^[A-Za-z0-9_.:-]{1,80}$/;

function safeSchemaEnsureErrorField(error: unknown, field: 'name' | 'code'): string {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === 'string' && SAFE_SCHEMA_ENSURE_ERROR_FIELD.test(value)) return value;
  }
  return 'UNKNOWN';
}

/**
 * Records an attachment schema-ensure failure for production triage.
 * Only the error's name and code are logged — never the message, under
 * the same policy as the run schema ensure (driver messages can be
 * composed from host names or connection details).
 */
export function logAgentAttachmentSchemaEnsureFailure(error: unknown): void {
  console.error('ORIGIN_AGENT_ATTACHMENT_SCHEMA_ENSURE_FAILED', {
    name: safeSchemaEnsureErrorField(error, 'name'),
    code: safeSchemaEnsureErrorField(error, 'code'),
  });
}

/**
 * Wraps an executor so the attachment schema is ensured, idempotently
 * and in migration order, before the first store operation of the
 * process. Mirrors createAgentRunSchemaEnsuringExecutor: a successful
 * ensure runs at most once per process, a failed ensure is logged
 * (name/code only), is NOT cached, and never blocks the operation that
 * triggered it — the existing fail-closed store behavior is preserved
 * while the schema is missing.
 */
export function createAgentAttachmentSchemaEnsuringExecutor(inner: AgentAttachmentSqlExecutor): AgentAttachmentSqlExecutor {
  let ensured = false;
  let inFlight: Promise<void> | null = null;

  const ensureSchema = async (): Promise<void> => {
    if (ensured) return;
    if (!inFlight) {
      inFlight = (async () => {
        for (const sql of AGENT_ATTACHMENT_SCHEMA_MIGRATIONS) {
          await inner.query(sql);
        }
      })();
    }
    const attempt = inFlight;
    try {
      await attempt;
      ensured = true;
    } catch (error) {
      logAgentAttachmentSchemaEnsureFailure(error);
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  };

  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> {
      await ensureSchema();
      return inner.query<T>(text, values);
    },
  };
}
