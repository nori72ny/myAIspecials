import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRasterImageV15Router } from './rasterImageV15Router';

const freeModel = {
  name: 'tomdacatto/sana',
  category: 'image',
  pricing: { currency: 'pollen' },
  paid_only: false,
  input_modalities: ['text'],
  output_modalities: ['image'],
};

function app(env: NodeJS.ProcessEnv = {}) {
  const instance = express();
  instance.use(express.json({ limit: '64kb' }));
  instance.use(createRasterImageV15Router(env));
  return instance;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function imageJson(bytes: Uint8Array, mediaType = 'image/png'): Response {
  return json({
    created: 1,
    data: [{ b64_json: Buffer.from(bytes).toString('base64'), media_type: mediaType }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: {} },
  });
}

function successfulFetchMock() {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  return vi.fn()
    .mockResolvedValueOnce(json([freeModel]))
    .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'before-router' }] }))
.mockResolvedValueOnce(imageJson(png))
    .mockResolvedValueOnce(json({
      usage: [{
        cursor_event_id: 'after-router',
        type: 'generate.image',
        model: 'tomdacatto/sana',
        meter_source: 'tier',
        cost_usd: 0,
        output_image_tokens: 1,
      }],
    }));
}

describe('rasterImageV15Router', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps both raster routes fail-closed when the server-only provider key is absent', async () => {
    const status = await request(app()).get('/api/creative/v1.5/raster/status');
    expect(status.status).toBe(503);
    expect(status.body).toMatchObject({
      ok: false,
      ready: false,
      configured: false,
      reason: 'POLLINATIONS_KEY_NOT_CONFIGURED',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });

    const legacy = await request(app()).post('/api/generate-image').send({ prompt: '海辺の朝焼け' });
    expect(legacy.status).toBe(503);
    expect(legacy.body.code).toBe('POLLINATIONS_KEY_NOT_CONFIGURED');
  });

  it('blocks sensitive content before any external image-provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ POLLINATIONS_API_KEY: 'server_only_key' }))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: 'このキー sk-abcdefghijklmnop を画像にしてください' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SENSITIVE_INPUT_BLOCKED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns verified raster bytes and zero-cost evidence through the production-compatible route', async () => {
    const fetchMock = successfulFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      POLLINATIONS_API_KEY: 'server_only_key',
      ORIGIN_IMAGE_MODEL: 'tomdacatto/sana',
    }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['x-origin-visual-verified']).toBe('true');
    expect(response.headers['x-origin-visual-provider']).toBe('pollinations-zero-cost');
    expect(response.headers['x-origin-visual-model']).toBe('tomdacatto/sana');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBe('0');
    expect(response.headers['x-origin-paid-fallback']).toBe('false');
    expect(response.headers['x-origin-external-network']).toBe('true');
    expect(response.headers['x-origin-external-network-requests']).toBe('4');
    expect(response.headers['x-origin-secret-delivery']).toBe('server-only');
    expect(response.headers['x-origin-visual-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers['x-origin-visual-generation-id']).toMatch(/^raster-[a-f0-9]{24}$/);
    expect(response.headers['x-origin-visual-brain']).toBe('visual-brain-v1');
    expect(response.headers['x-origin-visual-prompt-compiler']).toBe('raster-compiler-v1');
    expect(response.headers['x-origin-visual-plan-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers['x-origin-visual-purpose']).toBe('general');
    expect(response.headers['x-origin-visual-width']).toBe('768');
    expect(response.headers['x-origin-visual-height']).toBe('1024');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const providerUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(providerUrl).toBe('https://gen.pollinations.ai/v1/images/generations');
    const providerRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(providerRequest.method).toBe('POST');
    const providerBody = JSON.parse(String(providerRequest.body));
    expect(providerBody.prompt).toContain('Create the requested image as a finished, production-quality visual.');
    expect(providerBody.prompt).toContain('Original request: 静かな湖と朝焼け');
    expect(providerBody).toMatchObject({
      model: 'tomdacatto/sana',
      n: 1,
      size: '768x1024',
      response_format: 'b64_json',
      safe: 'privacy,secrets,sexual,violence,shield',
    });
    const authorization = new Headers(providerRequest.headers).get('authorization');
    expect(authorization).toBe('Bearer server_only_key');
    expect(response.text ?? '').not.toContain('server_only_key');
  });

  it('rejects unexpected request fields instead of forwarding them upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ POLLINATIONS_API_KEY: 'server_only_key' }))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: 'test', callbackUrl: 'https://attacker.example' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_RASTER_REQUEST_FIELD');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
