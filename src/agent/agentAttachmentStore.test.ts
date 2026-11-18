// @vitest-environment node
import { createHash } from 'node:crypto';
import type { QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import { PostgresAgentAttachmentStore, createAgentAttachmentStoreFromEnv, type AgentAttachmentSqlExecutor } from './supabaseAgentAttachmentStore.js';
import {
  AGENT_ATTACHMENT_SCHEMA_MIGRATIONS,
  createAgentAttachmentSchemaEnsuringExecutor,
} from './agentAttachmentSchema.js';
import {
  validateAgentAttachmentFileText,
  type AddAgentAttachmentFileInput,
} from './agentAttachmentRecord.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const ownerBinding = 'a'.repeat(64);
const otherBinding = 'b'.repeat(64);
const setId = 'att-12345678-abcd-4ef0-9abc-def012345678';
const runId = 'run-12345678-abcd';

function fileInput(text: string, name = 'data.csv'): AddAgentAttachmentFileInput {
  return {
    name,
    mediaType: 'text/csv',
    kind: 'text',
    ...validateAgentAttachmentFileText(text),
    extractedText: text,
  };
}

/** Builds an input without the validating helper, for cases where the
 * store boundary itself must be the one to reject the file. */
function rawFileInput(text: string, name = 'data.csv'): AddAgentAttachmentFileInput {
  return {
    name,
    mediaType: 'text/csv',
    kind: 'text',
    byteSize: Buffer.byteLength(text, 'utf8'),
    charCount: text.length,
    sha256: sha256(text),
    extractedText: text,
  };
}

async function makeStore(now: () => number = () => Date.now()) {
  const store = new InMemoryAgentAttachmentStore(now);
  const created = await store.createSet({
    setId,
    ownerBinding,
    uploadTokenDigest: sha256('upload-token'),
    expiresAt: now() + 60_000,
  }, now());
  expect(created?.setId).toBe(setId);
  return store;
}

describe('in-memory attachment store', () => {
  it('creates, fills and reads a set with metadata separated from bodies', async () => {
    const store = await makeStore();
    const first = await store.addFile(setId, ownerBinding, fileInput('a,b\n1,2\n'));
    const second = await store.addFile(setId, ownerBinding, fileInput('メモです', 'memo.txt'));
    expect(first.idx).toBe(0);
    expect(second.idx).toBe(1);
    const set = await store.getSet(setId, ownerBinding);
    expect(set?.files.map((file) => file.name)).toEqual(['data.csv', 'memo.txt']);
    expect(set?.files[0]?.sha256).toBe(sha256('a,b\n1,2\n'));
    expect(JSON.stringify(set)).not.toContain('a,b');
    expect(await store.getFileText(setId, ownerBinding, 0)).toBe('a,b\n1,2\n');
    expect(await store.getFileText(setId, ownerBinding, 1)).toBe('メモです');
    expect(await store.getFileText(setId, ownerBinding, 2)).toBeNull();
  });

  it('scopes every operation by owner binding', async () => {
    const store = await makeStore();
    await store.addFile(setId, ownerBinding, fileInput('x'));
    expect(await store.getSet(setId, otherBinding)).toBeNull();
    expect(await store.getFileText(setId, otherBinding, 0)).toBeNull();
    await expect(store.addFile(setId, otherBinding, fileInput('y'))).rejects.toThrow('AGENT_ATTACHMENT_SET_NOT_FOUND');
    expect(await store.deleteSet(setId, otherBinding)).toBe(false);
    expect(await store.getSet(setId, ownerBinding)).not.toBeNull();
  });

  it('rejects a duplicate set creation', async () => {
    const store = await makeStore();
    const duplicate = await store.createSet({
      setId,
      ownerBinding,
      uploadTokenDigest: sha256('upload-token'),
      expiresAt: Date.now() + 60_000,
    });
    expect(duplicate).toBeNull();
  });

  it('enforces the file-count and total-char limits atomically per set', async () => {
    const store = await makeStore();
    for (let index = 0; index < 10; index += 1) {
      await store.addFile(setId, ownerBinding, fileInput(`row-${index}`, `f${index}.txt`));
    }
    await expect(store.addFile(setId, ownerBinding, fileInput('one-too-many', 'f10.txt')))
      .rejects.toThrow('AGENT_ATTACHMENT_SET_FILE_LIMIT');

    const bigStore = await makeStore();
    await bigStore.addFile(setId, ownerBinding, fileInput('a'.repeat(200_000), 'big1.txt'));
    await bigStore.addFile(setId, ownerBinding, fileInput('b'.repeat(200_000), 'big2.txt'));
    await expect(bigStore.addFile(setId, ownerBinding, fileInput('c'.repeat(100_001), 'big3.txt')))
      .rejects.toThrow('AGENT_ATTACHMENT_SET_TOO_LARGE');
    const fits = await bigStore.addFile(setId, ownerBinding, fileInput('c'.repeat(100_000), 'big3.txt'));
    expect(fits.charCount).toBe(100_000);
  });

  it('rejects oversize, secret-bearing and mis-measured files at the store boundary', async () => {
    const store = await makeStore();
    await expect(store.addFile(setId, ownerBinding, rawFileInput('a'.repeat(200_001))))
      .rejects.toThrow('AGENT_ATTACHMENT_FILE_TOO_LARGE');
    await expect(store.addFile(setId, ownerBinding, rawFileInput('token = "abc123"')))
      .rejects.toThrow('AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED');
    const honest = fileInput('body');
    await expect(store.addFile(setId, ownerBinding, { ...honest, byteSize: honest.byteSize + 1 }))
      .rejects.toThrow('AGENT_ATTACHMENT_FILE_INVALID');
  });

  it('deletes expired sets lazily on every read path and sweeps the rest', async () => {
    let current = Date.now();
    const store = await makeStore(() => current);
    await store.addFile(setId, ownerBinding, fileInput('ephemeral'));
    current += 61_000;
    expect(await store.getSet(setId, ownerBinding)).toBeNull();
    expect(await store.getFileText(setId, ownerBinding, 0)).toBeNull();
    await expect(store.addFile(setId, ownerBinding, fileInput('late'))).rejects.toThrow('AGENT_ATTACHMENT_SET_NOT_FOUND');
    expect(await store.sweepExpired(100, current)).toBe(0);

    const secondId = 'att-87654321-abcd-4ef0-9abc-def012345678';
    await store.createSet({
      setId: secondId,
      ownerBinding,
      uploadTokenDigest: sha256('upload-token-2'),
      expiresAt: current + 1_000,
    }, current);
    current += 2_000;
    expect(await store.sweepExpired(100, current)).toBe(1);
    expect(await store.getSet(secondId, ownerBinding, current)).toBeNull();
  });

  it('claims an open set for a run and freezes uploads afterwards', async () => {
    const store = await makeStore();
    await store.addFile(setId, ownerBinding, fileInput('claimed-body'));
    const claimed = await store.claimSet(setId, ownerBinding, runId, Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedRunId).toBe(runId);
    expect(await store.claimSet(setId, ownerBinding, runId, Date.now() + 60_000)).toBeNull();
    await expect(store.addFile(setId, ownerBinding, fileInput('too-late'))).rejects.toThrow('AGENT_ATTACHMENT_SET_NOT_OPEN');
    expect(await store.getFileText(setId, ownerBinding, 0)).toBe('claimed-body');
    await expect(store.claimSet(setId, ownerBinding, 'not-a-run', Date.now() + 60_000)).rejects.toThrow('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
  });

  it('deletes a set immediately and only for its owner', async () => {
    const store = await makeStore();
    await store.addFile(setId, ownerBinding, fileInput('to-delete'));
    expect(await store.deleteSet(setId, ownerBinding)).toBe(true);
    expect(await store.getSet(setId, ownerBinding)).toBeNull();
    expect(await store.deleteSet(setId, ownerBinding)).toBe(false);
  });

  it('bridges a claim across bindings: re-binds and claims in one step (F3)', async () => {
    const store = await makeStore();
    await store.addFile(setId, ownerBinding, fileInput('bridged-body'));
    const claimed = await store.claimSetForRun(setId, ownerBinding, otherBinding, runId, Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedRunId).toBe(runId);
    expect(claimed?.ownerBinding).toBe(otherBinding);
    // The set moved: invisible under the upload binding, and both its
    // metadata and its body are readable under the run's binding only.
    expect(await store.getSet(setId, ownerBinding)).toBeNull();
    expect(await store.getFileText(setId, ownerBinding, 0)).toBeNull();
    expect((await store.getSet(setId, otherBinding))?.status).toBe('claimed');
    expect(await store.getFileText(setId, otherBinding, 0)).toBe('bridged-body');
    // A second bridge attempt finds nothing left to move, and a set
    // that is not open under the source binding never moves.
    expect(await store.claimSetForRun(setId, ownerBinding, otherBinding, runId, Date.now() + 60_000)).toBeNull();
    await expect(store.claimSetForRun(setId, otherBinding, ownerBinding, 'not-a-run', Date.now() + 60_000))
      .rejects.toThrow('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
  });
});

// ---------------------------------------------------------------------
// Postgres store: a fake executor stands in for the database (the
// semantic matrix above is covered against the in-memory store, and
// the real-Postgres concurrency suite exercises the same SQL shape in
// CI). These tests pin row parsing, the lazy-deletion statement flow,
// and the schema-ensure behavior.

type Row = Record<string, unknown>;

function result<T extends Row>(rows: T[]): QueryResult<T> {
  return { command: 'TEST', rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult<T>;
}

function setRow(overrides: Partial<Row> = {}): Row {
  const now = Date.now();
  return {
    set_id: setId,
    owner_binding: ownerBinding,
    upload_token_digest: sha256('upload-token'),
    status: 'open',
    claimed_run_id: null,
    expires_ms: String(now + 60_000),
    created_ms: String(now),
    updated_ms: String(now),
    ...overrides,
  };
}

class FakeExecutor implements AgentAttachmentSqlExecutor {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  handler: (text: string, values: readonly unknown[]) => QueryResult<Row> = () => result([]);

  query<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    return Promise.resolve(this.handler(text, values) as QueryResult<T>);
  }
}

describe('postgres attachment store (fake executor)', () => {
  it('parses set and file rows on create and get', async () => {
    const executor = new FakeExecutor();
    executor.handler = (text) => {
      if (text.includes('insert into public.origin_agent_attachment_sets')) return result([setRow()]);
      if (text.includes('from public.origin_agent_attachments')) {
        return result([{
          idx: 0, name: 'data.csv', media_type: 'text/csv', kind: 'text',
          byte_size: 8, char_count: 8, sha256: sha256('a,b\n1,2\n'), extraction_status: 'ok',
        }]);
      }
      if (text.includes('from public.origin_agent_attachment_sets')) return result([setRow()]);
      return result([]);
    };
    const store = new PostgresAgentAttachmentStore(executor);
    const created = await store.createSet({
      setId, ownerBinding, uploadTokenDigest: sha256('upload-token'), expiresAt: Date.now() + 60_000,
    });
    expect(created?.files).toEqual([]);
    const fetched = await store.getSet(setId, ownerBinding);
    expect(fetched?.files).toHaveLength(1);
    expect(fetched?.files[0]?.name).toBe('data.csv');
    expect(fetched?.status).toBe('open');
  });

  it('deletes an expired set lazily instead of returning it', async () => {
    const executor = new FakeExecutor();
    const deleted: string[] = [];
    executor.handler = (text) => {
      if (text.includes('delete from public.origin_agent_attachment_sets')) {
        deleted.push(text);
        return result([{ set_id: setId }]);
      }
      if (text.includes('from public.origin_agent_attachment_sets')) {
        return result([setRow({ expires_ms: String(Date.now() - 1_000) })]);
      }
      return result([]);
    };
    const store = new PostgresAgentAttachmentStore(executor);
    expect(await store.getSet(setId, ownerBinding)).toBeNull();
    expect(deleted).toHaveLength(1);
  });

  it('re-binds the set to the run binding in the claim bridge update (F3)', async () => {
    const executor = new FakeExecutor();
    executor.handler = (text) => {
      if (text.includes('update public.origin_agent_attachment_sets')) {
        return result([setRow({ owner_binding: otherBinding, status: 'claimed', claimed_run_id: runId })]);
      }
      if (text.includes('from public.origin_agent_attachments')) return result([]);
      return result([]);
    };
    const store = new PostgresAgentAttachmentStore(executor);
    const expiresAt = Date.now() + 60_000;
    const claimed = await store.claimSetForRun(setId, ownerBinding, otherBinding, runId, expiresAt);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.ownerBinding).toBe(otherBinding);
    expect(claimed?.claimedRunId).toBe(runId);
    const update = executor.calls.find((call) => call.text.includes('update public.origin_agent_attachment_sets'));
    expect(update?.text).toContain("status = 'claimed'");
    // The update is scoped by the source binding and moves the row to
    // the run's binding in the same statement.
    expect(update?.values).toEqual([setId, otherBinding, runId, expiresAt, ownerBinding]);
  });

  it('rejects malformed rows instead of returning partial records', async () => {
    const executor = new FakeExecutor();
    executor.handler = (text) => (text.includes('from public.origin_agent_attachment_sets')
      ? result([setRow({ status: 'claimed', claimed_run_id: null })])
      : result([]));
    const store = new PostgresAgentAttachmentStore(executor);
    await expect(store.getSet(setId, ownerBinding)).rejects.toThrow('AGENT_ATTACHMENT_DB_ROW_INVALID');
  });

  it('builds the env store only when a database URL is configured', () => {
    expect(createAgentAttachmentStoreFromEnv({})).toBeUndefined();
    expect(createAgentAttachmentStoreFromEnv({ POSTGRES_URL: 'https://not-a-database' })).toBeUndefined();
    expect(createAgentAttachmentStoreFromEnv({ POSTGRES_URL: 'postgres://localhost:5432/test' }))
      .toBeInstanceOf(PostgresAgentAttachmentStore);
  });
});

describe('attachment schema ensuring executor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the migrations once before the first operation', async () => {
    const executor = new FakeExecutor();
    const ensuring = createAgentAttachmentSchemaEnsuringExecutor(executor);
    await ensuring.query('select 1');
    await ensuring.query('select 2');
    const migrations = executor.calls.filter((call) => (AGENT_ATTACHMENT_SCHEMA_MIGRATIONS as readonly string[]).includes(call.text));
    expect(migrations).toHaveLength(AGENT_ATTACHMENT_SCHEMA_MIGRATIONS.length);
    expect(executor.calls[0]?.text).toBe(AGENT_ATTACHMENT_SCHEMA_MIGRATIONS[0]);
  });

  it('logs (name/code only) and retries after a failed ensure, without blocking operations', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const executor = new FakeExecutor();
    let failMigration = true;
    executor.handler = (text) => {
      if ((AGENT_ATTACHMENT_SCHEMA_MIGRATIONS as readonly string[]).includes(text) && failMigration) {
        failMigration = false;
        throw Object.assign(new Error('connection details must not be logged'), { name: 'FakeDbError', code: '42501' });
      }
      return result([]);
    };
    const ensuring = createAgentAttachmentSchemaEnsuringExecutor(executor);
    await ensuring.query('select 1');
    expect(consoleError).toHaveBeenCalledWith(
      'ORIGIN_AGENT_ATTACHMENT_SCHEMA_ENSURE_FAILED',
      { name: 'FakeDbError', code: '42501' },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('connection details');
    // The failed ensure is not cached: the next operation retries it.
    await ensuring.query('select 2');
    const migrations = executor.calls.filter((call) => (AGENT_ATTACHMENT_SCHEMA_MIGRATIONS as readonly string[]).includes(call.text));
    expect(migrations).toHaveLength(2 * AGENT_ATTACHMENT_SCHEMA_MIGRATIONS.length);
  });
});
