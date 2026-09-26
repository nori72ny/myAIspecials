import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRasterImageV15Router } from './rasterImageV15Router';

const freeModel = {
  name: 'tomdacatto/sana',
  category: 'image',
  title: 'Sana Sprint (Free)',
  description: 'Free image model',
  community: true,
  pricing: { currency: 'pollen' },
  paid_only: false,
  input_modalities: ['text'],
  output_modalities: ['image'],
};

const scopedKeyInfo = {
  valid: true,
  type: 'secret',
  permissions: {
    models: ['tomdacatto/sana'],
    account: ['usage'],
  },
  pollenBudget: 1,
  rateLimitEnabled: false,
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

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(96);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  Buffer.from('IHDR', 'ascii').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return Uint8Array.from(bytes);
}

function imageJson(bytes: Uint8Array): Response {
  return json({ data: [{ b64_json: Buffer.from(bytes).toString('base64'), media_type: 'image/png' }] });
}

function successfulFetchMock() {
  const png = pngBytes(768, 1024);
  return vi.fn()
    .mockResolvedValueOnce(json(scopedKeyInfo))
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
      providerAgnostic: true,
      registryVersion: 'raster-provider-registry-v1',
      supportedTasks: [],
      modelBasedImageEditing: false,
      rasterCritic: {
        version: 'raster-structural-critic-v1',
        failClosed: true,
      },
    });

    const legacy = await request(app()).post('/api/generate-image').send({ prompt: '海辺の朝焼け' });
    expect(legacy.status).toBe(503);
    expect(legacy.body.code).toBe('POLLINATIONS_KEY_NOT_CONFIGURED');
  });

  it('reports configured-but-not-ready when the provider key is not least-privilege scoped', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({
      ...scopedKeyInfo,
      permissions: { models: null, account: ['usage'] },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ POLLINATIONS_API_KEY: 'server_only_key' }))
      .get('/api/creative/v1.5/raster/status');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      configured: true,
      ready: false,
      reason: 'POLLINATIONS_KEY_SCOPE_INVALID',
      freeOnly: true,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      providerAgnostic: true,
      registryVersion: 'raster-provider-registry-v1',
      supportedTasks: [],
      modelBasedImageEditing: false,
      rasterCritic: {
        version: 'raster-structural-critic-v1',
        failClosed: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns focused clarification questions before any provider execution for vague image requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ POLLINATIONS_API_KEY: 'server_only_key' }))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: '画像を作ってください' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      ok: false,
      code: 'IMAGE_REQUIREMENTS_INCOMPLETE',
      freeOnly: true,
      costUsd: 0,
      providerExecutions: 0,
      secretDelivery: 'server-only',
    });
    expect(response.body.questions).toEqual([expect.stringContaining('何を主役')]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes the structured raster plan without executing an image provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app())
      .post('/api/creative/v1.5/raster/plan')
      .send({ prompt: '高級で未来的なORIGINのスマホ広告画像を9:16で作ってください' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.code).toBe('RASTER_PLAN_READY');
    expect(response.body.plan).toMatchObject({
      version: 'raster-visual-plan-v1',
      purpose: 'advertisement',
      platform: 'vertical-mobile',
      width: 864,
      height: 1536,
    });
    expect(response.body.plan.compiledPrompt).toContain('Art direction');
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(response.headers['x-origin-external-network-requests']).toBe('5');
    expect(response.headers['x-origin-secret-delivery']).toBe('server-only');
    expect(response.headers['x-origin-visual-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers['x-origin-visual-generation-id']).toMatch(/^raster-[a-f0-9]{24}$/);
    expect(response.headers['x-origin-visual-brain']).toBe('visual-brain-v1');
    expect(response.headers['x-origin-visual-plan']).toBe('raster-visual-plan-v1');
    expect(response.headers['x-origin-visual-plan-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers['x-origin-visual-purpose']).toBe('photograph');
    expect(response.headers['x-origin-visual-critic']).toBe('raster-structural-critic-v1');
    expect(response.headers['x-origin-visual-quality-score']).toBe('100');
    expect(response.headers['x-origin-visual-actual-width']).toBe('768');
    expect(response.headers['x-origin-visual-actual-height']).toBe('1024');
    expect(response.headers['x-origin-visual-typography-overlay']).toBe('not-required');
    expect(response.headers['x-origin-visual-width']).toBe('768');
    expect(response.headers['x-origin-visual-height']).toBe('1024');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const providerRequest = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const authorization = new Headers(providerRequest.headers).get('authorization');
    expect(authorization).toBe('Bearer server_only_key');
    expect(response.text ?? '').not.toContain('server_only_key');
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe('https://gen.pollinations.ai/v1/images/generations');
    const providerBody = JSON.parse(String(providerRequest.body));
    expect(providerBody.prompt).toContain('Create a polished production-quality image');
    expect(providerBody.prompt).toContain('User request: 静かな湖と朝焼け');
    expect(providerBody).toMatchObject({
      model: 'tomdacatto/sana',
      size: '768x1024',
      response_format: 'b64_json',
    });
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
