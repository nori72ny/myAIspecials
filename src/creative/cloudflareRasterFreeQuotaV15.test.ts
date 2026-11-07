import { describe, expect, it, vi } from 'vitest';
import {
  assertCloudflareRasterPricingEvidenceCurrentV15,
  decideCloudflareUsageReconciliationV15,
  estimateCloudflareRasterGenerationNeuronsV15,
  fetchCloudflareDailyNeuronsUsedV15,
  reconcileCloudflareRasterUsageV15,
  type CloudflareUsageReconciliationV15,
} from './cloudflareRasterFreeQuotaV15';

const AUTH = { accountId: '0123456789abcdef0123456789abcdef', apiToken: `test-${'x'.repeat(40)}` };
const NOW_IN_WINDOW = Date.parse('2026-11-06T12:00:00.000Z');

function graphqlBody(groups: unknown, extra: Record<string, unknown> = {}) {
  return {
    data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: groups }] } },
    ...extra,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cloudflareRasterFreeQuotaV15 pricing evidence', () => {
  it('accepts timestamps inside the verified window', () => {
    expect(() => assertCloudflareRasterPricingEvidenceCurrentV15(NOW_IN_WINDOW)).not.toThrow();
  });

  it('fails closed when the pricing evidence is stale', () => {
    expect(() => assertCloudflareRasterPricingEvidenceCurrentV15(Date.parse('2026-11-17T00:00:00.000Z')))
      .toThrow('RASTER_PRICING_EVIDENCE_STALE');
    expect(() => assertCloudflareRasterPricingEvidenceCurrentV15(Date.parse('2026-11-05T00:00:00.000Z')))
      .toThrow('RASTER_PRICING_EVIDENCE_STALE');
  });
});

describe('cloudflareRasterFreeQuotaV15 estimate', () => {
  it('over-estimates a 1024x1024 generation above the published ~110 Neurons', () => {
    // 4 output tiles x (5.37 input + 26.05 output) = 125.68 -> 126.
    expect(estimateCloudflareRasterGenerationNeuronsV15({ width: 1024, height: 1024 })).toBe(126);
  });

  it('charges one tile for a 512x512 image and scales by tiles', () => {
    expect(estimateCloudflareRasterGenerationNeuronsV15({ width: 512, height: 512 })).toBe(32);
    expect(estimateCloudflareRasterGenerationNeuronsV15({ width: 768, height: 1024 })).toBe(126);
    expect(estimateCloudflareRasterGenerationNeuronsV15({ width: 256, height: 256 })).toBe(32);
  });

  it('adds reference-image tiles for edits', () => {
    expect(estimateCloudflareRasterGenerationNeuronsV15({
      width: 1024,
      height: 1024,
      referenceImages: [{ width: 320, height: 240 }],
    })).toBe(158); // (4 + 1) tiles x 31.42 = 157.1 -> 158
  });

  it('prices the 9B model with the flat first-megapixel charge', () => {
    const model = '@cf/black-forest-labs/flux-2-klein-9b' as const;
    // 1024x1024 = 1.048576 MP: 1363.64 + 0.048576 x 181.82 = 1372.47 -> 1373.
    expect(estimateCloudflareRasterGenerationNeuronsV15({ width: 1024, height: 1024, model })).toBe(1373);
    // The first megapixel is flat: a small image costs the same first-MP charge.
    expect(estimateCloudflareRasterGenerationNeuronsV15({ width: 512, height: 512, model })).toBe(1364);
    // Reference images add per-megapixel input charges: +0.25 MP x 181.82 = 45.46.
    expect(estimateCloudflareRasterGenerationNeuronsV15({
      width: 512, height: 512, model, referenceImages: [{ width: 500, height: 500 }],
    })).toBe(1410);
  });
});

