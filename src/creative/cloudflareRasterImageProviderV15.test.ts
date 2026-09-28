import { describe, expect, it, vi } from 'vitest';
import {
  generateCloudflareRasterImageV15,
  getCloudflareRasterStatusV15,
} from './cloudflareRasterImageProviderV15';

const ENV: NodeJS.ProcessEnv = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: 'cf_test_token_abcdefghijklmnopqrstuvwxyz',
};

function json(result: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result, errors: [], messages: [] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function png(width: number, height: number) {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes,0);
  Buffer.from('IHDR','ascii').copy(bytes,12);
  bytes.writeUInt32BE(width,16);
  bytes.writeUInt32BE(height,20);
  return bytes;
}

describe('cloudflareRasterImageProviderV15', () => {
  it('fails closed without server-only Cloudflare credentials', async () => {
    await expect(getCloudflareRasterStatusV15({})).resolves.toMatchObject({
      configured: false,
      ready: false,
      zeroCostVerified: false,
      providerId: 'cloudflare-workers-ai-free',
      reason: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
    });
  });

  it('accepts only a non-paid Workers account state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([])) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      configured: true,
      ready: true,
      model: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      zeroCostVerified: true,
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['standard','unbound'])('rejects paid-capable Workers usage model %s before generation', async (usageModel) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ default_usage_model: usageModel })) as unknown as typeof fetch;
    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      zeroCostVerified: false,
      reason: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an active paid Workers subscription even when the usage-model field is ambiguous', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json([{
        state: 'Paid',
        rate_plan: { id: 'workers_paid', public_name: 'Workers Paid' },
      }])) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      reason: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED',
    });
  });

  it('requires Billing Read evidence rather than assuming Free when subscription proof is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json({}, 403)) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      reason: 'CLOUDFLARE_BILLING_READ_REQUIRED',
    });
  });

  it('generates only after re-verifying the free-plan boundary immediately before inference', async () => {
    const bytes = png(768,1024);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json(bytes.toString('base64')));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateCloudflareRasterImageV15({
      prompt: '静かな湖と朝焼け',
      negativePrompt: 'text, watermark',
      width: 768,
      height: 1024,
    }, ENV, fetchImpl);

    expect(result).toMatchObject({
      providerId: 'cloudflare-workers-ai-free',
      model: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      mimeType: 'image/png',
      width: 768,
      height: 1024,
      costUsd: 0,
      freeOnly: true,
      externalNetworkRequests: 3,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const request = fetchMock.mock.calls[2];
    expect(String(request?.[0])).toContain('/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0');
    expect(new Headers((request?.[1] as RequestInit).headers).get('authorization')).toBe('Bearer cf_test_token_abcdefghijklmnopqrstuvwxyz');
    expect(JSON.parse(String((request?.[1] as RequestInit).body))).toMatchObject({
      prompt: '静かな湖と朝焼け',
      negative_prompt: 'text, watermark',
      width: 768,
      height: 1024,
      num_steps: 20,
    });
  });

  it('treats free-allocation exhaustion or paid-only access as fail-closed', async () => {
    for (const status of [402,403,429]) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(json([]))
        .mockResolvedValueOnce(json({}, status)) as unknown as typeof fetch;

      await expect(generateCloudflareRasterImageV15({ prompt: 'test' }, ENV, fetchMock))
        .rejects.toThrow('CLOUDFLARE_FREE_ALLOCATION_UNAVAILABLE');
    }
  });
});
