import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OPENROUTER_MODELS_API, ORIGIN_VERIFIED_FREE_MODEL, updatedFreeModelCatalog, verifyAndRefreshFreeModel, verifyFreeModelPayload, writeFreeModelVerificationReport } from './verify-free-model';

const zeroCostPayload = { data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0', completion: '0.0000' } }] };
const catalog = `modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,\nverifiedAt: "2026-08-14T00:00:00.000Z",\nreviewAfter: "2026-08-24T23:59:59.999Z",\nsourceDescription: "This evidence expires on 2026-08-24T23:59:59.999Z. Runtime guard remains active.",\n`;

describe('verify-free-model', () => {
  it('accepts only the exact fixed model with zero prompt and completion pricing', () => {
    expect(verifyFreeModelPayload(zeroCostPayload)).toEqual(zeroCostPayload.data[0]);
    expect(() => verifyFreeModelPayload({ data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0.000001', completion: '0' } }] })).toThrow('$0.00');
    expect(() => verifyFreeModelPayload({ data: [{ id: 'google/gemma-4-31b-it', pricing: { prompt: '0', completion: '0' } }] })).toThrow('exactly one');
    expect(() => verifyFreeModelPayload({ data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '', completion: '0' } }] })).toThrow('$0.00');
  });

  it('updates only the unambiguous evidence timestamps', () => {
    const next = updatedFreeModelCatalog(catalog, '2026-08-22T12:00:00.000Z', '2026-09-01T11:59:59.999Z');
    expect(next).toContain('verifiedAt: "2026-08-22T12:00:00.000Z"');
    expect(next).toContain('reviewAfter: "2026-09-01T11:59:59.999Z"');
    expect(next).toContain('This evidence expires on 2026-09-01T11:59:59.999Z. Runtime');
    expect(next).not.toContain('.999Z.999Z');
    expect(() => updatedFreeModelCatalog(`${catalog}\n${catalog}`, '2026-08-22T12:00:00.000Z', '2026-09-01T11:59:59.999Z')).toThrow('ambiguous');
  });

  it('refreshes atomically after successful API verification and leaves the catalog untouched on paid pricing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-'));
    const catalogPath = join(directory, 'catalog.ts');
    await writeFile(catalogPath, catalog);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 }));
    const result = await verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath, now: new Date('2026-08-22T12:00:00.000Z') });
    expect(result.updated).toBe(true);
    expect(result.modelId).toBe(ORIGIN_VERIFIED_FREE_MODEL);
    expect(result.pricing).toEqual({ prompt: '0', completion: '0' });
    expect(result.sourceUrl).toBe(OPENROUTER_MODELS_API);
    expect(result.reviewAfter).toBe('2026-09-01T11:59:59.999Z');
    expect(await readFile(catalogPath, 'utf8')).toContain(result.reviewAfter);

    const saved = await readFile(catalogPath, 'utf8');
    const paidFetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0', completion: '0.01' } }] }), { status: 200 }));
    await expect(verifyAndRefreshFreeModel({ fetchImpl: paidFetch as typeof fetch, catalogPath, now: new Date('2026-08-23T12:00:00.000Z') })).rejects.toThrow('$0.00');
    expect(await readFile(catalogPath, 'utf8')).toBe(saved);
  });

  it('verifies the API but avoids timestamp churn while evidence has more than three days remaining', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-current-'));
    const catalogPath = join(directory, 'catalog.ts');
    const current = catalog.replace('2026-08-24T23:59:59.999Z', '2026-09-10T23:59:59.999Z');
    await writeFile(catalogPath, current);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 }));
    const result = await verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath, now: new Date('2026-08-22T12:00:00.000Z') });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.updated).toBe(false);
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
    expect(result.pricing).toEqual({ prompt: '0', completion: '0' });
    expect(result.reviewAfter).toBe('2026-09-02T11:59:59.999Z');
  });

  it('never retries or refreshes when a successful catalog response reports paid pricing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-paid-'));
    const catalogPath = join(directory, 'catalog.ts');
    await writeFile(catalogPath, catalog);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0.001', completion: '0' } }],
    }), { status: 200 }));

    await expect(verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath })).rejects.toThrow('$0.00');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await readFile(catalogPath, 'utf8')).toBe(catalog);
  });

  it('writes an auditable evidence artifact without leaking the local catalog path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-free-model-report-'));
    const catalogPath = join(directory, 'catalog.ts');
    const reportPath = join(directory, 'evidence.json');
    await writeFile(catalogPath, catalog);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(zeroCostPayload), { status: 200 }));
    const verification = await verifyAndRefreshFreeModel({ fetchImpl: fetchImpl as typeof fetch, catalogPath, now: new Date('2026-08-23T12:00:00.000Z') });

    await writeFreeModelVerificationReport(verification, reportPath);
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;

    expect(report).toEqual({
      modelId: ORIGIN_VERIFIED_FREE_MODEL,
      pricing: { prompt: '0', completion: '0' },
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
    expect(workflow).toContain("evidence.pricing.prompt !== '0'");
    expect(workflow).toContain("evidence.pricing.completion !== '0'");
    expect(workflow).toContain('retention-days: 30');
    expect(workflow).toContain('if-no-files-found: error');
  });
});
