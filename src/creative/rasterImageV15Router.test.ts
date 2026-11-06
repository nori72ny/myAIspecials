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
        enabled: false,
        activationGate: 'cloudflare-free-proof-pipeline-v1',
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

  it('fails closed at the quota pre-check when daily usage cannot be verified, before any inference', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    // Plan proof passes, but the GraphQL usage read is unavailable, so the
    // request-level $0.00 proof cannot be completed and inference never runs.
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
    expect(response.body.freeOnly).toBe(true);
    expect(response.body.paidFallbackUsed).toBe(false);
    expect(response.body.retryable).toBe(false);
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

  it('does not fall back to another provider when the Cloudflare proof pipeline cannot complete', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
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

    // The Cloudflare quota read receives a non-GraphQL payload and fails
    // closed; Pollinations is never used as a fallback (its credit balance
    // can draw from paid funds, so no structural $0.00 proof exists there).
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ai/run/'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/images/generations'))).toBe(false);
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


  it('fails closed for direct valid generate and edit API calls when the plan proof cannot complete', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
    const fetchMock = vi.fn(async (_url: string) => { throw new Error('network unavailable'); });
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
        code: 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED',
        freeOnly: true,
        paidFallbackUsed: false,
        retryable: false,
      });
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ai/run/'))).toBe(false);
  });

  it('reports the semantic gate as enabled in status once Cloudflare credentials are configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV)).get('/api/creative/v1.5/raster/status');

    expect(response.status).toBe(503);
    expect(response.body.semanticVisionCritic).toMatchObject({
      enabled: true,
      deliveryGateWired: true,
      activationGate: 'cloudflare-free-proof-pipeline-v1',
    });
    // Status remains a local-only read even when the gate is enabled.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers an image only when the full Cloudflare Free proof pipeline passes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
    const state = { usedNeurons: 100, imageRuns: 0 };
    const criticAnswer = JSON.stringify({
      promptAdherence: 4,
      composition: 4,
      subjectIntegrity: 4,
      styleExecution: 4,
      textHandling: 4,
      artifactControl: 4,
      professionalUsefulness: 4,
      safetyPassed: true,
      safetyIssues: [],
      criticalIssues: [],
      summary: '依頼どおりの画像です。',
    });
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes('/workers/account-settings')) return cfEnvelope({ default_usage_model: 'bundled' });
      if (target.includes('/subscriptions')) return cfEnvelope([]);
      if (target.includes('/ai/models/schema')) return cfEnvelope({ input: {}, output: {} });
      if (target.includes('/graphql')) {
        return json({
          data: {
            viewer: {
              accounts: [{
                workersAiRequestsAdaptiveGroups: [{ sum: { totalNeurons: state.usedNeurons, requestCount: 1 } }],
              }],
            },
          },
        });
      }
      if (target.includes('/ai/run/@cf/black-forest-labs/flux-2-klein-4b')) {
        state.imageRuns += 1;
        state.usedNeurons += 140;
        return cfEnvelope(Buffer.from(pngBytes(768, 1024)).toString('base64'));
      }
      if (target.includes('/ai/run/@cf/moondream/')) return cfEnvelope({ answer: criticAnswer });
      throw new Error(`unexpected fetch: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      code: 'RASTER_GENERATED',
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      providerId: 'cloudflare-workers-ai-free',
      costUsd: 0,
      costEvidence: 'post-generation-usage-zero-confirmed',
      freeOnly: true,
      paidFallbackUsed: false,
      providerExecutions: 1,
    });
    expect(response.body.image.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(response.body.image).toMatchObject({ width: 768, height: 1024, mimeType: 'image/png' });
    expect(response.body.critics.semantic).toMatchObject({ passed: true, score: 100 });
    expect(response.body.usage).toMatchObject({
      allocationNeurons: 10_000,
      usedBeforeNeurons: 100,
      // Single-candidate policy for this prompt: (126 generation + 256
      // critic reserve) x (1 candidate + 1 budgeted retry).
      reservedNeurons: 764,
      candidatesPlanned: 1,
      observedDeltaNeurons: 140,
      usedAfterNeurons: 240,
    });
    expect(state.imageRuns).toBe(1);
  });

  it('runs best-of-2 candidate selection for quality-critical purposes within the quota reserve', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
    const state = { usedNeurons: 100, imageRuns: 0 };
    const criticAnswer = (score: number) => JSON.stringify({
      promptAdherence: score, composition: score, subjectIntegrity: score, styleExecution: score,
      textHandling: score, artifactControl: score, professionalUsefulness: score,
      safetyPassed: true, safetyIssues: [], criticalIssues: [], summary: '評価済みです。',
    });
    const criticAnswers = [criticAnswer(3.6), criticAnswer(4)];
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes('/workers/account-settings')) return cfEnvelope({ default_usage_model: 'bundled' });
      if (target.includes('/subscriptions')) return cfEnvelope([]);
      if (target.includes('/ai/models/schema')) return cfEnvelope({ input: {}, output: {} });
      if (target.includes('/graphql')) {
        return json({
          data: {
            viewer: {
              accounts: [{
                workersAiRequestsAdaptiveGroups: [{ sum: { totalNeurons: state.usedNeurons, requestCount: 1 } }],
              }],
            },
          },
        });
      }
      if (target.includes('/ai/run/@cf/black-forest-labs/flux-2-klein-4b')) {
        state.imageRuns += 1;
        state.usedNeurons += 140;
        return cfEnvelope(Buffer.from(pngBytes(768, 1024)).toString('base64'));
      }
      if (target.includes('/ai/run/@cf/moondream/')) return cfEnvelope({ answer: criticAnswers.shift() });
      throw new Error(`unexpected fetch: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: '高級で未来的なORIGINのスマホ広告画像を作ってください', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.body.plan).toMatchObject({ purpose: 'advertisement' });
    expect(state.imageRuns).toBe(2);
    expect(response.body.usage).toMatchObject({ candidatesPlanned: 2, candidatesGenerated: 2 });
    expect(response.body.quality).toMatchObject({
      retryUsed: false,
      selectedCandidateIndex: 1,
      candidates: [
        { index: 0, semanticScore: 90, passed: true, selected: false },
        { index: 1, semanticScore: 100, passed: true, selected: true },
      ],
    });
  });

  it('refuses generation before inference when the daily free allocation cannot cover the reserve', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
    const state = { imageRuns: 0 };
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes('/workers/account-settings')) return cfEnvelope({ default_usage_model: 'bundled' });
      if (target.includes('/subscriptions')) return cfEnvelope([]);
      if (target.includes('/ai/models/schema')) return cfEnvelope({ input: {}, output: {} });
      if (target.includes('/graphql')) {
        return json({
          data: {
            viewer: {
              accounts: [{
                workersAiRequestsAdaptiveGroups: [{ sum: { totalNeurons: 9_900, requestCount: 40 } }],
              }],
            },
          },
        });
      }
      if (target.includes('/ai/run/')) {
        state.imageRuns += 1;
        return cfEnvelope('');
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT');
    expect(response.body.retryable).toBe(false);
    expect(state.imageRuns).toBe(0);
  });

});
