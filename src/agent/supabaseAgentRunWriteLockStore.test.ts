// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { QueryResult } from 'pg';
import { PostgresAgentRunWriteLockStore, type AgentRunWriteLockSqlExecutor } from './supabaseAgentRunWriteLockStore.js';
import { AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY } from './agentRunWriteLock.js';

type Row = Record<string, unknown>;

function result<T extends Row>(rows: T[]): QueryResult<T> {
  return { command: 'TEST', rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult<T>;
}
class Recorder implements AgentRunWriteLockSqlExecutor {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: Row[][] = [];
  query<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    return Promise.resolve(result((this.responses.shift() ?? []) as T[]));
  }
}

const now = 1_700_000_000_000;
const KEY = AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY;
const RUN_A = 'run-writer-0001';
const DRIVER_A = 'driver-alpha-1';

function lockRow(overrides: Row = {}): Row {
  return {
    lock_key: KEY,
    holder_run_id: RUN_A,
    holder_driver_id: DRIVER_A,
    acquired_ms: String(now),
    lease_ms: String(now + 120_000),
    ...overrides,
  };
}

describe('PostgresAgentRunWriteLockStore acquire', () => {
  it('takes the lock through one conditional upsert with parameters only', async () => {
    const database = new Recorder();
    database.responses.push([lockRow()]);
    const store = new PostgresAgentRunWriteLockStore(database);
    const acquired = await store.acquire(KEY, RUN_A, DRIVER_A, 120);
    expect(acquired).toEqual({
      lockKey: KEY,
      holderRunId: RUN_A,
      holderDriverId: DRIVER_A,
      acquiredAt: now,
      leaseExpiresAt: now + 120_000,
    });
    const sql = database.calls[0].text;
    expect(sql).toContain('insert into public.origin_agent_write_locks');
    expect(sql).toContain('on conflict (lock_key) do update');
    // Takeover is allowed only when the lease lapsed or the holder is us.
    expect(sql).toContain('locks.lease_expires_at <= clock_timestamp()');
    expect(sql).toContain('locks.holder_run_id = excluded.holder_run_id');
    // A same-holder refresh keeps the original acquisition instant.
    expect(sql).toContain('then locks.acquired_at');
    expect(sql).not.toContain(RUN_A);
    expect(database.calls[0].values).toEqual([KEY, RUN_A, DRIVER_A, 120]);
  });

  it('returns null when the upsert yields no row (a live foreign lease)', async () => {
    const database = new Recorder();
    database.responses.push([]);
    const store = new PostgresAgentRunWriteLockStore(database);
    await expect(store.acquire(KEY, RUN_A, DRIVER_A, 120)).resolves.toBeNull();
  });

  it('rejects malformed rows coming back from the database', async () => {
    const database = new Recorder();
    database.responses.push([lockRow({ holder_run_id: 'not-a-run' })]);
    const store = new PostgresAgentRunWriteLockStore(database);
    await expect(store.acquire(KEY, RUN_A, DRIVER_A, 120)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_DB_ROW_INVALID');
  });
});

describe('PostgresAgentRunWriteLockStore renew, release and inspect', () => {
  it('renews conditionally on holder and a live lease', async () => {
    const database = new Recorder();
    database.responses.push([lockRow()], []);
    const store = new PostgresAgentRunWriteLockStore(database);
    await expect(store.renew(KEY, RUN_A, DRIVER_A, 120)).resolves.toBe(true);
    const sql = database.calls[0].text;
    expect(sql).toContain('update public.origin_agent_write_locks');
    expect(sql).toContain('holder_run_id = $2 and holder_driver_id = $3');
    expect(sql).toContain('lease_expires_at > clock_timestamp()');
    await expect(store.renew(KEY, RUN_A, DRIVER_A, 120)).resolves.toBe(false);
  });

  it('releases by deleting only the holder row', async () => {
    const database = new Recorder();
    database.responses.push([lockRow()], []);
    const store = new PostgresAgentRunWriteLockStore(database);
    await expect(store.release(KEY, RUN_A, DRIVER_A)).resolves.toBe(true);
    expect(database.calls[0].text).toContain('delete from public.origin_agent_write_locks');
    expect(database.calls[0].values).toEqual([KEY, RUN_A, DRIVER_A]);
    await expect(store.release(KEY, RUN_A, DRIVER_A)).resolves.toBe(false);
  });

  it('inspects the current row, or null when no lock row exists', async () => {
    const database = new Recorder();
    database.responses.push([lockRow()], []);
    const store = new PostgresAgentRunWriteLockStore(database);
    await expect(store.inspect(KEY)).resolves.toMatchObject({ holderRunId: RUN_A, leaseExpiresAt: now + 120_000 });
    expect(database.calls[0].text).toContain('from public.origin_agent_write_locks');
    await expect(store.inspect(KEY)).resolves.toBeNull();
  });

  it('validates inputs before issuing any query', async () => {
    const database = new Recorder();
    const store = new PostgresAgentRunWriteLockStore(database);
    await expect(store.acquire('Bad Key', RUN_A, DRIVER_A, 120)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.acquire(KEY, RUN_A, DRIVER_A, 10)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.renew(KEY, 'bogus', DRIVER_A, 120)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.release(KEY, RUN_A, 'x')).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.inspect('')).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    expect(database.calls).toHaveLength(0);
  });
});
