// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapCodingSchemaV14,
  type CodingSchemaBootstrapClientV14,
} from './codingSchemaBootstrapV14.js';

const productionEnv: NodeJS.ProcessEnv = {
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'main',
  POSTGRES_URL: 'postgresql://example.invalid/origin',
  ORIGIN_CODING_WORKER_ENABLED: 'false',
};

type QueryCall = { text: string; values?: readonly unknown[] };

type FakeClient = CodingSchemaBootstrapClientV14 & {
  calls: QueryCall[];
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function makeClient(
  respond: (text: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
): FakeClient {
  const calls: QueryCall[] = [];
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  return {
    calls,
    connect,
    end,
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      return respond(text, values);
    },
  } as FakeClient;
}

function healthyVerification() {
  return {
    jobs_table: true,
    results_table: true,
    jobs_rls: true,
    results_rls: true,
    cancel_trigger: true,
  };
}

describe('V1.4 guarded Vercel schema bootstrap', () => {
  it('never runs outside the production main deployment', async () => {
    const createClient = vi.fn();
    const preview = await bootstrapCodingSchemaV14(
      { ...productionEnv, VERCEL_ENV: 'preview' },
      { createClient },
    );
    const branch = await bootstrapCodingSchemaV14(
      { ...productionEnv, VERCEL_GIT_COMMIT_REF: 'feature/test' },
      { createClient },
    );

    expect(preview).toEqual({ status: 'skipped', code: 'CODING_SCHEMA_BOOTSTRAP_NOT_APPLICABLE' });
    expect(branch).toEqual({ status: 'skipped', code: 'CODING_SCHEMA_BOOTSTRAP_NOT_APPLICABLE' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('never mutates schema after the coding worker is enabled', async () => {
    const createClient = vi.fn();
    const result = await bootstrapCodingSchemaV14(
      { ...productionEnv, ORIGIN_CODING_WORKER_ENABLED: 'true' },
      { createClient },
    );
    expect(result.status).toBe('skipped');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('fails closed and rolls back when the database is not recognized as ORIGIN production', async () => {
    const client = makeClient(async text => {
      if (text.includes("origin_builder_publications")) return { rows: [{ origin_marker: false }] };
      return { rows: [] };
    });

    const result = await bootstrapCodingSchemaV14(productionEnv, {
      createClient: () => client,
      readMigration: vi.fn(),
    });

    expect(result).toEqual({ status: 'failed', code: 'CODING_SCHEMA_BOOTSTRAP_TARGET_UNRECOGNIZED' });
    expect(client.calls.some(call => call.text === 'rollback')).toBe(true);
    expect(client.calls.some(call => call.text === 'commit')).toBe(false);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('applies both fixed migrations atomically and verifies RLS plus cancellation cleanup', async () => {
    const client = makeClient(async text => {
      if (text.includes("origin_builder_publications")) return { rows: [{ origin_marker: true }] };
      if (text.includes('as jobs_table') && !text.includes('jobs_rls')) {
        return { rows: [{ jobs_table: false, results_table: false }] };
      }
      if (text.includes('jobs_rls')) return { rows: [healthyVerification()] };
      return { rows: [] };
    });
    const readMigration = vi.fn(async (url: URL) => url.pathname.includes('20260911') ? '--jobs-migration' : '--results-migration');

    const result = await bootstrapCodingSchemaV14(productionEnv, {
      createClient: () => client,
      readMigration,
    });

    expect(result).toEqual({ status: 'applied', code: 'CODING_SCHEMA_BOOTSTRAP_APPLIED' });
    expect(readMigration).toHaveBeenCalledTimes(2);
    expect(client.calls.some(call => call.text === '--jobs-migration')).toBe(true);
    expect(client.calls.some(call => call.text === '--results-migration')).toBe(true);
    expect(client.calls.some(call => call.text === 'commit')).toBe(true);
    expect(client.calls.some(call => call.text === 'rollback')).toBe(false);
  });

  it('does not replay DDL when the schema already passes verification', async () => {
    const client = makeClient(async text => {
      if (text.includes("origin_builder_publications")) return { rows: [{ origin_marker: true }] };
      if (text.includes('as jobs_table') && !text.includes('jobs_rls')) {
        return { rows: [{ jobs_table: true, results_table: true }] };
      }
      if (text.includes('jobs_rls')) return { rows: [healthyVerification()] };
      return { rows: [] };
    });
    const readMigration = vi.fn();

    const result = await bootstrapCodingSchemaV14(productionEnv, {
      createClient: () => client,
      readMigration,
    });

    expect(result).toEqual({ status: 'already_ready', code: 'CODING_SCHEMA_BOOTSTRAP_ALREADY_READY' });
    expect(readMigration).not.toHaveBeenCalled();
    expect(client.calls.some(call => call.text === 'commit')).toBe(true);
  });

  it('rolls back if post-migration security verification is incomplete', async () => {
    const client = makeClient(async text => {
      if (text.includes("origin_builder_publications")) return { rows: [{ origin_marker: true }] };
      if (text.includes('as jobs_table') && !text.includes('jobs_rls')) {
        return { rows: [{ jobs_table: false, results_table: false }] };
      }
      if (text.includes('jobs_rls')) return { rows: [{ ...healthyVerification(), cancel_trigger: false }] };
      return { rows: [] };
    });

    const result = await bootstrapCodingSchemaV14(productionEnv, {
      createClient: () => client,
      readMigration: vi.fn(async (url: URL) => url.pathname.includes('20260911') ? '--jobs-migration' : '--results-migration'),
    });

    expect(result).toEqual({ status: 'failed', code: 'CODING_SCHEMA_BOOTSTRAP_VERIFICATION_FAILED' });
    expect(client.calls.some(call => call.text === 'rollback')).toBe(true);
    expect(client.calls.some(call => call.text === 'commit')).toBe(false);
  });
});
