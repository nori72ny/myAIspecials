// @vitest-environment node
import { readFile } from 'node:fs/promises';
import type { QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  CONNECTOR_AUDIT_MIGRATION_SQL,
  logConnectorAuditRecordFailure,
  normalizeConnectorAuditEntry,
  PostgresConnectorAuditLog,
  type ConnectorAuditEntry,
} from './connectorAuditLog.js';
import type { McpSqlExecutor } from './mcpPostgresStore.js';

class TestDatabase implements McpSqlExecutor {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  failEnsureTimes = 0;
  failInsertTimes = 0;

  async query<T extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    if (text === CONNECTOR_AUDIT_MIGRATION_SQL && this.failEnsureTimes > 0) {
      this.failEnsureTimes -= 1;
      throw Object.assign(new Error('ddl denied for db.internal.example:5432'), { name: 'PostgresError', code: '42501' });
    }
    if (text.startsWith('insert into public.origin_connector_audit') && this.failInsertTimes > 0) {
      this.failInsertTimes -= 1;
      throw Object.assign(new Error('connection to db.internal.example lost'), { name: 'Error', code: '08006' });
    }
    return { command: '', rowCount: 1, oid: 0, fields: [], rows: [] as T[] };
  }
}

const entry = (overrides: Partial<ConnectorAuditEntry> = {}): ConnectorAuditEntry => ({
  ownerId: 'owner:11111111-1111-4111-8111-111111111111',
  connectorId: 'docs',
  action: 'mcp.connection.register',
  kind: 'manage',
  outcome: 'succeeded',
  summary: 'connection=11111111-1111-4111-8111-111111111111 server=docs',
  ...overrides,
});

describe('connector audit migration contract', () => {
  it('keeps the audit table server-only, append-only and retention-ready', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261112090000_origin_connector_audit.sql', import.meta.url), 'utf8');
    expect(sql).toContain('create table if not exists public.origin_connector_audit');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on table public.origin_connector_audit from anon');
    expect(sql).toContain('revoke all on table public.origin_connector_audit from authenticated');
    // Append-only for the runtime role: no update grant; delete exists
    // solely for the 90-day retention pruning.
    expect(sql).toContain('grant select, insert, delete on table public.origin_connector_audit to service_role');
    expect(sql).not.toContain('grant select, insert, update');
    // Credentials can never be represented: there is no column for them,
    // and the approval reference is a hash format, never a raw token.
    expect(sql).not.toContain('credential text');
    expect(sql).not.toContain('secret text');
    expect(sql).toContain("approval_token_hash ~ '^[0-9a-f]{64}$'");
    // Retention is driven by occurred_at, so pruning needs the index.
    expect(sql).toContain('origin_connector_audit_occurred_at_idx');
    expect(sql).toContain('on public.origin_connector_audit (occurred_at asc)');
    // Summaries stay identifiers-and-a-note sized.
    expect(sql).toContain('octet_length(summary) <= 256');
  });

  it('keeps the schema constant identical to its migration file', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261112090000_origin_connector_audit.sql', import.meta.url), 'utf8');
    const normalize = (value: string): string => value.replace(/\r\n/g, '\n').trim();
    expect(normalize(CONNECTOR_AUDIT_MIGRATION_SQL)).toBe(normalize(sql));
  });
});

