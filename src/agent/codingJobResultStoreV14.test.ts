// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PostgresCodingJobResultStoreV14 } from './codingJobResultStoreV14.js';

const jobId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';
const workerId = 'gha:123:1';
const ciphertext = `r1.${'A'.repeat(16)}.BBBB.${'C'.repeat(22)}`;

describe('PostgresCodingJobResultStoreV14', () => {
  it('publishes bounded encrypted result payloads only through a live uncancelled worker lease', async () => {
    let capturedText = '';
    let capturedValues: readonly unknown[] | undefined;
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      capturedText = text;
      capturedValues = values;
      return { rows: [{ job_id: jobId }], rowCount: 1, command: '', oid: 0, fields: [] };
    });
    const store = new PostgresCodingJobResultStoreV14({ query } as never);
    await expect(store.put(jobId, workerId, ciphertext)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(capturedText).toContain('origin_coding_job_results_v14');
    expect(capturedText).toContain('lease_owner = $2');
    expect(capturedText).toContain("status in ('leased','running','repairing')");
    expect(capturedText).toContain('lease_expires_at > clock_timestamp()');
    expect(capturedText).toContain('cancel_requested_at is null');
    expect(capturedValues).toEqual([jobId, workerId, ciphertext]);
    await expect(store.put(jobId, workerId, 'plaintext result')).rejects.toThrow('CODING_JOB_RESULT_STORE_INPUT_INVALID');
    await expect(store.put(jobId, 'x', ciphertext)).rejects.toThrow('CODING_JOB_RESULT_STORE_INPUT_INVALID');
  });

  it('returns false when durable lease/cancellation conditions reject result publication', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] }));
    const store = new PostgresCodingJobResultStoreV14({ query } as never);
    await expect(store.put(jobId, workerId, ciphertext)).resolves.toBe(false);
  });

  it('returns encrypted result text without broadening ownership checks', async () => {
    let capturedValues: readonly unknown[] | undefined;
    const query = vi.fn(async (_text: string, values?: readonly unknown[]) => {
      capturedValues = values;
      return { rows: [{ result_ciphertext: ciphertext }], rowCount: 1, command: '', oid: 0, fields: [] };
    });
    const store = new PostgresCodingJobResultStoreV14({ query } as never);
    await expect(store.get(jobId)).resolves.toBe(ciphertext);
    expect(capturedValues).toEqual([jobId]);
    await expect(store.get('invalid')).resolves.toBeNull();
  });

  it('deletes encrypted result evidence by opaque job id', async () => {
    let capturedText = '';
    let capturedValues: readonly unknown[] | undefined;
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      capturedText = text;
      capturedValues = values;
      return { rows: [{ job_id: jobId }], rowCount: 1, command: '', oid: 0, fields: [] };
    });
    const store = new PostgresCodingJobResultStoreV14({ query } as never);
    await expect(store.delete(jobId)).resolves.toBe(true);
    expect(capturedText).toContain('delete from public.origin_coding_job_results_v14');
    expect(capturedValues).toEqual([jobId]);
    await expect(store.delete('invalid')).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
