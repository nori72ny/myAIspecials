import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  OPENROUTER_MODELS_API,
  ORIGIN_VERIFIED_CODING_FREE_MODEL,
  ORIGIN_VERIFIED_FREE_MODEL,
  updatedFreeModelCatalog,
  verifyAndRefreshFreeModel,
  verifyFreeModelPayload,
  writeFreeModelVerificationReport,
} from './verify-free-model';

const zeroCostPayload = { data: [
  { id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0', completion: '0.0000' } },
  { id: ORIGIN_VERIFIED_CODING_FREE_MODEL, pricing: { prompt: 0, completion: '0' } },
] };
const catalog = `export const ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL = "${ORIGIN_VERIFIED_FREE_MODEL}" as const;\nexport const ORIGIN_CODING_OPENROUTER_FREE_MODEL = "${ORIGIN_VERIFIED_CODING_FREE_MODEL}" as const;\nexport const entries = [\n  {\n    modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,\n    verifiedAt: "2026-08-14T00:00:00.000Z",\n    reviewAfter: "2026-08-24T23:59:59.999Z",\n  },\n  {\n    modelId: ORIGIN_CODING_OPENROUTER_FREE_MODEL,\n    verifiedAt: "2026-08-14T00:00:00.000Z",\n    reviewAfter: "2026-08-24T23:59:59.999Z",\n  },\n];\n`;

describe('verify-free-model', () => {
  it('accepts each exact fixed model only with zero prompt and completion pricing', () => {
    expect(verifyFreeModelPayload(zeroCostPayload)).toEqual(zeroCostPayload.data[0]);
    expect(verifyFreeModelPayload(zeroCostPayload, ORIGIN_VERIFIED_CODING_FREE_MODEL)).toEqual(zeroCostPayload.data[1]);
    expect(() => verifyFreeModelPayload({ data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0.000001', completion: '0' } }] })).toThrow('$0.00');
    expect(() => verifyFreeModelPayload({ data: [{ id: 'google/gemma-4-31b-it', pricing: { prompt: '0', completion: '0' } }] })).toThrow('exactly one');
  });

  it('updates the two exact catalog entries together and rejects ambiguous markers', () => {
    const next = updatedFreeModelCatalog(catalog, '2026-08-22T12:00:00.000Z', '2026-09-01T11:59:59.999Z');
    expect(next.match(/verifiedAt: "2026-08-22T12:00:00.000Z"/g)).toHaveLength(2);
    expect(next.match(/reviewAfter: "2026-09-01T11:59:59.999Z"/g)).toHaveLength(2);
    expect(() => updatedFreeModelCatalog(`${catalog}\n${catalog}`, '2026-08-22T12:00:00.000Z', '2026-09-01T11:59:59.999Z')).toThrow('ambiguous');
  });

  it('refreshes both entries atomically and leaves the catalog untouched if either model is paid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-'));
    const catalogPath = join(directory, 'catalog.ts');
    await writeFile(catalogPath, catalog);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 }));
    const result = await verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath, now: new Date('2026-08-22T12:00:00.000Z') });
    expect(result.updated).toBe(true);
    expect(result.models).toEqual([
      { modelId: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0', completion: '0' } },
      { modelId: ORIGIN_VERIFIED_CODING_FREE_MODEL, pricing: { prompt: '0', completion: '0' } },
    ]);
    expect(result.sourceUrl).toBe(OPENROUTER_MODELS_API);
    expect(result.reviewAfter).toBe('2026-09-01T11:59:59.999Z');
    expect((await readFile(catalogPath, 'utf8')).match(/2026-09-01T11:59:59.999Z/g)).toHaveLength(2);

    const saved = await readFile(catalogPath, 'utf8');
    const paidPayload = { data: [
      zeroCostPayload.data[0],
      { id: ORIGIN_VERIFIED_CODING_FREE_MODEL, pricing: { prompt: '0', completion: '0.01' } },
    ] };
    const paidFetch = vi.fn(async () => new Response(JSON.stringify(paidPayload), { status: 200 }));
    await expect(verifyAndRefreshFreeModel({ fetchImpl: paidFetch as typeof fetch, catalogPath, now: new Date('2026-08-23T12:00:00.000Z') })).rejects.toThrow('$0.00');
    expect(await readFile(catalogPath, 'utf8')).toBe(saved);
  });

  it('verifies both models but avoids timestamp churn while both evidence windows have more than three days remaining', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-current-'));
    const catalogPath = join(directory, 'catalog.ts');
    const current = catalog.replaceAll('2026-08-24T23:59:59.999Z', '2026-09-10T23:59:59.999Z');
    await writeFile(catalogPath, current);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 }));
    const result = await verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath, now: new Date('2026-08-22T12:00:00.000Z') });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.updated).toBe(false);
    expect(result.reviewAfter).toBe('2026-09-10T23:59:59.999Z');
    expect(await readFile(catalogPath, 'utf8')).toBe(current);
  });

  it('retries one temporary OpenRouter catalog error before proving both zero prices', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-retry-'));
    const catalogPath = join(directory, 'catalog.ts');
    await writeFile(catalogPath, catalog);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(zeroCostPayload), { status: 200 }));

    const result = await verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath, now: new Date('2026-08-23T12:00:00.000Z') });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.models).toHaveLength(2);
    expect(result.reviewAfter).toBe('2026-09-02T11:59:59.999Z');
  });

  it('writes auditable evidence for both models without leaking the local catalog path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-report-'));
    const catalogPath = join(directory, 'catalog.ts');
    const reportPath = join(directory, 'evidence.json');
    await writeFile(catalogPath, catalog);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 }));
    const verification = await verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath, now: new Date('2026-08-23T12:00:00.000Z') });

    await writeFreeModelVerificationReport(verification, reportPath);
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    expect(report).toEqual({
      models: [
        { modelId: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0', completion: '0' } },
        { modelId: ORIGIN_VERIFIED_CODING_FREE_MODEL, pricing: { prompt: '0', completion: '0' } },
      ],
      sourceUrl: OPENROUTER_MODELS_API,
      verifiedAt: '2026-08-23T12:00:00.000Z',
      reviewAfter: '2026-09-02T11:59:59.999Z',
      updated: true,
    });
    expect(report).not.toHaveProperty('catalogPath');
  });

  it('runs zero-price verification four times daily and preserves auditable evidence', async () => {
    const workflow = await readFile(join(process.cwd(), '.github/workflows/verify-free-model.yml'), 'utf8');
    expect(workflow).toContain("cron: '17 0,6,12,18 * * *'");
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('ORIGIN_FREE_MODEL_EVIDENCE_PATH:');
    expect(workflow).toContain(ORIGIN_VERIFIED_FREE_MODEL);
    expect(workflow).toContain(ORIGIN_VERIFIED_CODING_FREE_MODEL);
    expect(workflow).toContain("model.pricing.prompt !== '0'");
    expect(workflow).toContain("model.pricing.completion !== '0'");
    expect(workflow).toContain('retention-days: 30');
    expect(workflow).toContain('if-no-files-found: error');
  });
});
