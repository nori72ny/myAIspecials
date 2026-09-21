import type { QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresMcpToolGrantStore } from './mcpToolGrantStore.js';
import type { McpSqlExecutor } from './mcpPostgresStore.js';

class TestDatabase implements McpSqlExecutor {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  private readonly results: Array<Array<Record<string, unknown>>> = [];
  async connect() { return this; }
  release(_error?: Error | boolean) {}
  push(...rows: Array<Record<string, unknown>>) { this.results.push(rows); }
  async query<T extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    const housekeeping = /^(begin|set local|commit|rollback)/.test(text);
    const rows = (housekeeping ? [] : this.results.shift() ?? []) as T[];
    return { command: '', rowCount: rows.length, oid: 0, fields: [], rows };
  }
}

const owner = 'owner:11111111-1111-4111-8111-111111111111';
const connection = '11111111-1111-4111-8111-111111111111';
const fingerprint = 'a'.repeat(64);

describe('PostgresMcpToolGrantStore', () => {
  it('lists only owner-scoped exact tool fingerprints', async () => {
    const db = new TestDatabase();
    db.push({ tool_name: 'read_repository', fingerprint });
    const grants = await new PostgresMcpToolGrantStore(db).list(owner, connection);
    expect(grants).toEqual([{ name: 'read_repository', fingerprint }]);
    expect(db.calls[0].text).toContain('where owner_id = $1 and connection_id = $2::uuid');
    expect(db.calls[0].values).toEqual([owner, connection]);
  });

  it('rechecks verified connection version under lock before replacing grants', async () => {
    const db = new TestDatabase();
    db.push({ server_id: 'github', version: 2, status: 'verified' });
    const store = new PostgresMcpToolGrantStore(db);
    await store.replace(owner, 'github', connection, 2, [{ name: 'read_repository', fingerprint }]);
    expect(db.calls[0].text).toBe('begin isolation level read committed');
    expect(db.calls[3].text).toContain('for update');
    expect(db.calls[4].text).toContain('delete from public.origin_mcp_tool_grants');
    expect(db.calls[5].text).toContain('jsonb_to_recordset');
    expect(String(db.calls[5].values[3])).toContain('read_repository');
    expect(db.calls.at(-1)?.text).toBe('commit');
  });

  it('fails closed when the connection changed since owner review', async () => {
    const db = new TestDatabase();
    db.push({ server_id: 'github', version: 3, status: 'verified' });
    const store = new PostgresMcpToolGrantStore(db);
    await expect(store.replace(owner, 'github', connection, 2, [{ name: 'read_repository', fingerprint }]))
      .rejects.toThrow('MCP_TOOL_GRANT_CONNECTION_CHANGED');
    expect(db.calls.some(call => call.text.includes('insert into public.origin_mcp_tool_grants'))).toBe(false);
    expect(db.calls.at(-1)?.text).toBe('rollback');
  });

  it('rejects duplicate names, malformed fingerprints and excessive grants before database use', async () => {
    const db = new TestDatabase();
    const store = new PostgresMcpToolGrantStore(db);
    await expect(store.replace(owner, 'github', connection, 2, [
      { name: 'same', fingerprint },
      { name: 'same', fingerprint: 'b'.repeat(64) },
    ])).rejects.toThrow('MCP_TOOL_GRANT_INVALID');
    await expect(store.replace(owner, 'github', connection, 2, [{ name: 'bad', fingerprint: 'not-a-fingerprint' }]))
      .rejects.toThrow('MCP_TOOL_GRANT_INVALID');
    expect(db.calls).toHaveLength(0);
  });
});