describe('normalizeConnectorAuditEntry', () => {
  it('normalizes a valid entry with safe defaults', () => {
    expect(normalizeConnectorAuditEntry(entry())).toEqual({
      ownerId: entry().ownerId,
      connectorId: 'docs',
      action: 'mcp.connection.register',
      kind: 'manage',
      approved: false,
      approvalTokenHash: null,
      outcome: 'succeeded',
      errorCode: null,
      durationMs: null,
      resultSizeBytes: null,
      summary: 'connection=11111111-1111-4111-8111-111111111111 server=docs',
    });
  });

  it('never carries fields outside the entry contract into the row', () => {
    const poisoned = { ...entry(), token: 'raw-secret-token', credential: 'raw-secret', body: 'personal content' } as ConnectorAuditEntry;
    const normalized = normalizeConnectorAuditEntry(poisoned);
    expect(normalized).toBeDefined();
    expect(JSON.stringify(normalized)).not.toContain('raw-secret');
    expect(JSON.stringify(normalized)).not.toContain('personal content');
    expect(Object.keys(normalized!)).not.toContain('token');
  });

  it('drops entries whose identifiers, kind or outcome break the contract', () => {
    expect(normalizeConnectorAuditEntry(entry({ ownerId: 'bad owner' }))).toBeUndefined();
    expect(normalizeConnectorAuditEntry(entry({ connectorId: 'bad connector!' }))).toBeUndefined();
    expect(normalizeConnectorAuditEntry(entry({ action: 'Not An Action' }))).toBeUndefined();
    expect(normalizeConnectorAuditEntry(entry({ kind: 'execute' as ConnectorAuditEntry['kind'] }))).toBeUndefined();
    expect(normalizeConnectorAuditEntry(entry({ outcome: 'unknown' as ConnectorAuditEntry['outcome'] }))).toBeUndefined();
  });

  it('keeps only a real approval hash and drops the entry when the field holds anything else', () => {
    const hash = 'a'.repeat(64);
    expect(normalizeConnectorAuditEntry(entry({ approvalTokenHash: hash }))?.approvalTokenHash).toBe(hash);
    // A raw approval token in this field is exactly the leak the hash-only
    // contract exists to prevent: the whole entry is dropped.
    expect(normalizeConnectorAuditEntry(entry({ approvalTokenHash: 'raw-approval-token-value' }))).toBeUndefined();
  });

  it('nulls out-of-contract measurements and error codes instead of dropping the row', () => {
    const normalized = normalizeConnectorAuditEntry(entry({ outcome: 'failed', errorCode: 'not a code', durationMs: -1, resultSizeBytes: 1.5 }));
    expect(normalized?.errorCode).toBeNull();
    expect(normalized?.durationMs).toBeNull();
    expect(normalized?.resultSizeBytes).toBeNull();
    expect(normalizeConnectorAuditEntry(entry({ durationMs: 42, resultSizeBytes: 2048 }))?.durationMs).toBe(42);
    expect(normalizeConnectorAuditEntry(entry({ errorCode: 'MCP_CONNECTION_NOT_FOUND' }))?.errorCode).toBe('MCP_CONNECTION_NOT_FOUND');
  });

  it('strips control characters and truncates the summary to the byte budget', () => {
    const normalized = normalizeConnectorAuditEntry(entry({ summary: 'line1\nline2\u0000end' }));
    expect(normalized?.summary).toBe('line1 line2 end');
    const wide = normalizeConnectorAuditEntry(entry({ summary: 'あ'.repeat(200) }));
    expect(Buffer.byteLength(wide!.summary, 'utf8')).toBeLessThanOrEqual(256);
  });
});

describe('PostgresConnectorAuditLog', () => {
  it('ensures the schema once, then inserts exactly the normalized values', async () => {
    const database = new TestDatabase();
    const log = new PostgresConnectorAuditLog(database);
    await log.record(entry({ durationMs: 7 }));
    await log.record(entry({ action: 'mcp.status.read', kind: 'read', summary: 'connections=1 servers=1' }));
    expect(database.calls).toHaveLength(3);
    expect(database.calls[0].text).toBe(CONNECTOR_AUDIT_MIGRATION_SQL);
    const insert = database.calls[1];
    expect(insert.text).toContain('insert into public.origin_connector_audit');
    expect(insert.values[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(insert.values.slice(1)).toEqual([
      entry().ownerId, 'docs', 'mcp.connection.register', 'manage', false, null,
      'succeeded', null, 7, null, 'connection=11111111-1111-4111-8111-111111111111 server=docs',
    ]);
    expect(database.calls[2].values[3]).toBe('mcp.status.read');
  });

  it('does not touch the database for an entry that fails normalization', async () => {
    const database = new TestDatabase();
    await new PostgresConnectorAuditLog(database).record(entry({ ownerId: 'bad owner' }));
    expect(database.calls).toHaveLength(0);
  });

  it('swallows insert failures and logs name and code only, never the message', async () => {
    const database = new TestDatabase();
    database.failInsertTimes = 1;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(new PostgresConnectorAuditLog(database).record(entry())).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledOnce();
      const [message, fields] = spy.mock.calls[0];
      expect(message).toBe('ORIGIN_CONNECTOR_AUDIT_RECORD_FAILED');
      expect(fields).toEqual({ name: 'Error', code: '08006' });
      expect(JSON.stringify(spy.mock.calls)).not.toContain('db.internal.example');
    } finally { spy.mockRestore(); }
  });

  it('retries a failed schema ensure on the next record instead of caching the failure', async () => {
    const database = new TestDatabase();
    database.failEnsureTimes = 1;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = new PostgresConnectorAuditLog(database);
      await log.record(entry());
      expect(database.calls.filter(call => call.text.startsWith('insert into'))).toHaveLength(0);
      await log.record(entry());
      const ensures = database.calls.filter(call => call.text === CONNECTOR_AUDIT_MIGRATION_SQL);
      expect(ensures).toHaveLength(2);
      expect(database.calls.filter(call => call.text.startsWith('insert into'))).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
});

describe('logConnectorAuditRecordFailure', () => {
  it('logs only allow-listed name and code fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logConnectorAuditRecordFailure(Object.assign(new Error('secret host db.internal.example'), { code: '42501' }));
      expect(spy.mock.calls[0][0]).toBe('ORIGIN_CONNECTOR_AUDIT_RECORD_FAILED');
      expect(spy.mock.calls[0][1]).toEqual({ name: 'Error', code: '42501' });
      expect(JSON.stringify(spy.mock.calls)).not.toContain('db.internal.example');
      logConnectorAuditRecordFailure('not an error object');
      expect(spy.mock.calls[1][1]).toEqual({ name: 'UNKNOWN', code: 'UNKNOWN' });
    } finally { spy.mockRestore(); }
  });
});
