import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  OPENROUTER_MODELS_API,
  ORIGIN_VERIFIED_CODING_FREE_MODEL,
  updatedCodingFreeModelEvidence,
  verifyAndRefreshCodingFreeModel,
  verifyCodingFreeModelPayload,
  writeCodingFreeModelVerificationReport,
} from './verify-coding-free-model';

const zeroCostPayload = {
  data: [{
    id: ORIGIN_VERIFIED_CODING_FREE_MODEL,
    pricing: { prompt: '0', completion: '0.0000' },
    supported_parameters: ['tools', 'tool_choice'],
  }],
};
const target = `export const ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14 = '2026-09-15T00:00:00.000Z' as const;
export const ORIGIN_CODING_FREE_FAILOVER_REVIEW_AFTER_V14 = '2026-09-22T00:00:00.000Z' as const;
`;

describe('verify-coding-free-model', () => {
  it('requires the exact fixed model, zero prices, and tool calling', () => {
    expect(verifyCodingFreeModelPayload(zeroCostPayload)).toEqual(zeroCostPayload.data[0]);
    expect(() => verifyCodingFreeModelPayload({ data: [{ ...zeroCostPayload.data[0], pricing: { prompt: '0.01', completion: '0' } }] })).toThrow('$0.00');
    expect(() => verifyCodingFreeModelPayload({ data: [{ ...zeroCostPayload.data[0], supported_parameters: [] }] })).toThrow('tool calling');
    expect(() => verifyCodingFreeModelPayload({ data: [] })).toThrow('exactly one');
  });

  it('updates only the unambiguous Coding evidence timestamps', () => {
    const next = updatedCodingFreeModelEvidence(target, '2026-09-22T12:00:00.000Z', '2026-10-02T11:59:59.999Z');
    expect(next).toContain("ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14 = '2026-09-22T12:00:00.000Z'");
    expect(next).toContain("ORIGIN_CODING_FREE_FAILOVER_REVIEW_AFTER_V14 = '2026-10-02T11:59:59.999Z'");
    expect(() => updatedCodingFreeModelEvidence(`${target}\n${target}`, 'x', 'y')).toThrow('ambiguous');
  });

  it('refreshes atomically after one successful official catalog verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-coding-free-model-'));
    const targetPath = join(directory, 'codingFreeModelFailoverV14.ts');
    await writeFile(targetPath, target);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 }));
    const result = await verifyAndRefreshCodingFreeModel({
      fetchImpl: fetchImpl as typeof fetch,
      targetPath,
      now: new Date('2026-09-22T12:00:00.000Z'),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.modelId).toBe(ORIGIN_VERIFIED_CODING_FREE_MODEL);
    expect(result.pricing).toEqual({ prompt: '0', completion: '0' });
    expect(result.toolCalling).toBe(true);
    expect(result.sourceUrl).toBe(OPENROUTER_MODELS_API);
    expect(result.reviewAfter).toBe('2026-10-02T11:59:59.999Z');
    expect(await readFile(targetPath, 'utf8')).toContain(result.reviewAfter);
  });

  it('does not retry an unavailable catalog endpoint and leaves evidence untouched', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-coding-free-model-fail-'));
    const targetPath = join(directory, 'codingFreeModelFailoverV14.ts');
    await writeFile(targetPath, target);
    const fetchImpl = vi.fn(async () => new Response('unavailable', { status: 503 }));
    await expect(verifyAndRefreshCodingFreeModel({ fetchImpl: fetchImpl as typeof fetch, targetPath })).rejects.toThrow('HTTP 503');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await readFile(targetPath, 'utf8')).toBe(target);
  });

  it('writes machine-readable evidence without exposing the repository path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-coding-free-model-report-'));
    const targetPath = join(directory, 'codingFreeModelFailoverV14.ts');
    const reportPath = join(directory, 'evidence.json');
    await writeFile(targetPath, target);
    const verification = await verifyAndRefreshCodingFreeModel({
      fetchImpl: (async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 })) as typeof fetch,
      targetPath,
      now: new Date('2026-09-22T12:00:00.000Z'),
    });
    await writeCodingFreeModelVerificationReport(verification, reportPath);
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    expect(report).not.toHaveProperty('targetPath');
    expect(report).toMatchObject({
      modelId: ORIGIN_VERIFIED_CODING_FREE_MODEL,
      pricing: { prompt: '0', completion: '0' },
      toolCalling: true,
      updated: true,
    });
  });
});