describe('cloudflareRasterFreeQuotaV15 daily usage reader', () => {
  it('sums neuron usage across adaptive groups for today (UTC)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(graphqlBody([
      { count: 3, sum: { totalNeurons: 120.5 } },
      { count: 1, sum: { totalNeurons: 30 } },
    ]))) as unknown as typeof fetch;

    await expect(fetchCloudflareDailyNeuronsUsedV15(AUTH, fetchMock, NOW_IN_WINDOW))
      .resolves.toEqual({ date: '2026-11-06', usedNeurons: 150.5, requests: 4 });
  });

  it('treats an empty group list as zero measured usage', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(graphqlBody([]))) as unknown as typeof fetch;
    await expect(fetchCloudflareDailyNeuronsUsedV15(AUTH, fetchMock, NOW_IN_WINDOW))
      .resolves.toEqual({ date: '2026-11-06', usedNeurons: 0, requests: 0 });
  });

  it('queries the live-verified aiInferenceAdaptiveGroups dataset and aggregates the real response shape', async () => {
    // Regression for the production 503 CLOUDFLARE_DAILY_USAGE_UNVERIFIED:
    // the reader previously queried `workersAiRequestsAdaptiveGroups` with
    // `sum { neurons requestCount }`, none of which exist in the live schema
    // (confirmed by GraphQL introspection on 2026-11-07). The real shape is
    // groups of { count, sum { totalNeurons } } under aiInferenceAdaptiveGroups.
    let sentBody: { query?: string; variables?: Record<string, unknown> } = {};
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body ?? '{}')) as typeof sentBody;
      return jsonResponse(graphqlBody([
        { count: 2, sum: { totalNeurons: 220.25 } },
        { count: 5, sum: { totalNeurons: 40 } },
      ]));
    }) as unknown as typeof fetch;

    await expect(fetchCloudflareDailyNeuronsUsedV15(AUTH, fetchMock, NOW_IN_WINDOW))
      .resolves.toEqual({ date: '2026-11-06', usedNeurons: 260.25, requests: 7 });
    expect(sentBody.query).toContain('aiInferenceAdaptiveGroups');
    expect(sentBody.query).toContain('date_geq: $date');
    expect(sentBody.query).toContain('date_leq: $date');
    expect(sentBody.query).not.toContain('workersAiRequestsAdaptiveGroups');
    expect(sentBody.variables).toEqual({ accountTag: AUTH.accountId, date: '2026-11-06' });
  });

  it.each([
    ['graphql errors', graphqlBody([], { errors: [{ message: 'bad field' }] })],
    ['missing accounts', { data: { viewer: { accounts: [] } } }],
    ['missing groups', { data: { viewer: { accounts: [{}] } } }],
    ['legacy field name only', {
      data: {
        viewer: {
          accounts: [{
            workersAiRequestsAdaptiveGroups: [{ sum: { totalNeurons: 10, requestCount: 1 } }],
          }],
        },
      },
    }],
    ['non-numeric neurons', graphqlBody([{ sum: { totalNeurons: 'many' } }])],
    ['negative neurons', graphqlBody([{ sum: { totalNeurons: -1 } }])],
    ['conflicting neuron fields', graphqlBody([{ sum: { totalNeurons: 10, neurons: 11 } }])],
  ])('fails closed on %s', async (_label, body) => {
    const fetchMock = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
    await expect(fetchCloudflareDailyNeuronsUsedV15(AUTH, fetchMock, NOW_IN_WINDOW))
      .rejects.toThrow('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  });

  it('fails closed on HTTP errors and transport failures', async () => {
    const httpFailure = vi.fn(async () => jsonResponse({}, 403)) as unknown as typeof fetch;
    await expect(fetchCloudflareDailyNeuronsUsedV15(AUTH, httpFailure, NOW_IN_WINDOW))
      .rejects.toThrow('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');

    const transportFailure = vi.fn(async () => { throw new Error('socket reset'); }) as unknown as typeof fetch;
    await expect(fetchCloudflareDailyNeuronsUsedV15(AUTH, transportFailure, NOW_IN_WINDOW))
      .rejects.toThrow('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  });
});

describe('cloudflareRasterFreeQuotaV15 reconciliation', () => {
  function usageFetch(values: number[]) {
    let index = 0;
    return vi.fn(async () => {
      const used = values[Math.min(index, values.length - 1)];
      index += 1;
      return jsonResponse(graphqlBody([{ count: 1, sum: { totalNeurons: used } }]));
    }) as unknown as typeof fetch;
  }

  it('reconciles when the measured delta is positive and within the reserve', async () => {
    const fetchMock = usageFetch([240]);
    await expect(reconcileCloudflareRasterUsageV15(AUTH, 100, 382, fetchMock, { attempts: 3, delayMs: 0 }))
      .resolves.toMatchObject({ reconciled: true, observedDeltaNeurons: 140, finalUsedNeurons: 240, requests: 1 });
  });

  it('keeps polling through analytics lag until the delta appears', async () => {
    const fetchMock = usageFetch([100, 100, 260]);
    await expect(reconcileCloudflareRasterUsageV15(AUTH, 100, 382, fetchMock, { attempts: 4, delayMs: 0 }))
      .resolves.toMatchObject({ reconciled: true, observedDeltaNeurons: 160, requests: 3 });
  });

  it('does not reconcile when usage never moves', async () => {
    const fetchMock = usageFetch([100]);
    await expect(reconcileCloudflareRasterUsageV15(AUTH, 100, 382, fetchMock, { attempts: 2, delayMs: 0 }))
      .resolves.toMatchObject({ reconciled: false, observedDeltaNeurons: 0, requests: 2 });
  });

  it('fails immediately when the delta exceeds the reserved bound', async () => {
    const fetchMock = usageFetch([5_100]);
    await expect(reconcileCloudflareRasterUsageV15(AUTH, 100, 382, fetchMock, { attempts: 5, delayMs: 0 }))
      .resolves.toMatchObject({ reconciled: false, observedDeltaNeurons: 5_000, requests: 1 });
  });

  it('survives transport failures during polling without throwing', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(reconcileCloudflareRasterUsageV15(AUTH, 100, 382, fetchMock, { attempts: 2, delayMs: 0 }))
      .resolves.toMatchObject({ reconciled: false, observedDeltaNeurons: null, requests: 2 });
  });
});

describe('cloudflareRasterFreeQuotaV15 reconciliation decision', () => {
  const RESERVE = 576;
  const reconciled = (delta: number): CloudflareUsageReconciliationV15 => ({
    reconciled: true, observedDeltaNeurons: delta, finalUsedNeurons: 100 + delta, requests: 1,
  });
  const unreconciled = (delta: number | null): CloudflareUsageReconciliationV15 => ({
    reconciled: false,
    observedDeltaNeurons: delta,
    finalUsedNeurons: delta === null ? null : 100 + delta,
    requests: 2,
  });

  it('delivers on the aggregate path when the measured delta reconciled', () => {
    expect(decideCloudflareUsageReconciliationV15(reconciled(140), RESERVE, [140, 35]))
      .toMatchObject({ deliver: true, method: 'aggregate-delta', totalReportedNeurons: 175, reason: 'aggregate-reconciled' });
  });

  it('keeps the aggregate decision even when per-request reports are absent', () => {
    expect(decideCloudflareUsageReconciliationV15(reconciled(140), RESERVE, [null, null]))
      .toMatchObject({ deliver: true, method: 'aggregate-delta', totalReportedNeurons: null });
  });

  it('falls back to per-request reports when the aggregate delta has not appeared yet', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(0), RESERVE, [126.5, 34.34]))
      .toMatchObject({ deliver: true, method: 'per-request-reported', totalReportedNeurons: 160.84, reason: 'per-request-reported-within-reserve' });
  });

  it('never falls back when the aggregate delta exceeds the reserve', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(5_000), RESERVE, [140, 35]))
      .toMatchObject({ deliver: false, method: null, reason: 'aggregate-over-reserve' });
  });

  it('never falls back when the aggregate moved backwards', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(-100), RESERVE, [140, 35]))
      .toMatchObject({ deliver: false, method: null, reason: 'aggregate-moved-backwards' });
  });

  it('never falls back when no aggregate read succeeded', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(null), RESERVE, [140, 35]))
      .toMatchObject({ deliver: false, method: null, reason: 'aggregate-unobserved' });
  });

  it('fails closed when any call of the request did not report usage', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(0), RESERVE, [140, null]))
      .toMatchObject({ deliver: false, method: null, totalReportedNeurons: null, reason: 'per-request-usage-incomplete' });
    expect(decideCloudflareUsageReconciliationV15(unreconciled(0), RESERVE, []))
      .toMatchObject({ deliver: false, method: null, reason: 'per-request-usage-incomplete' });
  });

  it('fails closed when the reported total exceeds the reserve', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(0), RESERVE, [400, 300]))
      .toMatchObject({ deliver: false, method: null, totalReportedNeurons: 700, reason: 'per-request-usage-over-reserve' });
  });

  it('fails closed when the reported total is implausibly zero', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(0), RESERVE, [0, 0]))
      .toMatchObject({ deliver: false, method: null, reason: 'per-request-usage-implausible' });
  });

  it('fails closed on a positive unreconciled delta instead of guessing attribution', () => {
    expect(decideCloudflareUsageReconciliationV15(unreconciled(50), RESERVE, [140, 35]))
      .toMatchObject({ deliver: false, method: null, reason: 'aggregate-inconsistent' });
  });
});
