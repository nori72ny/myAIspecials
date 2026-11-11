// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult } from 'pg';
import {
  AGENT_RUN_SCHEMA_MIGRATIONS,
  createAgentRunSchemaEnsuringExecutor,
} from './agentRunSchema.js';
import { PostgresAgentRunStore, type AgentRunSqlExecutor } from './supabaseAgentRunStore.js';

type Row = Record<string, unknown>;

function result<T extends Row>(rows: T[]): QueryResult<T> {
  return { command: 'TEST', rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult<T>;
}

function isMigration(text: string): boolean {
  return (AGENT_RUN_SCHEMA_MIGRATIONS as readonly string[]).includes(text);
}

class FakeExecutor implements AgentRunSqlExecutor {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  failNextMigrationWith: unknown = null;
  failOperationsWith: unknown = null;

  query<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    if (isMigration(text)) {
      if (this.failNextMigrationWith !== null) {
        const error = this.failNextMigrationWith;
        this.failNextMigrationWith = null;
        return Promise.reject(error);
      }
      return Promise.resolve(result([]) as QueryResult<T>);
    }
    if (this.failOperationsWith !== null) return Promise.reject(this.failOperationsWith);
    return Promise.resolve(result([]) as QueryResult<T>);
  }

  migrationCalls(): string[] {
    return this.calls.filter((call) => isMigration(call.text)).map((call) => call.text);
  }

  operationCalls(): string[] {
    return this.calls.filter((call) => !isMigration(call.text)).map((call) => call.text);
  }
}

const ownerBinding = 'a'.repeat(64);
const runId = 'run-12345678-abcd';

function storeOver(fake: FakeExecutor): PostgresAgentRunStore {
  return new PostgresAgentRunStore(createAgentRunSchemaEnsuringExecutor(fake));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAgentRunSchemaEnsuringExecutor', () => {
  it('sends the migrations in order before the first store operation', async () => {
    const fake = new FakeExecutor();
    const store = storeOver(fake);
    const record = await store.get(runId, ownerBinding);
    expect(record).toBeNull();
    expect(fake.calls).toHaveLength(5);
    expect(fake.calls[0].text).toBe(AGENT_RUN_SCHEMA_MIGRATIONS[0]);
    expect(fake.calls[1].text).toBe(AGENT_RUN_SCHEMA_MIGRATIONS[1]);
    expect(fake.calls[2].text).toBe(AGENT_RUN_SCHEMA_MIGRATIONS[2]);
    expect(fake.calls[3].text).toBe(AGENT_RUN_SCHEMA_MIGRATIONS[3]);
    expect(fake.calls[4].text).toContain('from public.origin_agent_runs');
  });

  it('does not re-send the migrations after a successful ensure', async () => {
    const fake = new FakeExecutor();
    const store = storeOver(fake);
    await store.get(runId, ownerBinding);
    await store.get(runId, ownerBinding);
    expect(fake.migrationCalls()).toHaveLength(4);
    expect(fake.operationCalls()).toHaveLength(2);
  });

  it('shares a single in-flight ensure across concurrent first operations', async () => {
    const fake = new FakeExecutor();
    const store = storeOver(fake);
    const [first, second] = await Promise.all([store.get(runId, ownerBinding), store.get(runId, ownerBinding)]);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fake.migrationCalls()).toHaveLength(4);
    expect(fake.operationCalls()).toHaveLength(2);
  });

  it('still runs the triggering operation when the ensure fails, and retries on the next operation', async () => {
    const fake = new FakeExecutor();
    fake.failNextMigrationWith = Object.assign(new Error('permission denied for schema public'), { name: 'error', code: '42501' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = storeOver(fake);
    // The first migration fails, so this attempt stops there — but the
    // store operation itself still executes exactly as before.
    const record = await store.get(runId, ownerBinding);
    expect(record).toBeNull();
    expect(fake.migrationCalls()).toEqual([AGENT_RUN_SCHEMA_MIGRATIONS[0]]);
    expect(fake.operationCalls()).toHaveLength(1);
    expect(fake.operationCalls()[0]).toContain('from public.origin_agent_runs');
    // The failure is not cached: the next operation retries from the
    // first migration and, once the schema is ensured, proceeds.
    await store.get(runId, ownerBinding);
    expect(fake.migrationCalls()).toEqual([
      AGENT_RUN_SCHEMA_MIGRATIONS[0],
      AGENT_RUN_SCHEMA_MIGRATIONS[0],
      AGENT_RUN_SCHEMA_MIGRATIONS[1],
      AGENT_RUN_SCHEMA_MIGRATIONS[2],
      AGENT_RUN_SCHEMA_MIGRATIONS[3],
    ]);
    expect(fake.operationCalls()).toHaveLength(2);
  });

  it("propagates the operation's own failure unchanged when the ensure also fails", async () => {
    const fake = new FakeExecutor();
    fake.failNextMigrationWith = Object.assign(new Error('permission denied'), { name: 'error', code: '42501' });
    const operationError = Object.assign(new Error('relation "public.origin_agent_runs" does not exist'), { name: 'error', code: '42P01' });
    fake.failOperationsWith = operationError;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = storeOver(fake);
    await expect(store.get(runId, ownerBinding)).rejects.toBe(operationError);
  });

  it('logs only the error name and code when the ensure fails — never the message', async () => {
    const fake = new FakeExecutor();
    fake.failNextMigrationWith = Object.assign(
      new Error('permission denied for schema public (postgres://user:topsecret@db.internal:5432/postgres)'),
      { name: 'error', code: '42501' },
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = storeOver(fake);
    await store.get(runId, ownerBinding);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('ORIGIN_AGENT_RUN_SCHEMA_ENSURE_FAILED', { name: 'error', code: '42501' });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('topsecret');
    expect(logged).not.toContain('db.internal');
    expect(logged).not.toContain('permission denied');
  });

  it('falls back to UNKNOWN for name/code values that are not safe tokens', async () => {
    const fake = new FakeExecutor();
    fake.failNextMigrationWith = { name: 'bad name with spaces', code: 42501 };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = storeOver(fake);
    await store.get(runId, ownerBinding);
    expect(errorSpy).toHaveBeenCalledWith('ORIGIN_AGENT_RUN_SCHEMA_ENSURE_FAILED', { name: 'UNKNOWN', code: 'UNKNOWN' });
  });

  it('logs nothing when the ensure succeeds', async () => {
    const fake = new FakeExecutor();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = storeOver(fake);
    await store.get(runId, ownerBinding);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
