import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRasterImageV15Router } from './rasterImageV15Router';

const CF_ENV: NodeJS.ProcessEnv = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: `test-${'x'.repeat(40)}`,
};

function cfEnvelope(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result, errors: [], messages: [] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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

function referenceDataUrl(width = 320, height = 240): string {
  return `data:image/png;base64,${Buffer.from(pngBytes(width, height)).toString('base64')}`;
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
      reason: 'STATUS_NOT_LIVE_VERIFIED',
      freeOnly: true,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      providerAgnostic: true,
      registryVersion: 'raster-provider-registry-v1',
      supportedTasks: [],
      modelBasedImageEditing: false,
      referenceImagePolicy: {
        transport: 'data-url-only',
        remoteUrlsAllowed: false,
        maxImages: 4,
        maxBytesPerImage: 786432,
        maxTotalBytes: 2097152,
        maxDimensionExclusive: 512,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      },
      rasterCritic: {
        version: 'raster-structural-critic-v1',
        failClosed: true,
      },
      technicalPixelCritic: {
        version: 'raster-technical-critic-v1',
        implemented: true,
        execution: 'available-local-module',
        deliveryGateWired: true,
        semanticVisionJudgment: false,
      },
      semanticVisionCritic: {
        version: 'raster-semantic-critic-v1',
        implemented: true,
        freeOnly: true,
        costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified',
        paidFallbackEnabled: false,
        secretDelivery: 'server-only',
        deliveryGateWired: true,
        enabled: true,
        activationGate: 'real-free-image-e2e-plus-semantic-effectiveness-and-quota-evidence',
      },
      templateEngine: {
        version: 'raster-template-engine-v1',
      },
    });
    expect(JSON.stringify(status.body)).not.toMatch(/CLOUDFLARE_|POLLINATIONS_|subscription|billing/i);
    expect(status.body.templateEngine.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'instagram-story', width: 864, height: 1536, safeMarginPct: 9 }),
      expect.objectContaining({ id: 'youtube-thumbnail', width: 1536, height: 864 }),
      expect.objectContaining({ id: 'lp-hero', width: 1536, height: 864 }),
    ]));

    const legacy = await request(app()).post('/api/generate-image').send({ prompt: '海辺の朝焼け' });
    expect(legacy.status).toBe(503);
    expect(legacy.body.code).toBe('RASTER_GENERATION_DISABLED_ZERO_COST_POLICY');
  });

  it('does not probe provider or billing APIs from public status when credentials exist', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV)).get('/api/creative/v1.5/raster/status');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ready: false,
      reason: 'STATUS_NOT_LIVE_VERIFIED',
      externalNetwork: false,
      freeOnly: true,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      supportedTasks: [],
      modelBasedImageEditing: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never exposes live free-allocation eligibility from an unverified public status read', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV)).get('/api/creative/v1.5/raster/status');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ready: false,
      zeroCostVerified: false,
      freeAllocationEligible: false,
      externalNetwork: false,
      freeOnly: true,
      paidFallbackEnabled: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns focused clarification questions before any provider execution for vague image requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: '画像を作ってください' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      ok: false,
      code: 'IMAGE_REQUIREMENTS_INCOMPLETE',
      freeOnly: true,
      providerExecutions: 0,
      secretDelivery: 'server-only',
    });
    expect(response.body.costUsd).toBeUndefined();
    expect(response.body.questions).toEqual([expect.stringContaining('何を主役')]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects incomplete or out-of-bounds raster dimension pairs before provider execution', async () => {
    const missingHeight = await request(app())
      .post('/api/creative/v1.5/raster/plan')
      .send({ prompt: '広告画像を作って', width: 1200 });
    expect(missingHeight.status).toBe(400);
    expect(missingHeight.body.code).toBe('INVALID_RASTER_DIMENSION_PAIR');

    const tooLarge = await request(app())
      .post('/api/creative/v1.5/raster/plan')
      .send({ prompt: '広告画像を作って', width: 1600, height: 900 });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.code).toBe('INVALID_RASTER_DIMENSION');
  });

  it('keeps exact API dimensions aligned with plan provenance', async () => {
    const response = await request(app())
      .post('/api/creative/v1.5/raster/plan')
      .send({ prompt: 'ORIGINの広告画像を作ってください', width: 1200, height: 628 });
    expect(response.status).toBe(200);
    expect(response.body.plan).toMatchObject({
      templateId: 'custom-size',
      platform: 'custom-size',
      width: 1200,
      height: 628,
      safeMarginPct: 7,
    });
    expect(response.body.plan.compiledPrompt).toContain('Output: 1200x628');
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
      platform: 'vertical-mobile-story',
      templateId: 'instagram-story',
      safeMarginPct: 9,
      typographyZone: 'bottom',
      width: 864,
      height: 1536,
    });
    expect(response.body.plan.compiledPrompt).toContain('Art direction');
    expect(response.body.candidatePolicy).toMatchObject({
      version: 'raster-candidate-policy-v1',
      recommendedCandidates: 2,
      activeCandidates: 1,
      bestOfNEnabled: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks sensitive content before any external image-provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: 'このキー sk-abcdefghijklmnop を画像にしてください' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SENSITIVE_INPUT_BLOCKED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects reference images on the text-generation route instead of silently switching tasks', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({
        prompt: '背景を変更してください',
        referenceImages: [referenceDataUrl()],
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_RASTER_REQUEST_FIELD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects remote reference URLs before any provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/edit')
      .send({
        prompt: '背景だけ変更してください',
        referenceImages: ['https://example.com/private.png'],
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('REFERENCE_IMAGE_INVALID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects Cloudflare-incompatible reference dimensions before any provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/edit')
      .send({
        prompt: '背景だけ変更してください',
        referenceImages: [referenceDataUrl(512, 320)],
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('REFERENCE_IMAGE_DIMENSION_OUT_OF_BOUNDS');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks Cloudflare Free allocation before inference without request-level zero-cost proof', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('RASTER_GENERATION_DISABLED_ZERO_COST_POLICY');
    expect(response.body.freeOnly).toBe(true);
    expect(response.body.paidFallbackUsed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ai/run/'))).toBe(false);
  });

  it('blocks Pollinations scoped free allocation before inference without request-level zero-cost proof', async () => {
    const freeModel = {
      id: 'tomdacatto/sana',
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
      permissions: { models: ['tomdacatto/sana'] },
      pollenBudget: 5,
      questPollenOnly: true,
      rateLimitEnabled: false,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(scopedKeyInfo))
      .mockResolvedValueOnce(json([freeModel]));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ POLLINATIONS_API_KEY: 'test-pollinations-key' }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('RASTER_GENERATION_DISABLED_ZERO_COST_POLICY');
    expect(response.body.paidFallbackUsed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/image/'))).toBe(false);
  });

  it('does not fall back to another free-allocation provider when neither has request-level cost proof', async () => {
    const scopedKeyInfo = {
      valid: true,
      type: 'secret',
      permissions: { models: ['tomdacatto/sana'] },
      pollenBudget: 5,
      questPollenOnly: true,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(json(scopedKeyInfo))
      .mockResolvedValueOnce(json([{
        id: 'tomdacatto/sana',
        category: 'image',
        title: 'Sana Sprint (Free)',
        pricing: { currency: 'pollen' },
        paid_only: false,
        input_modalities: ['text'],
        output_modalities: ['image'],
      }]));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      ...CF_ENV,
      POLLINATIONS_API_KEY: 'test-pollinations-key',
    }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('RASTER_GENERATION_DISABLED_ZERO_COST_POLICY');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ai/run/'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/image/'))).toBe(false);
  });

  it('rejects unexpected request fields instead of forwarding them upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: 'test', callbackUrl: 'https://attacker.example' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_RASTER_REQUEST_FIELD');
    expect(fetchMock).not.toHaveBeenCalled();
  });


  it('blocks direct valid generate and edit API calls before any provider network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const instance = app(CF_ENV);
    const prompt = '高級で未来的なORIGINのスマホ広告画像を9:16で作ってください';

    const generate = await request(instance)
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt });
    const edit = await request(instance)
      .post('/api/creative/v1.5/raster/edit')
      .send({ prompt, referenceImages: [referenceDataUrl()] });

    for (const response of [generate, edit]) {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        ok: false,
        code: 'RASTER_GENERATION_DISABLED_ZERO_COST_POLICY',
        freeOnly: true,
        paidFallbackUsed: false,
        retryable: false,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
