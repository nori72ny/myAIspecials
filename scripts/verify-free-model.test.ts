import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ORIGIN_VERIFIED_FREE_MODEL, updatedFreeModelCatalog, verifyAndRefreshFreeModel, verifyFreeModelPayload } from './verify-free-model';

const zeroCostPayload = { data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0', completion: '0.0000' } }] };
const catalog = `modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,\nverifiedAt: "2026-08-14T00:00:00.000Z",\nreviewAfter: "2026-08-24T23:59:59.999Z",\nsourceDescription: "This evidence expires on 2026-08-24T23:59:59.999Z. Runtime guard remains active.",\n`;

describe('verify-free-model', () => {
  it('accepts only the exact fixed model with zero prompt and completion pricing', () => {
    expect(verifyFreeModelPayload(zeroCostPayload)).toEqual(zeroCostPayload.data[0]);
    expect(() => verifyFreeModelPayload({ data: [{ id: ORIGIN_VERIFIED_FREE_MODEL, pricing: { prompt: '0.000001', completion: '0' } }] })).toThrow('$0.00');
    expect(() => verifyFreeModelPayload({ data: [{ id: 'google/gemma-4-26b-a4b-it', pricing: { prompt: '0', completion: '0' } }] })).toThrow('exactly one');
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
});
