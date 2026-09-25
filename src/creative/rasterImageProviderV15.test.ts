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
  it('selects only a model whose live registry price is exactly zero', async () => {
    const fetchMock = vi.fn(async () => json([pricedModel, freeModel])) as unknown as typeof fetch;
    await expect(discoverZeroCostPollinationsModelV15('sk_test', 'flux', fetchMock)).resolves.toBe('tomdacatto/sana');
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
    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(new Response(imageBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }))
      .mockResolvedValueOnce(json({
        usage: [{
          timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
          type: 'generate.image',
          model: 'tomdacatto/sana',
          meter_source: 'tier',
          cost_usd: 0,
        }],
      })) as unknown as typeof fetch;

    const result = await generateRasterImageV15(
      { prompt: '静かな湖と朝焼け', width: 768, height: 1024 },
      { POLLINATIONS_API_KEY: 'sk_test', ORIGIN_IMAGE_MODEL: 'tomdacatto/sana' },
      fetchMock,
    );

    expect(result).toMatchObject({
      mimeType: 'image/png',
      model: 'tomdacatto/sana',
      providerId: 'pollinations-zero-cost',
      costUsd: 0,
      freeOnly: true,
      externalNetworkRequests: 3,
      width: 768,
      height: 1024,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/image/');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('model=tomdacatto%2Fsana');
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

  it('rejects the output if actual zero-cost usage cannot be proven after generation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }))
      .mockResolvedValueOnce(json({
        usage: [{
          timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
          type: 'generate.image',
          model: 'tomdacatto/sana',
          meter_source: 'pack',
          cost_usd: 0.01,
        }],
      })) as unknown as typeof fetch;

    await expect(generateRasterImageV15(
      { prompt: 'test' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchMock,
    )).rejects.toThrow('ZERO_COST_USAGE_NOT_VERIFIED');
  });
});
