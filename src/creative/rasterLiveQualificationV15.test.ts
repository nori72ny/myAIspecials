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

function png(width: number, height: number, marker: number) {
  const bytes = Buffer.alloc(96, 0);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes,0);
  Buffer.from('IHDR','ascii').copy(bytes,12);
  bytes.writeUInt32BE(width,16);
  bytes.writeUInt32BE(height,20);
  bytes[95] = marker;
  return bytes;
}

function semanticAnswer(summary: string) {
  return JSON.stringify({
    promptAdherence: 3.8,
    composition: 3.7,
    subjectIntegrity: 3.8,
    styleExecution: 3.5,
    textHandling: 3.8,
    artifactControl: 3.8,
    professionalUsefulness: 3.7,
    safetyPassed: true,
    safetyIssues: [],
    criticalIssues: [],
    summary,
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
        costUsd: 0,
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

  it('qualifies real generation and reference editing only after repeated Free checks and both semantic gates pass', async () => {
    const generated = png(384, 384, 1);
    const edited = png(384, 384, 2);
    const fetchMock = vi.fn();

    readyProof(fetchMock); // initial status

    readyProof(fetchMock); // generation phase provider proof
    fetchMock.mockResolvedValueOnce(envelope(generated.toString('base64')));
    readyProof(fetchMock); // generation semantic proof
    fetchMock.mockResolvedValueOnce(envelope({ answer: semanticAnswer('Generation is coherent and commercially usable.') }));

    readyProof(fetchMock); // edit phase provider proof
    fetchMock.mockResolvedValueOnce(envelope(edited.toString('base64')));
    readyProof(fetchMock); // edit semantic proof
    fetchMock.mockResolvedValueOnce(envelope({ answer: semanticAnswer('Edit preserves the product while changing the requested backdrop.') }));

    let tick = 1000;
    const result = await qualifyRasterLiveV15({
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => tick += 50,
      generatedAt: '2026-09-30T00:00:00.000Z',
    });

    expect(result.state).toBe('passed');
    expect(result.reason).toBeNull();
    expect(result.provider).toMatchObject({
      id: 'cloudflare-workers-ai-free',
      ready: true,
      zeroCostVerified: true,
      paymentMethodRequired: false,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });
    expect(result.generation).toMatchObject({
      width: 384,
      height: 384,
      providerId: 'cloudflare-workers-ai-free',
      structural: { passed: true, score: 100 },
      semantic: { passed: true, costUsd: 0, freeOnly: true },
    });
    expect(result.edit).toMatchObject({
      width: 384,
      height: 384,
      providerId: 'cloudflare-workers-ai-free',
      structural: { passed: true, score: 100 },
      semantic: { passed: true, costUsd: 0, freeOnly: true },
    });
    expect(result.edit?.sha256).not.toBe(result.generation?.sha256);
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(ENV.CLOUDFLARE_API_TOKEN);
    expect(JSON.stringify(result)).not.toContain(ENV.CLOUDFLARE_ACCOUNT_ID);
    expect(JSON.stringify(result)).not.toContain(generated.toString('base64'));
    expect(fetchMock).toHaveBeenCalledTimes(19);
  });
});

const GATEWAY_ENV = {
  ...ENV,
  ORIGIN_RASTER_GATEWAY_URL: 'https://raster.example.workers.dev',
  ORIGIN_RASTER_GATEWAY_SECRET: 'g'.repeat(48),
  ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'true',
};
function gatewayProof() {
  return new Response(JSON.stringify({
    ok: true, provider: 'cloudflare-workers-ai-binding',
    model: '@cf/black-forest-labs/flux-2-klein-4b',
    aiBindingConfigured: true, secretConfigured: true,
    zeroCostVerified: true, freeOnly: true, paidFallbackEnabled: false,
  }), { headers: { 'content-type': 'application/json' } });
}
describe('gateway live qualification routing', () => {
  it('keeps an unverified gateway blocked without testing a different provider', async () => {
    const fetchMock = vi.fn();
    const result = await qualifyRasterLiveV15({
      env: { ...GATEWAY_ENV, ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'false' },
      fetchImpl: fetchMock,
    });
    expect(result.state).toBe('blocked');
    expect(result.provider.id).toBe('cloudflare-workers-ai-gateway');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('qualifies gateway generation and reference editing with both semantic checks', async () => {
    const generated = png(384, 384, 1);
    const edited = png(384, 384, 2);
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(gatewayProof());
    fetchMock.mockResolvedValueOnce(gatewayProof());
    fetchMock.mockResolvedValueOnce(new Response(generated));
    readyProof(fetchMock);
    fetchMock.mockResolvedValueOnce(envelope({ answer: semanticAnswer('Valid generation.') }));
    fetchMock.mockResolvedValueOnce(gatewayProof());
    fetchMock.mockResolvedValueOnce(new Response(edited));
    readyProof(fetchMock);
    fetchMock.mockResolvedValueOnce(envelope({ answer: semanticAnswer('Valid reference edit.') }));
    const result = await qualifyRasterLiveV15({ env: GATEWAY_ENV, fetchImpl: fetchMock });
    expect(result.state).toBe('passed');
    expect(result.provider.id).toBe('cloudflare-workers-ai-gateway');
    expect(result.generation?.providerId).toBe(result.provider.id);
    expect(result.edit?.providerId).toBe(result.provider.id);
    const gatewayCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(GATEWAY_ENV.ORIGIN_RASTER_GATEWAY_URL));
    expect(gatewayCalls.map(([url]) => String(url).split('/').pop())).toEqual(['status', 'status', 'generate', 'status', 'edit']);
    const editBody = gatewayCalls.at(-1)?.[1]?.body as FormData;
    expect(editBody.get('input_image_0')).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(GATEWAY_ENV.ORIGIN_RASTER_GATEWAY_SECRET);
    expect(JSON.stringify(result)).not.toContain(generated.toString('base64'));
  });
});
