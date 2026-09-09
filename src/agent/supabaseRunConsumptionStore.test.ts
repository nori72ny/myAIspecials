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

  it('fails closed without a server-side Postgres connection URL', () => {
    expect(createAgentRunConsumptionStoreFromEnv({})).toBeUndefined();
    expect(createAgentRunConsumptionStoreFromEnv({ DATABASE_URL: 'https://not-a-database.example' })).toBeUndefined();
  });

  it('accepts Supabase/Vercel Postgres environment variable names', () => {
    expect(createAgentRunConsumptionStoreFromEnv({ POSTGRES_URL: 'postgresql://user:pass@example.invalid/db' })).toBeDefined();
    expect(createAgentRunConsumptionStoreFromEnv({ SUPABASE_DB_URL: 'postgres://user:pass@example.invalid/db' })).toBeDefined();
  });
});
