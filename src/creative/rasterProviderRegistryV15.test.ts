import { describe, expect, it } from 'vitest';

import {
  rasterProviderRegistryV15,
  rasterProviderRuntimeStatusV15,
  resolveRasterProviderV15,
  selectRasterProviderV15,
} from './rasterProviderRegistryV15';

describe('rasterProviderRegistryV15', () => {
  it('exposes only free-only server-side providers with no paid fallback', () => {
    const providers = rasterProviderRegistryV15();
    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject({
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

  it('resolves text generation and bounded reference editing without overclaiming other edit modes', () => {
    expect(resolveRasterProviderV15('text-to-image')?.descriptor.id).toBe('cloudflare-workers-ai-free');
    expect(resolveRasterProviderV15('edit')?.descriptor.id).toBe('cloudflare-workers-ai-free');
    expect(resolveRasterProviderV15('inpaint')).toBeNull();
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

  it('falls through to Pollinations only when a scoped zero-budget key can be verified', async () => {
    const selection = await selectRasterProviderV15('text-to-image', {});
    expect(selection.ready).toBe(false);
    if ('statuses' in selection) {
      expect(selection.reason).toBe('NO_VERIFIED_ZERO_COST_PROVIDER_READY');
      expect(selection.statuses).toEqual([
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
          providerId: 'pollinations-zero-cost',
          ready: false,
          reason: 'POLLINATIONS_KEY_NOT_CONFIGURED',
          supportsTask: true,
          status: expect.objectContaining({
            configured: false,
            ready: false,
            reason: 'POLLINATIONS_KEY_NOT_CONFIGURED',
          }),
        }),
      ]);
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
      textToImageReason: 'NO_VERIFIED_ZERO_COST_PROVIDER_READY',
      editingReady: false,
      paidFallbackEnabled: false,
      freeOnly: true,
    });
  });
  it('continues probing other free providers when a provider status network request fails', async () => {
    const fetchFails: typeof fetch = async () => {
      throw new Error('simulated network outage');
    };
    const selection = await selectRasterProviderV15('text-to-image', {
      CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_API_TOKEN: 'test-token-value-that-is-long-enough',
      POLLINATIONS_API_KEY: 'test-pollinations-key',
    }, fetchFails);

    expect(selection.ready).toBe(false);
    if ('statuses' in selection) {
      expect(selection.statuses.map(item => item.providerId)).toEqual([
        'cloudflare-workers-ai-free',
        'pollinations-zero-cost',
      ]);
      expect(selection.statuses.every(item => item.ready === false)).toBe(true);
    }
  });

  it('selects Cloudflare when Workers Free hard quota and model access are verified', async () => {
    const response = (body: unknown) => new Response(JSON.stringify({ success: true, result: body }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/workers/account-settings')) {
        return response({ default_usage_model: 'bundled' });
      }
      if (url.endsWith('/subscriptions')) return response([]);
      if (url.includes('/ai/models/schema?model=')) return response({ input: {}, output: {} });
      throw new Error('Unexpected provider request');
    };
    const selection = await selectRasterProviderV15('text-to-image', {
      CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_API_TOKEN: 'test-token-value-that-is-long-enough',
    }, fetchMock);

    expect(selection.ready).toBe(true);
    if (selection.ready) {
      expect(selection.provider.descriptor.id).toBe('cloudflare-workers-ai-free');
      expect(selection.status).toMatchObject({
        ready: true,
        zeroCostVerified: true,
        paidFallbackEnabled: false,
        paymentMethodRequired: false,
        reason: null,
      });
    }
  });

});
