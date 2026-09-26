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

function imageJson(bytes: Uint8Array, mediaType?: string): Response {
  return json({
    created: 1,
    data: [{
      b64_json: Buffer.from(bytes).toString('base64'),
      ...(mediaType ? { media_type: mediaType } : {}),
    }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: {} },
  });
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  Buffer.from('IHDR', 'ascii').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return Uint8Array.from(bytes);
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
    const imageBytes = pngBytes(768, 1024);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'before-1' }] }))
      .mockResolvedValueOnce(imageJson(imageBytes, 'image/png'))
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
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe('https://gen.pollinations.ai/v1/images/generations');
    const generationInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(generationInit.method).toBe('POST');
    expect(new Headers(generationInit.headers).get('pollinations-safe')).toBe('privacy,secrets,sexual,violence,shield');
    expect(JSON.parse(String(generationInit.body))).toMatchObject({
      prompt: '静かな湖と朝焼け',
      model: 'tomdacatto/sana',
      n: 1,
      size: '768x1024',
      quality: 'medium',
      response_format: 'b64_json',
      safe: true,
    });
  });

  it('rejects ambiguous nonnumeric pricing instead of treating it as free', async () => {
    const ambiguous = { ...freeModel, pricing: { currency: 'pollen', completionImageTokens: '0.002' } };
    const fetchMock = vi.fn(async () => json([ambiguous])) as unknown as typeof fetch;
    await expect(discoverZeroCostPollinationsModelV15('sk_test', 'tomdacatto/sana', fetchMock)).resolves.toBeNull();
  });

  it('does not auto-adopt an unknown community model even when its live price is zero', async () => {
    const unknownFree = { ...freeModel, name: 'community/new-free-model' };
    const fetchMock = vi.fn(async () => json([unknownFree])) as unknown as typeof fetch;
    await expect(discoverZeroCostPollinationsModelV15('sk_test', 'community/new-free-model', fetchMock)).resolves.toBeNull();
  });

  it('fails closed when provider bytes do not match the requested raster dimensions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [] }))
      .mockResolvedValueOnce(imageJson(pngBytes(512, 512), 'image/png')) as unknown as typeof fetch;

    await expect(generateRasterImageV15(
      { prompt: 'test', width: 1024, height: 1024 },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchMock,
    )).rejects.toThrow('RASTER_IMAGE_DIMENSION_MISMATCH');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an oversized provider response before buffering the payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [] }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '99999999' },
      })) as unknown as typeof fetch;

    await expect(generateRasterImageV15(
      { prompt: 'test' },
      { POLLINATIONS_API_KEY: 'sk_test' },
      fetchMock,
    )).rejects.toThrow('RASTER_RESPONSE_SIZE_OUT_OF_BOUNDS');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects content-type spoofing when the returned bytes are not a real image signature', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [] }))
      .mockResolvedValueOnce(imageJson(Uint8Array.from([1, 2, 3, 4]), 'image/png')) as unknown as typeof fetch;

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
    const imageBytes = pngBytes(1024, 1024);
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
      .mockResolvedValueOnce(imageJson(imageBytes, 'image/png'))
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
    const imageBytes = pngBytes(1024, 1024);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'before-paid' }] }))
      .mockResolvedValueOnce(imageJson(imageBytes, 'image/png'))
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
      .mockResolvedValueOnce(imageJson(pngBytes(1024, 1024), 'image/png'))
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
