import { describe, expect, it, vi } from 'vitest';

import {
  generateCloudflareRasterGatewayImageV15,
  getCloudflareRasterGatewayStatusV15,
} from './cloudflareRasterGatewayProviderV15';
import {
  rasterProviderRegistryV15,
  rasterProviderRuntimeStatusV15,
  resolveRasterProviderV15,
  selectRasterProviderV15,
} from './rasterProviderRegistryV15';

const FREE_PLAN_ENV: NodeJS.ProcessEnv = {
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

describe('rasterProviderRegistryV15', () => {
  it('exposes only free-only server-side providers with no paid fallback', () => {
    const providers = rasterProviderRegistryV15();
    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject({
      id: 'cloudflare-workers-ai-gateway',
      zeroCostRequired: true,
      paidFallback: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
    });
    expect(providers[1]).toMatchObject({
      id: 'cloudflare-workers-ai-free',
      zeroCostRequired: true,
      paidFallback: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
    });
    expect(providers[0]?.capabilities).toEqual([
      expect.objectContaining({
        task: 'text-to-image',
        referenceImages: false,
        identityPreservation: false,
      }),
      expect.objectContaining({
        task: 'edit',
        referenceImages: true,
        identityPreservation: false,
      }),
    ]);
  });

  it('preserves REST routing by default and selects the gateway only when fully configured', () => {
    expect(resolveRasterProviderV15('text-to-image', {})?.descriptor.id).toBe('cloudflare-workers-ai-free');
    expect(resolveRasterProviderV15('edit', {})?.descriptor.id).toBe('cloudflare-workers-ai-free');
    const gatewayEnv = {
      ...FREE_PLAN_ENV,
      ORIGIN_RASTER_GATEWAY_URL: 'https://origin-raster.example.workers.dev',
      ORIGIN_RASTER_GATEWAY_SECRET: 'x'.repeat(48),
      ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'true',
    };
    expect(resolveRasterProviderV15('text-to-image', gatewayEnv)?.descriptor.id).toBe('cloudflare-workers-ai-gateway');
    expect(resolveRasterProviderV15('edit', gatewayEnv)?.descriptor.id).toBe('cloudflare-workers-ai-gateway');
    expect(resolveRasterProviderV15('inpaint', gatewayEnv)).toBeNull();
  });


  it('rejects FLUX.2 reference inputs outside the documented binding limits before any network call', async () => {
    const env = {
      ...FREE_PLAN_ENV,
      ORIGIN_RASTER_GATEWAY_URL: 'https://origin-raster.example.workers.dev',
      ORIGIN_RASTER_GATEWAY_SECRET: 'x'.repeat(48),
      ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'true',
    };
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(generateCloudflareRasterGatewayImageV15({
      prompt: 'preserve the subject',
      referenceImages: [{
        bytes: Buffer.from([0x89]),
        mimeType: 'image/png',
        width: 512,
        height: 128,
      }],
    }, env, fetchImpl)).rejects.toThrow('CLOUDFLARE_REFERENCE_IMAGE_DIMENSIONS_UNSUPPORTED');

    const reference = {
      bytes: Buffer.from([0x89]),
      mimeType: 'image/png' as const,
      width: 128,
      height: 128,
    };
    await expect(generateCloudflareRasterGatewayImageV15({
      prompt: 'combine the references',
      referenceImages: [reference, reference, reference, reference, reference],
    }, env, fetchImpl)).rejects.toThrow('CLOUDFLARE_REFERENCE_IMAGE_LIMIT_EXCEEDED');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires the remote gateway to independently attest zero-cost readiness', async () => {
    const env = {
      ...FREE_PLAN_ENV,
      ORIGIN_RASTER_GATEWAY_URL: 'https://origin-raster.example.workers.dev',
      ORIGIN_RASTER_GATEWAY_SECRET: 'x'.repeat(48),
      ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'true',
    };
    const fetchImpl = vi.fn<typeof fetch>();
    readyProof(fetchImpl);
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      provider: 'cloudflare-workers-ai-binding',
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      aiBindingConfigured: true,
      secretConfigured: true,
      zeroCostVerified: false,
      freeOnly: true,
      paidFallbackEnabled: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const status = await getCloudflareRasterGatewayStatusV15(env, fetchImpl);
    expect(status).toMatchObject({
      configured: true,
      ready: false,
      zeroCostVerified: false,
      reason: 'CLOUDFLARE_WORKERS_AI_GATEWAY_STATUS_UNVERIFIED',
    });
  });

  it('blocks the gateway on a Workers Paid usage model before contacting the gateway', async () => {
    const env = {
      ...FREE_PLAN_ENV,
      ORIGIN_RASTER_GATEWAY_URL: 'https://origin-raster.example.workers.dev',
      ORIGIN_RASTER_GATEWAY_SECRET: 'x'.repeat(48),
      ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'true',
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'standard' }));

    const status = await getCloudflareRasterGatewayStatusV15(env, fetchImpl);
    expect(status).toMatchObject({
      configured: true,
      ready: false,
      zeroCostVerified: false,
      reason: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/workers/account-settings');
  });

  it('rejects an oversized gateway image from Content-Length before buffering it', async () => {
    const env = {
      ...FREE_PLAN_ENV,
      ORIGIN_RASTER_GATEWAY_URL: 'https://origin-raster.example.workers.dev',
      ORIGIN_RASTER_GATEWAY_SECRET: 'x'.repeat(48),
      ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'true',
    };
    const fetchImpl = vi.fn<typeof fetch>();
    readyProof(fetchImpl);
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        provider: 'cloudflare-workers-ai-binding',
        model: '@cf/black-forest-labs/flux-2-klein-4b',
        aiBindingConfigured: true,
        secretConfigured: true,
        zeroCostVerified: true,
        freeOnly: true,
        paidFallbackEnabled: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x89]), {
        status: 200,
        headers: { 'content-length': String(12 * 1024 * 1024 + 1) },
      }));

    await expect(generateCloudflareRasterGatewayImageV15({
      prompt: 'a simple test image',
      width: 1024,
      height: 1024,
    }, env, fetchImpl)).rejects.toThrow('CLOUDFLARE_IMAGE_SIZE_OUT_OF_BOUNDS');

    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('keeps reference editing fail-closed until the same verified Free provider is ready', async () => {
    const edit = await selectRasterProviderV15('edit', {});
    expect(edit).toMatchObject({
      ready: false,
      task: 'edit',
      provider: null,
      reason: 'NO_VERIFIED_ZERO_COST_PROVIDER_READY',
    });
    for (const task of ['inpaint', 'outpaint', 'variation'] as const) {
      const selection = await selectRasterProviderV15(task, {});
      expect(selection).toMatchObject({
        ready: false,
        task,
        provider: null,
        reason: 'NO_PROVIDER_SUPPORTS_TASK',
      });
    }
  });

  it('keeps text-to-image unavailable when the audited provider is not configured', async () => {
    const selection = await selectRasterProviderV15('text-to-image', {});
    expect(selection.ready).toBe(false);
    if ('reason' in selection) {
      expect(selection.reason).toBe('NO_VERIFIED_ZERO_COST_PROVIDER_READY');
      expect(selection.statuses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          providerId: 'cloudflare-workers-ai-free',
          ready: false,
          reason: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
          supportsTask: true,
          status: expect.objectContaining({
            configured: false,
            ready: false,
            reason: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
          }),
        }),
        expect.objectContaining({
          providerId: 'cloudflare-workers-ai-gateway',
          ready: false,
          reason: 'CLOUDFLARE_WORKERS_AI_GATEWAY_NOT_CONFIGURED',
          supportsTask: true,
        }),
      ]));
    }
  });

  it('reports truthful aggregate capability readiness without implying editing support', async () => {
    const status = await rasterProviderRuntimeStatusV15({});
    expect(status).toMatchObject({
      providerAgnostic: true,
      registryVersion: 'raster-provider-registry-v1',
      supportedTasks: [],
      textToImageReady: false,
      textToImageStatus: {
        configured: false,
        ready: false,
        reason: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
        providerId: 'cloudflare-workers-ai-free',
        zeroCostVerified: false,
        paidFallbackEnabled: false,
        paymentMethodRequired: false,
        secretDelivery: 'server-only',
      },
      textToImageReason: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
      editingReady: false,
      paidFallbackEnabled: false,
      freeOnly: true,
    });
  });
});
