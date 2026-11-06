import { describe, expect, it, vi } from 'vitest';
import { composeCodingJobGoal, createAgentCodingDelegationV14, type AgentCodingJobStore } from './agentCodingDelegationV14.js';
import type { CodingJobEnvelopeV14 } from './codingJobCryptoV14.js';

const env = {
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 11).toString('base64'),
  ORIGIN_CODING_GITHUB_DISPATCH_TOKEN: 'g'.repeat(40),
};

function fakeStore(): AgentCodingJobStore & { created: CodingJobEnvelopeV14[]; cancelled: string[] } {
  const created: CodingJobEnvelopeV14[] = [];
  const cancelled: string[] = [];
  return {
    created,
    cancelled,
    create: async (envelope) => {
      created.push(envelope);
      return { jobId: envelope.jobId };
    },
    requestCancel: async (jobId) => {
      cancelled.push(jobId);
      return null;
    },
  };
}

describe('agent coding delegation to the V14 job pipeline', () => {
  it('composes a bounded job goal from structured parameters', () => {
    const goal = composeCodingJobGoal({
      mode: 'provided-code',
      instruction: 'このコードを検証してください',
      code: 'const add = (a: number, b: number) => a + b;',
      language: 'typescript',
      targetPath: 'src/add.ts',
    });
    expect(goal).toContain('このコードを検証してください');
    expect(goal).toContain('対象ファイル: src/add.ts');
    expect(goal).toContain('```typescript');
    expect(goal).toContain('const add');
    expect(goal.length).toBeLessThanOrEqual(3600);
  });

  it('creates an encrypted envelope in the store and dispatches only the opaque job id', async () => {
    const store = fakeStore();
    const dispatch = vi.fn(async (jobId: string) => ({ accepted: true as const, jobId, repository: 'nori72ny/myAIspecials' as const, workflow: 'coding-job-worker-v14.yml' as const, ref: 'main' as const }));
    const port = createAgentCodingDelegationV14({ env, jobStore: store, dispatch });
    expect(port).toBeDefined();
    const result = await port!.dispatch({ mode: 'generate', instruction: 'CSVを集計するコードを作成してください', language: 'python' });
    expect(result.state).toBe('dispatched');
    if (result.state !== 'dispatched') throw new Error('expected dispatch');
    expect(store.created).toHaveLength(1);
    expect(store.created[0].jobId).toBe(result.jobId);
    expect(store.created[0].targetKey).toBe('origin:self');
    // The envelope payload is ciphertext: the goal must not be readable.
    expect(store.created[0].payloadCiphertext).not.toContain('CSV');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toBe(result.jobId);
  });

  it('fails closed when the dispatch token is not configured', async () => {
    const store = fakeStore();
    const port = createAgentCodingDelegationV14({
      env: { ...env, ORIGIN_CODING_GITHUB_DISPATCH_TOKEN: '' },
      jobStore: store,
      dispatch: async () => { throw new Error('must not be called'); },
    });
    const result = await port!.dispatch({ mode: 'generate', instruction: 'コードを作成してください' });
    expect(result).toEqual({ state: 'unavailable', code: 'AGENT_CODE_DISPATCH_NOT_CONFIGURED' });
    expect(store.created).toHaveLength(0);
  });

  it('cancels the created job when dispatch fails', async () => {
    const store = fakeStore();
    const port = createAgentCodingDelegationV14({
      env,
      jobStore: store,
      dispatch: async () => { throw new Error('CODING_DISPATCH_UNAVAILABLE'); },
    });
    const result = await port!.dispatch({ mode: 'generate', instruction: 'コードを作成してください' });
    expect(result).toEqual({ state: 'unavailable', code: 'AGENT_CODE_DISPATCH_FAILED' });
    expect(store.cancelled).toHaveLength(1);
  });

  it('returns no port when no job store is configured', () => {
    expect(createAgentCodingDelegationV14({ env })).toBeUndefined();
  });
});
