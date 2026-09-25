import { describe, expect, it, vi } from 'vitest';

import {
  discoverZeroCostPollinationsModelV15,
  generateRasterImageV15,
  getRasterProviderStatusV15,
} from './rasterImageProviderV15';

const freeModel = {
  name: 'tomdacatto/sana',
  category: 'image',
  pricing: { currency: 'pollen' },
  paid_only: false,
  input_modalities: ['text'],
  output_modalities: ['image'],
};

const pricedModel = {
  name: 'flux',
  category: 'image',
  pricing: { currency: 'pollen', completionImageTokens: 0.002 },
  paid_only: false,
  input_modalities: ['text'],
  output_modalities: ['image'],
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('rasterImageProviderV15', () => {
  it('selects the audited model only when its live registry price is exactly zero', async () => {
    const fetchMock = vi.fn(async () => json([pricedModel, freeModel])) as unknown as typeof fetch;
    await expect(discoverZeroCostPollinationsModelV15('sk_test', 'tomdacatto/sana', fetchMock)).resolves.toBe('tomdacatto/sana');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports fail-closed status when no server-only provider key exists', async () => {
    const status = await getRasterProviderStatusV15({});
    expect(status).toMatchObject({
      configured: false,
      ready: false,
      zeroCostVerified: false,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      reason: 'POLLINATIONS_KEY_NOT_CONFIGURED',
    });
  });

  it('generates raster bytes only after live zero-price discovery and post-usage verification', async () => {
    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'before-1' }] }))
      .mockResolvedValueOnce(new Response(imageBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }))
      .mockResolvedValueOnce(json({
        usage: [{
          cursor_event_id: 'after-1',
          type: 'generate.image',
          model: 'tomdacatto/sana',
          meter_source: 'tier',
          cost_usd: 0,
          output_image_tokens: 1,
        }],
      }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateRasterImageV15(
      { prompt: '静かな湖と朝焼け', width: 768, height: 1024 },
      { POLLINATIONS_API_KEY: 'sk_test', ORIGIN_IMAGE_MODEL: 'tomdacatto/sana' },
      fetchImpl,
    );

    expect(result).toMatchObject({
      mimeType: 'image/png',
      model: 'tomdacatto/sana',
      providerId: 'pollinations-zero-cost',
      costUsd: 0,
      freeOnly: true,
      externalNetworkRequests: 4,
      width: 768,
      height: 1024,
      visualIntent: {
        purpose: 'general',
        style: 'unspecified',
        orientation: 'portrait',
        typographyOverlay: false,
      },
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/image/');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('model=tomdacatto%2Fsana');
    const providerUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(providerUrl).toContain('safe=privacy%2Csecrets%2Csexual%2Cviolence%2Cshield');
    expect(decodeURIComponent(new URL(providerUrl).pathname)).toContain('Purpose: general.');
    expect(decodeURIComponent(new URL(providerUrl).pathname)).toContain('Canvas: 768x1024, portrait.');
    expect(decodeURIComponent(new URL(providerUrl).pathname)).toContain('Avoid: low quality');
  });

  it('does not auto-adopt an unknown community model even when its live price is zero', async () => {
    const unknownFree = { ...freeModel, name: 'community/new-free-model' };
    const fetchMock = vi.fn(async () => json([unknownFree])) as unknown as typeof fetch;
    await expect(discoverZeroCostPollinationsModelV15('sk_test', 'community/new-free-model', fetchMock)).resolves.toBeNull();
  });

  it('rejects content-type spoofing when the returned bytes are not a real image signature', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [] }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })) as unknown as typeof fetch;

    await expect(generateRasterImageV15(
      { prompt: 'test' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchMock,
    )).rejects.toThrow('RASTER_IMAGE_SIGNATURE_MISMATCH');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('blocks priced models and never executes the image request', async () => {
    const fetchMock = vi.fn(async () => json([pricedModel])) as unknown as typeof fetch;
    await expect(generateRasterImageV15(
      { prompt: 'test', model: 'flux' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchMock,
    )).rejects.toThrow('NO_VERIFIED_ZERO_COST_RASTER_MODEL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for eventually-consistent usage evidence and succeeds only after zero-cost tier proof appears', async () => {
    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const matchingUsage = {
      cursor_event_id: 'after-eventual',
      type: 'generate.image',
      model: 'tomdacatto/sana',
      meter_source: 'tier',
      cost_usd: 0,
      output_image_tokens: 1,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'before-eventual' }] }))
      .mockResolvedValueOnce(new Response(imageBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }))
      .mockResolvedValueOnce(json({ usage: [] }))
      .mockResolvedValueOnce(json({ usage: [] }))
      .mockResolvedValueOnce(json({ usage: [matchingUsage] }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateRasterImageV15(
      { prompt: '夕焼けの海' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchImpl,
      { attempts: 3, delayMs: 0 },
    );

    expect(result.externalNetworkRequests).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('rejects paid-balance usage even when the reported USD cost is zero', async () => {
    const imageBytes = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'before-paid' }] }))
      .mockResolvedValueOnce(new Response(imageBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }))
      .mockResolvedValueOnce(json({
        usage: [{
          cursor_event_id: 'after-paid',
          type: 'generate.image',
          model: 'tomdacatto/sana',
          meter_source: 'pack',
          cost_usd: 0,
          output_image_tokens: 1,
        }],
      }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(generateRasterImageV15(
      { prompt: 'test' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchImpl,
      { attempts: 1, delayMs: 0 },
    )).rejects.toThrow('ZERO_COST_USAGE_NOT_VERIFIED');
  });

  it('fails before generation when the provider cannot supply a trustworthy usage baseline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ model: 'tomdacatto/sana' }] })) as unknown as typeof fetch;

    await expect(generateRasterImageV15(
      { prompt: 'test' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchMock,
      { attempts: 1, delayMs: 0 },
    )).rejects.toThrow('USAGE_BASELINE_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects the output if actual zero-cost usage cannot be proven after generation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'before-cost' }] }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }))
      .mockResolvedValueOnce(json({
        usage: [{
          cursor_event_id: 'after-cost',
          type: 'generate.image',
          model: 'tomdacatto/sana',
          meter_source: 'tier',
          cost_usd: 0.01,
          output_image_tokens: 1,
        }],
      })) as unknown as typeof fetch;

    await expect(generateRasterImageV15(
      { prompt: 'test' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchMock,
      { attempts: 1, delayMs: 0 },
    )).rejects.toThrow('ZERO_COST_USAGE_NOT_VERIFIED');
  });
});
