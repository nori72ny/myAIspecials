import { describe, expect, it, vi } from 'vitest';
import { qualifyRasterLiveV15 } from './rasterLiveQualificationV15';

const ENV: NodeJS.ProcessEnv = {
  ORIGIN_RASTER_LIVE_QUALIFICATION: 'true',
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: `test-${'x'.repeat(40)}`,
};

function envelope(result: unknown, status = 200) {
  return new Response(JSON.stringify({
    success: status >= 200 && status < 300,
    result,
    errors: [],
    messages: [],
  }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function readyProof(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock
    .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
    .mockResolvedValueOnce(envelope([]))
    .mockResolvedValueOnce(envelope({ input: {}, output: {} }));
}

describe('rasterLiveQualificationV15', () => {
  it('does not make network requests without an explicit live opt-in', async () => {
    const fetchMock = vi.fn();
    const result = await qualifyRasterLiveV15({
      env: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
      generatedAt: '2026-09-30T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      state: 'blocked',
      reason: 'EXPLICIT_LIVE_QUALIFICATION_OPT_IN_REQUIRED',
      generation: null,
      edit: null,
      invariants: {
        costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified',
        freeOnly: true,
        paidFallbackEnabled: false,
        credentialsIncludedInEvidence: false,
        rawImageBytesIncludedInEvidence: false,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed before inference when server-only Cloudflare credentials are absent', async () => {
    const fetchMock = vi.fn();
    const result = await qualifyRasterLiveV15({
      env: { ORIGIN_RASTER_LIVE_QUALIFICATION: 'true' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      generatedAt: '2026-09-30T00:00:00.000Z',
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toBe('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks before inference when request-level zero-cost evidence is unavailable', async () => {
    const fetchMock = vi.fn();
    readyProof(fetchMock); // account-level Free-allocation preflight only

    const result = await qualifyRasterLiveV15({
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
      generatedAt: '2026-09-30T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      state: 'blocked',
      reason: 'CLOUDFLARE_PER_REQUEST_COST_EVIDENCE_UNAVAILABLE',
      provider: {
        id: 'cloudflare-workers-ai-free',
        ready: true,
        zeroCostVerified: false,
        freeAllocationEligible: true,
        paymentMethodRequired: false,
        paidFallbackEnabled: false,
        secretDelivery: 'server-only',
      },
      generation: null,
      edit: null,
      invariants: {
        costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified',
        freeOnly: true,
        paidFallbackEnabled: false,
        credentialsIncludedInEvidence: false,
        rawImageBytesIncludedInEvidence: false,
      },
    });
    // Only the three read-only account/plan/model preflight calls are allowed.
    // No image inference or semantic-critic quota is consumed.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain(ENV.CLOUDFLARE_API_TOKEN);
    expect(JSON.stringify(result)).not.toContain(ENV.CLOUDFLARE_ACCOUNT_ID);
  });
});
