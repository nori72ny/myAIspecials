import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from 'pg';
import { PostgresAgentRunConsumptionStore, createAgentRunConsumptionStoreFromEnv, type AgentReplaySqlExecutor } from './supabaseRunConsumptionStore.js';

function result(rowCount: number): QueryResult<{ run_id: string }> {
  return { command: 'INSERT', rowCount, oid: 0, fields: [], rows: rowCount === 1 ? [{ run_id: 'run-abcdefgh' }] : [] };
}

describe('PostgresAgentRunConsumptionStore', () => {
  it('uses one atomic insert and reports first consumption', async () => {
    const query = vi.fn().mockResolvedValue(result(1));
    const store = new PostgresAgentRunConsumptionStore({ query } as unknown as AgentReplaySqlExecutor);
    const expiresAt = Date.now() + 60_000;

    await expect(store.consume('run-abcdefgh', expiresAt)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('on conflict (run_id) do nothing');
    expect(query.mock.calls[0]?.[1]).toEqual(['run-abcdefgh', expiresAt]);
  });

  it('reports duplicate consumption without retrying', async () => {
    const query = vi.fn().mockResolvedValue(result(0));
    const store = new PostgresAgentRunConsumptionStore({ query } as unknown as AgentReplaySqlExecutor);

    await expect(store.consume('run-abcdefgh', Date.now() + 60_000)).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid run ids and unbounded expiry before database access', async () => {
    const query = vi.fn();
    const store = new PostgresAgentRunConsumptionStore({ query } as unknown as AgentReplaySqlExecutor);

    await expect(store.consume('bad', Date.now() + 60_000)).rejects.toThrow('INVALID_AGENT_RUN_ID');
    await expect(store.consume('run-abcdefgh', Date.now() + 16 * 60_000)).rejects.toThrow('INVALID_AGENT_RUN_EXPIRY');
    expect(query).not.toHaveBeenCalled();
  });

  it('atomically counts and reserves a cross-instance 60-per-minute quota under a transaction lock', async () => {
    const release = vi.fn();
    const clientQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('floor(extract(epoch')) return { rows: [{ minute: '30000000' }] };
      if (sql.includes('count(*)::integer')) return { rows: [{ total: 59 }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query: clientQuery, release };
    const executor = { query: vi.fn(), connect: vi.fn(async () => client) };
    const store = new PostgresAgentRunConsumptionStore(executor as unknown as AgentReplaySqlExecutor);
    await expect(store.claimAgentRateSlot('a'.repeat(32))).resolves.toBe(true);
    const queries = clientQuery.mock.calls.map(([sql]) => sql);
    expect(queries).toEqual([
      'BEGIN',
      "SET LOCAL statement_timeout = '2500ms'",
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('LIMIT 64 FOR UPDATE SKIP LOCKED'),
      expect.stringContaining('floor(extract(epoch'),
      expect.stringContaining('count(*)::integer'),
      expect.stringContaining('INSERT INTO public.origin_agent_consumed_runs'),
      'COMMIT',
    ]);
    // A lexical upper bound with '~' silently misses rows under some PG
    // collations, allowing all 65 concurrent requests through.
    expect(queries[5]).toContain("WHERE run_id LIKE ($1 || '%')");
    expect(queries[3]).toContain('expires_at < clock_timestamp()');
    expect(queries[3]).toContain('ORDER BY expires_at');
    const insertValues = clientQuery.mock.calls[6]?.[1] as unknown[];
    expect(insertValues[0]).toMatch(/^run-ratelimit-[0-9a-f]{32}-[0-9a-z]+-[0-9a-f]{32}$/);
    expect(insertValues[1]).toBe((30_000_000 + 2) * 60_000);
    expect(release).toHaveBeenCalledTimes(1);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it('denies the 61st distributed request without inserting or revealing client data', async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('floor(extract(epoch')) return { rows: [{ minute: '30000000' }] };
      if (sql.includes('count(*)::integer')) return { rows: [{ total: 60 }] };
      return { rows: [], rowCount: 1 };
    });
    const store = new PostgresAgentRunConsumptionStore({
      query: vi.fn(), connect: async () => ({ query, release }),
    } as unknown as AgentReplaySqlExecutor);
    await expect(store.claimAgentRateSlot('b'.repeat(32))).resolves.toBe(false);
    expect(query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails closed, rolls back and releases the connection when PostgreSQL cannot count', async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('floor(extract(epoch')) return { rows: [{ minute: '30000000' }] };
      if (sql.includes('count(*)::integer')) throw new Error('private postgres connection');
      return { rows: [] };
    });
    const store = new PostgresAgentRunConsumptionStore({
      query: vi.fn(), connect: async () => ({ query, release }),
    } as unknown as AgentReplaySqlExecutor);
    await expect(store.claimAgentRateSlot('c'.repeat(32))).rejects.toThrow('AGENT_RATE_SHARED_STORE_UNAVAILABLE');
    expect(query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
    await expect(store.claimAgentRateSlot('raw-ip-value')).rejects.toThrow('AGENT_RATE_IDENTITY_INVALID');
  });

  it('fails closed without a server-side Postgres connection URL', () => {
    expect(createAgentRunConsumptionStoreFromEnv({})).toBeUndefined();
    expect(createAgentRunConsumptionStoreFromEnv({ DATABASE_URL: 'https://not-a-database.example' })).toBeUndefined();
  });

  it('accepts Supabase/Vercel Postgres environment variable names', () => {
    expect(createAgentRunConsumptionStoreFromEnv({ POSTGRES_URL: 'postgresql://user:pass@example.invalid/db' })).toBeDefined();
    expect(createAgentRunConsumptionStoreFromEnv({ SUPABASE_DB_URL: 'postgres://user:pass@example.invalid/db' })).toBeDefined();
  });
});
