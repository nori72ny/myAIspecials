// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PostgresCodingJobResultStoreV14 } from './codingJobResultStoreV14.js';

const jobId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';
const ciphertext = `r1.${'A'.repeat(16)}.BBBB.${'C'.repeat(22)}`;

describe('PostgresCodingJobResultStoreV14', () => {
  it('upserts only bounded encrypted result payloads', async () => {
    const query = vi.fn(async () => ({ rows: [{ job_id: jobId }], rowCount: 1, command: '', oid: 0, fields: [] }));
    const store = new PostgresCodingJobResultStoreV14({ query } as never);
    await expect(store.put(jobId, ciphertext)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('origin_coding_job_results_v14');
    expect(query.mock.calls[0][1]).toEqual([jobId, ciphertext]);
    await expect(store.put(jobId, 'plaintext result')).rejects.toThrow('CODING_JOB_RESULT_STORE_INPUT_INVALID');
  });

  it('returns encrypted result text without broadening ownership checks', async () => {
    const query = vi.fn(async () => ({ rows: [{ result_ciphertext: ciphertext }], rowCount: 1, command: '', oid: 0, fields: [] }));
    const store = new PostgresCodingJobResultStoreV14({ query } as never);
    await expect(store.get(jobId)).resolves.toBe(ciphertext);
    expect(query.mock.calls[0][1]).toEqual([jobId]);
    await expect(store.get('invalid')).resolves.toBeNull();
  });
});
