import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from 'pg';
import {
  PostgresAgentMultiToolRunLedgerV31,
  createAgentMultiToolRunLedgerFromEnvV31,
  type AgentMultiToolLedgerSqlV31,
} from './agentMultiToolRunLedgerV31.js';

const RUN = 'run-supervisor-1';
const HASH = 'a'.repeat(64);

function receipt(count: number, runId = RUN): QueryResult<{ run_id: string }> {
  return {
    command: 'INSERT', rowCount: count, oid: 0, fields: [],
    rows: count === 1 ? [{ run_id: runId }] : [],
  };
}

describe('PostgreSQL V3.1 durable run reservation (schema not deployed)', () => {
  it('uses one atomic insert, a unique run id and no legacy TTL or cleanup', async () => {
    const query = vi.fn().mockResolvedValue(receipt(1));
    const store = new PostgresAgentMultiToolRunLedgerV31({ query } as unknown as AgentMultiToolLedgerSqlV31);
    await expect(store.reserveRunOnce(RUN, HASH)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into public.origin_agent_multitool_runs_v31');
    expect(sql).toContain('on conflict (run_id) do nothing');
    expect(sql).toContain('returning run_id');
    expect(sql).not.toMatch(/delete from|expires_at|clock_timestamp|\bcleanup\b/i);
    expect(args).toEqual([RUN, HASH]);
  });

  it('rejects a duplicate run even with different approved goal content', async () => {
    const reserved = new Set<string>();
    const query = vi.fn(async (_sql: string, values: readonly unknown[]) => {
      const run = values[0] as string;
      if (reserved.has(run)) return receipt(0);
      reserved.add(run);
      return receipt(1, run);
    });
    const store = new PostgresAgentMultiToolRunLedgerV31({ query } as unknown as AgentMultiToolLedgerSqlV31);
    await expect(store.reserveRunOnce(RUN, HASH)).resolves.toBe(true);
    await expect(store.reserveRunOnce(RUN, 'b'.repeat(64))).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails closed on malformed ids and hashes before touching SQL', async () => {
    const query = vi.fn();
    const store = new PostgresAgentMultiToolRunLedgerV31({ query } as unknown as AgentMultiToolLedgerSqlV31);
    await expect(store.reserveRunOnce('run-bad_id_123', HASH)).rejects.toThrow('AGENT_MULTITOOL_RUN_ID_INVALID');
    await expect(store.reserveRunOnce(RUN, 'A'.repeat(64))).rejects.toThrow('AGENT_MULTITOOL_GOAL_DIGEST_INVALID');
    await expect(store.reserveRunOnce(RUN, '0')).rejects.toThrow('AGENT_MULTITOOL_GOAL_DIGEST_INVALID');
    expect(query).not.toHaveBeenCalled();
  });

  it('does not accept corrupt storage acknowledgements as a reservation', async () => {
    for (const bad of [
      receipt(1, 'run-someone-else'),
      { ...receipt(0), rows: [{ run_id: RUN }] },
      { ...receipt(1), rows: [] },
      { ...receipt(2), rows: [{ run_id: RUN }, { run_id: RUN }] },
    ]) {
      const store = new PostgresAgentMultiToolRunLedgerV31({
        query: vi.fn().mockResolvedValue(bad),
      } as unknown as AgentMultiToolLedgerSqlV31);
      await expect(store.reserveRunOnce(RUN, HASH)).rejects.toThrow('AGENT_MULTITOOL_RUN_RESERVATION_RECEIPT_INVALID');
    }
  });

  it('does not retry an uncertain database outage', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database timeout after INSERT'));
    const store = new PostgresAgentMultiToolRunLedgerV31({ query } as unknown as AgentMultiToolLedgerSqlV31);
    await expect(store.reserveRunOnce(RUN, HASH)).rejects.toThrow('database timeout after INSERT');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('review-only ledger SQL denies browser roles, enables RLS and has no TTL cleanup', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'docs/AGENT_MULTITOOL_V31_RUN_LEDGER_SCHEMA_REVIEW.sql'),
      'utf8',
    );
    expect(sql).toContain('REVIEW-ONLY DRAFT');
    expect(sql).toContain('create table if not exists public.origin_agent_multitool_runs_v31');
    expect(sql).toContain('run_id text primary key');
    expect(sql).toContain('goal_digest text not null');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('from public;');
    expect(sql).toContain('from anon;');
    expect(sql).toContain('from authenticated;');
    expect(sql).toContain('revoke all on table public.origin_agent_multitool_runs_v31 from service_role;');
    expect(sql).toContain('grant select, insert on table public.origin_agent_multitool_runs_v31 to service_role;');
    expect(sql).not.toMatch(/^\s*delete\s+from/im);
    expect(sql).not.toMatch(/^\s*grant\s+.*\s+to\s+(?:anon|authenticated)\b/im);
    expect(sql).not.toContain('expires_at');
  });

  it('stays disabled unless explicitly opted in with server-side PostgreSQL credentials', () => {
    expect(createAgentMultiToolRunLedgerFromEnvV31({})).toBeUndefined();
    expect(createAgentMultiToolRunLedgerFromEnvV31({ POSTGRES_URL: 'postgresql://x@y/db' })).toBeUndefined();
    expect(createAgentMultiToolRunLedgerFromEnvV31({
      ORIGIN_AGENT_MULTITOOL_LEDGER_V31_ENABLED: 'true',
      DATABASE_URL: 'https://example.invalid',
    })).toBeUndefined();
    expect(createAgentMultiToolRunLedgerFromEnvV31({
      ORIGIN_AGENT_MULTITOOL_LEDGER_V31_ENABLED: 'true',
      POSTGRES_URL: 'postgresql://service:password@example.invalid/db',
    })).toBeDefined();
  });
});
