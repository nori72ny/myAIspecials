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
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      id: 'pollinations-zero-cost',
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
    ]);
  });

  it('resolves the current text-to-image implementation without claiming unsupported editing capabilities', () => {
    expect(resolveRasterProviderV15('text-to-image')?.descriptor.id).toBe('pollinations-zero-cost');
    expect(resolveRasterProviderV15('edit')).toBeNull();
    expect(resolveRasterProviderV15('inpaint')).toBeNull();
  });

  it('fails closed for editing until a separately verified provider supports it', async () => {
    for (const task of ['edit', 'inpaint', 'outpaint', 'variation'] as const) {
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
      expect(selection.statuses).toEqual([
        {
          providerId: 'pollinations-zero-cost',
          ready: false,
          reason: 'POLLINATIONS_KEY_NOT_CONFIGURED',
          supportsTask: true,
        },
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
      textToImageStatus: null,
      textToImageReason: 'POLLINATIONS_KEY_NOT_CONFIGURED',
      editingReady: false,
      paidFallbackEnabled: false,
      freeOnly: true,
    });
  });
});
