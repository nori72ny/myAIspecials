import type { QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import type { McpConnectionRecord } from './mcpConnections.js';
import { createPostgresMcpConnectionStoreFromEnv, PostgresMcpConnectionStore, type McpSqlExecutor } from './mcpPostgresStore.js';

class TestDatabase implements McpSqlExecutor {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  private readonly results: Array<Array<Record<string, unknown>>> = [];

  async connect() { return this; }
  release(_error?: Error | boolean) {}

  push(...rows: Array<Record<string, unknown>>) { this.results.push(rows); }

  async query<T extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    const rows = (/^(begin|set local|select pg_advisory|commit|rollback)/.test(text) ? [] : this.results.shift() ?? []) as T[];
    return { command: '', rowCount: rows.length, oid: 0, fields: [], rows };
  }
}

const binding = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: 'owner:11111111-1111-4111-8111-111111111111',
  serverId: 'docs',
  endpoint: 'https://mcp.example.test/mcp',
};
const record = (overrides: Partial<McpConnectionRecord> = {}): McpConnectionRecord => ({
  ...binding,
  version: 1,
  status: 'registered',
  checkedAt: null,
  ...overrides,
});

const row = (value = record()) => ({
  connection_id: value.id,
  owner_id: value.ownerId,
  server_id: value.serverId,
  endpoint: value.endpoint,
  version: value.version,
  status: value.status,
  checked_at: value.checkedAt,
});

describe('PostgresMcpConnectionStore', () => {
  it('filters every read by the verified owner and normalizes database timestamps', async () => {
    const database = new TestDatabase();
    database.push(row(record({ version: 2, status: 'verified', checkedAt: '2026-09-20T01:02:03.000Z' })));
    const store = new PostgresMcpConnectionStore(database);
    const records = await store.list(record().ownerId);
    expect(records).toEqual([record({ version: 2, status: 'verified', checkedAt: '2026-09-20T01:02:03.000Z' })]);
    expect(database.calls[0].text).toContain('where owner_id = $1');
    expect(database.calls[0].text).not.toContain('credential');
    expect(database.calls[0].values).toEqual([record().ownerId]);
  });

  it('locks before taking a fresh capacity snapshot and commits metadata-only insertion', async () => {
    const database = new TestDatabase(); database.push({ connection_id: record().id });
    const store = new PostgresMcpConnectionStore(database);
    expect(await store.insert(record(), 20)).toBe(true);
    expect(database.calls[0].text).toBe('begin isolation level read committed');
    expect(database.calls[3].text).toContain('pg_advisory_xact_lock');
    expect(database.calls[5].text).toBe('commit');
    const call = database.calls[4];
    expect(call.text).toContain('on conflict do nothing');
    expect(call.text).toContain('where owner_id = $2');
    expect(call.text).not.toContain('credential');
    expect(call.values).toEqual([record().id, record().ownerId, 'docs', record().endpoint, 1, 'registered', null, 20]);
  });

  it('requires owner, immutable connection identity and exact prior version for replacement', async () => {
    const database = new TestDatabase(); database.push({ connection_id: record().id });
    const store = new PostgresMcpConnectionStore(database);
    const next = record({ version: 2, status: 'failed', checkedAt: '2026-09-20T02:00:00.000Z' });
    expect(await store.replace(next, 1)).toBe(true);
    expect(database.calls[0].text).toContain('where owner_id = $1');
    expect(database.calls[0].text).toContain('and server_id = $3');
    expect(database.calls[0].text).toContain('and endpoint = $7');
    expect(database.calls[0].text).toContain('and version = $8');
    expect(database.calls[0].text).not.toContain('credential');
    expect(database.calls[0].values.at(-1)).toBe(1);
    expect(await store.replace(next, 2)).toBe(false);
    expect(database.calls).toHaveLength(1);
  });

  it('uses owner plus id plus version for deletion and fails closed on invalid references', async () => {
    const database = new TestDatabase(); database.push({ connection_id: record().id });
    const store = new PostgresMcpConnectionStore(database);
    expect(await store.remove(record().ownerId, record().id, 1)).toBe(true);
    expect(database.calls[0].values).toEqual([record().ownerId, record().id, 1]);
    expect(await store.remove('other owner', record().id, 1)).toBe(false);
    expect(database.calls).toHaveLength(1);
  });

  it('rejects malformed persisted data instead of returning it to the service', async () => {
    const database = new TestDatabase(); database.push(row(record({ endpoint: 'http://private.invalid/mcp' })));
    await expect(new PostgresMcpConnectionStore(database).list(record().ownerId)).rejects.toThrow('MCP_STORE_RECORD_INVALID');
  });

  it('creates no pool without a valid server-only PostgreSQL URL', () => {
    expect(createPostgresMcpConnectionStoreFromEnv({})).toBeUndefined();
    expect(createPostgresMcpConnectionStoreFromEnv({ DATABASE_URL: 'https://example.test' })).toBeUndefined();
  });
});
