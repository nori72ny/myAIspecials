// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildCodingJobDispatchBodyV14, dispatchCodingJobV14 } from './codingJobDispatchV14.js';
import { createCodingJobIdV14 } from './codingJobCryptoV14.js';

const env = { ORIGIN_CODING_GITHUB_DISPATCH_TOKEN: Buffer.alloc(32, 23).toString('base64url') };

describe('V1.4 opaque GitHub Actions dispatch boundary', () => {
  it('serializes only main ref plus opaque job_id input', () => {
    const jobId = createCodingJobIdV14();
    const body = JSON.parse(buildCodingJobDispatchBodyV14(jobId));
    expect(body).toEqual({ ref: 'main', inputs: { job_id: jobId } });
    expect(Object.keys(body.inputs)).toEqual(['job_id']);
    expect(JSON.stringify(body)).not.toMatch(/goal|prompt|source|target|repository/i);
  });

  it('dispatches only to the fixed ORIGIN workflow without returning token material', async () => {
    const jobId = createCodingJobIdV14();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    const receipt = await dispatchCodingJobV14(jobId, env, fetchImpl as typeof fetch);
    expect(receipt).toEqual({ accepted: true, jobId, repository: 'nori72ny/myAIspecials', workflow: 'coding-job-worker-v14.yml', ref: 'main' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0][0];
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(String(url)).toBe('https://api.github.com/repos/nori72ny/myAIspecials/actions/workflows/coding-job-worker-v14.yml/dispatches');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main', inputs: { job_id: jobId } });
    expect(JSON.stringify(receipt)).not.toContain(env.ORIGIN_CODING_GITHUB_DISPATCH_TOKEN);
  });

  it('fails closed for malformed ids, missing credentials, transport errors, and non-204 responses', async () => {
    const jobId = createCodingJobIdV14();
    await expect(dispatchCodingJobV14('coding-invalid', env, vi.fn() as unknown as typeof fetch)).rejects.toThrow('CODING_DISPATCH_JOB_ID_INVALID');
    await expect(dispatchCodingJobV14(jobId, {}, vi.fn() as unknown as typeof fetch)).rejects.toThrow('CODING_DISPATCH_NOT_CONFIGURED');
    await expect(dispatchCodingJobV14(jobId, env, vi.fn(async () => { throw new Error('private transport text'); }) as unknown as typeof fetch)).rejects.toThrow('CODING_DISPATCH_UNAVAILABLE');
    await expect(dispatchCodingJobV14(jobId, env, vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch)).rejects.toThrow('CODING_DISPATCH_REJECTED');
  });
});
