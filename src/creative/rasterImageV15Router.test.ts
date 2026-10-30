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

function cfFailure(status: number, code: number): Response {
  return new Response(JSON.stringify({
    success: false,
    result: null,
    errors: [{ code, message: 'upstream failure' }],
    messages: [],
  }), {
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

function imageJson(bytes: Uint8Array): Response {
  return json({ data: [{ b64_json: Buffer.from(bytes).toString('base64'), media_type: 'image/png' }] });
}

function referenceDataUrl(width = 320, height = 240): string {
  return `data:image/png;base64,${Buffer.from(pngBytes(width, height)).toString('base64')}`;
}

function successfulFetchMock() {
  const png = pngBytes(768, 1024);
  return vi.fn()
    // Provider selection readiness probe.
    .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
    .mockResolvedValueOnce(cfEnvelope([]))
    .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
    // Generation repeats the free-plan proof immediately before inference.
    .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
    .mockResolvedValueOnce(cfEnvelope([]))
    .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
    .mockResolvedValueOnce(cfEnvelope(Buffer.from(png).toString('base64')));
}

function semanticFetchMock(passed = true, criticFailure?: Response) {
  const png = pngBytes(768, 1024);
  const answer = passed
    ? {
        promptAdherence: 4,
        composition: 4,
        subjectIntegrity: 4,
        styleExecution: 3.5,
        textHandling: 4,
        artifactControl: 4,
        professionalUsefulness: 4,
        safetyPassed: true,
        safetyIssues: [],
        criticalIssues: [],
        summary: 'Professional and faithful.',
      }
    : {
        promptAdherence: 2,
        composition: 3,
        subjectIntegrity: 2,
        styleExecution: 3,
        textHandling: 3,
        artifactControl: 3,
        professionalUsefulness: 2,
        safetyPassed: true,
        safetyIssues: [],
        criticalIssues: ['Requested subject is materially wrong.'],
        summary: 'Not faithful enough for delivery.',
      };
  return vi.fn()
    // Provider selection readiness probe.
    .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
    .mockResolvedValueOnce(cfEnvelope([]))
    .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
    // Generation proof and image inference.
    .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
    .mockResolvedValueOnce(cfEnvelope([]))
    .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
    .mockResolvedValueOnce(cfEnvelope(Buffer.from(png).toString('base64')))
    // Semantic critic's independent readiness proof and inference.
    .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
    .mockResolvedValueOnce(cfEnvelope([]))
    .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
    .mockResolvedValueOnce(criticFailure ?? cfEnvelope({ answer: JSON.stringify(answer) }));
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
    expect(legacy.body.code).toBe('NO_VERIFIED_ZERO_COST_PROVIDER_READY');
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

  it('routes a validated reference edit through the same verified Free provider', async () => {
    const fetchMock = semanticFetchMock(true);
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/edit')
      .send({
        prompt: '画像0の被写体は保ち、背景だけを夜の高級ホテルに変更してください',
        width: 768,
        height: 1024,
        referenceImages: [referenceDataUrl()],
      });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-task']).toBe('edit');
    expect(response.headers['x-origin-visual-reference-count']).toBe('1');
    expect(response.headers['x-origin-visual-provider']).toBe('cloudflare-workers-ai-free');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBeUndefined();
    expect(response.headers['x-origin-cost-evidence']).toBe('free-allocation-preflight-only; per-request-usage-unverified');
    expect(response.headers['x-origin-paid-fallback']).toBe('false');
    expect(fetchMock).toHaveBeenCalledTimes(11);

    const form = fetchMock.mock.calls[6]?.[1]?.body as FormData;
    expect(form.get('input_image_0')).toBeInstanceOf(Blob);
    expect(String(form.get('prompt'))).toContain('Preserve subjects');
  });

  it('returns structurally verified raster bytes with unverified request-cost evidence through the production-compatible route', async () => {
    const fetchMock = semanticFetchMock(true);
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['x-origin-visual-verified']).toBe('true');
    expect(response.headers['x-origin-visual-task']).toBe('generate');
    expect(response.headers['x-origin-visual-reference-count']).toBe('0');
    expect(response.headers['x-origin-visual-provider']).toBe('cloudflare-workers-ai-free');
    expect(response.headers['x-origin-visual-model']).toBe('@cf/black-forest-labs/flux-2-klein-4b');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBeUndefined();
    expect(response.headers['x-origin-cost-evidence']).toBe('free-allocation-preflight-only; per-request-usage-unverified');
    expect(response.headers['x-origin-paid-fallback']).toBe('false');
    expect(response.headers['x-origin-external-network']).toBe('true');
    expect(response.headers['x-origin-external-network-requests']).toBe('11');
    expect(response.headers['x-origin-secret-delivery']).toBe('server-only');
    expect(response.headers['x-origin-visual-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers['x-origin-visual-generation-id']).toMatch(/^raster-[a-f0-9]{24}$/);
    expect(response.headers['x-origin-visual-brain']).toBe('visual-brain-v1');
    expect(response.headers['x-origin-visual-plan']).toBe('raster-visual-plan-v1');
    expect(response.headers['x-origin-visual-plan-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers['x-origin-visual-purpose']).toBe('photograph');
    expect(response.headers['x-origin-visual-template']).toBe('custom-size');
    expect(response.headers['x-origin-visual-safe-margin-pct']).toBe('7');
    expect(response.headers['x-origin-visual-typography-zone']).toBe('bottom');
    expect(response.headers['x-origin-visual-critic']).toBe('raster-structural-critic-v1');
    expect(response.headers['x-origin-visual-quality-score']).toBe('100');
    expect(response.headers['x-origin-visual-actual-width']).toBe('768');
    expect(response.headers['x-origin-visual-actual-height']).toBe('1024');
    expect(response.headers['x-origin-visual-typography-overlay']).toBe('not-required');
    expect(response.headers['x-origin-visual-candidate-policy']).toBe('raster-candidate-policy-v1');
    expect(response.headers['x-origin-visual-candidates-recommended']).toBe('1');
    expect(response.headers['x-origin-visual-candidates-active']).toBe('1');
    expect(response.headers['x-origin-visual-best-of-n']).toBe('false');
    expect(response.headers['x-origin-visual-width']).toBe('768');
    expect(response.headers['x-origin-visual-height']).toBe('1024');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(11);

    const providerRequest = fetchMock.mock.calls[6]?.[1] as RequestInit;
    const authorization = new Headers(providerRequest.headers).get('authorization');
    expect(authorization).toBe(`Bearer test-${'x'.repeat(40)}`);
    expect(String(fetchMock.mock.calls[6]?.[0])).toContain('/ai/run/@cf/black-forest-labs/flux-2-klein-4b');
    expect(providerRequest.body).toBeInstanceOf(FormData);
    const providerBody = providerRequest.body as FormData;
    expect(String(providerBody.get('prompt'))).toContain('Create a polished production-quality image');
    expect(String(providerBody.get('width'))).toBe('768');
    expect(String(providerBody.get('height'))).toBe('1024');
    expect(new Headers(providerRequest.headers).get('content-type')).toBeNull();
  });

  it.each([3036, 3040])('switches to a separately verified free provider after documented Cloudflare pre-inference rejection %s', async (internalCode) => {
    const freeModel = {
      name: 'tomdacatto/sana', category: 'image', title: 'Sana Sprint (Free)',
      description: 'Free image model', community: true,
      pricing: { currency: 'pollen' }, paid_only: false,
      input_modalities: ['text'], output_modalities: ['image'],
    };
    const scopedKeyInfo = {
      valid: true, type: 'secret',
      permissions: { models: ['tomdacatto/sana'] },
      pollenBudget: 5,
      questPollenOnly: true,
    };
    const fetchMock = vi.fn()
      // Cloudflare selection and immediate pre-inference recheck.
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(cfFailure(429, internalCode))
      // Pollinations status preflight.
      .mockResolvedValueOnce(json(scopedKeyInfo))
      .mockResolvedValueOnce(json([freeModel]))
      // Pollinations rechecks its scoped key/model, records a baseline,
      // generates once, and reconciles the exact new zero-cost usage row.
      .mockResolvedValueOnce(json(scopedKeyInfo))
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'baseline' }] }))
      .mockResolvedValueOnce(imageJson(pngBytes(768, 1024)))
      .mockResolvedValueOnce(json({ usage: [{
        cursor_event_id: 'generated-after-fallback',
        type: 'generate.image',
        model: 'tomdacatto/sana',
        meter_source: 'tier',
        cost_usd: 0,
        output_image_tokens: 1,
      }] }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      ...CF_ENV,
      POLLINATIONS_API_KEY: 'test-pollinations-key',
    }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-provider']).toBe('pollinations-zero-cost');
    expect(response.headers['x-origin-cost-evidence']).toBe('free-allocation-preflight-only; per-request-usage-unverified');
    expect(response.headers['x-origin-visual-semantic-gate']).toBe('skipped');
    expect(response.headers['x-origin-visual-semantic-verified']).toBeUndefined();
    expect(response.headers['x-origin-cost-usd']).toBeUndefined();
    expect(response.headers['x-origin-paid-fallback']).toBe('false');
    expect(response.headers['x-origin-external-network-requests']).toBe('14');
    expect(fetchMock).toHaveBeenCalledTimes(14);
  });

  it('does not switch providers after an ambiguous Cloudflare inference failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(cfFailure(500, 1001));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ ...CF_ENV, POLLINATIONS_API_KEY: 'test-pollinations-key' }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(502);
    expect(response.body.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/account/key'))).toBe(false);
  });

  it('marks uncorrelated post-generation usage evidence non-retryable', async () => {
    const freeModel = {
      name: 'tomdacatto/sana', category: 'image', title: 'Sana Sprint (Free)',
      description: 'Free image model', community: true,
      pricing: { currency: 'pollen' }, paid_only: false,
      input_modalities: ['text'], output_modalities: ['image'],
    };
    const scopedKeyInfo = {
      valid: true, type: 'secret',
      permissions: { models: ['tomdacatto/sana'] },
      pollenBudget: 5,
      questPollenOnly: true,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(scopedKeyInfo))
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json(scopedKeyInfo))
      .mockResolvedValueOnce(json([freeModel]))
      .mockResolvedValueOnce(json({ usage: [{ cursor_event_id: 'baseline-1' }] }))
      .mockResolvedValueOnce(imageJson(pngBytes(768, 1024)))
      .mockResolvedValueOnce(json({ usage: [
        { cursor_event_id: 'new-event-a', type: 'generate.image', model: 'tomdacatto/sana', meter_source: 'tier', cost_usd: 0, output_image_tokens: 1 },
        { cursor_event_id: 'new-event-b', type: 'generate.image', model: 'tomdacatto/sana', meter_source: 'tier', cost_usd: 0, output_image_tokens: 1 },
      ] }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ POLLINATIONS_API_KEY: 'test-pollinations-key' }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ZERO_COST_USAGE_NOT_VERIFIED');
    expect(response.body.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it.each([
    [3036, 429, 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED', false, '無料枠を使い切った'],
    [3040, 503, 'CLOUDFLARE_WORKERS_AI_CAPACITY_UNAVAILABLE', true, '一時的に混雑'],
    [5035, 503, 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN', false, '有料プランが必要'],
  ] as const)('returns truthful safe API semantics for Cloudflare code %s', async (internalCode, expectedStatus, expectedCode, retryable, messagePart) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(cfFailure(internalCode === 5035 ? 403 : 429, internalCode));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(expectedStatus);
    expect(response.body).toMatchObject({
      ok: false,
      code: expectedCode,
      retryable,
      freeOnly: true,
      paidFallbackUsed: false,
      secretDelivery: 'server-only',
    });
    expect(response.body.message).toContain(messagePart);
    expect(response.body.costUsd).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('runs the semantic delivery gate by default and returns only a passing image', async () => {
    const fetchMock = semanticFetchMock(true);
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-semantic-gate']).toBe('passed');
    expect(response.headers['x-origin-visual-semantic-verified']).toBe('true');
    expect(response.headers['x-origin-visual-semantic-critic']).toBe('raster-semantic-critic-v1');
    expect(Number(response.headers['x-origin-visual-semantic-score'])).toBeGreaterThanOrEqual(88);
    expect(response.headers['x-origin-external-network-requests']).toBe('11');
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it('allows an explicit semantic-gate opt-out only for controlled diagnostics', async () => {
    const fetchMock = successfulFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app({ ...CF_ENV, ORIGIN_RASTER_SEMANTIC_DELIVERY_GATE: 'false' }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });
    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-semantic-gate']).toBe('disabled');
    expect(response.headers['x-origin-structural-verified']).toBe('true');
    expect(response.headers['x-origin-visual-verified']).toBeUndefined();
    expect(response.headers['x-origin-visual-semantic-verified']).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('returns the generated image and marks semantic critic skipped after critic transport failure', async () => {
    const fetchMock = semanticFetchMock(true, cfFailure(500, 1001));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      ...CF_ENV,
      ORIGIN_RASTER_SEMANTIC_DELIVERY_GATE: 'true',
    }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-semantic-gate']).toBe('skipped');
    expect(response.headers['x-origin-visual-semantic-verified']).toBeUndefined();
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it('returns a structurally valid image with an explicit semantic quality rejection state', async () => {
    const fetchMock = semanticFetchMock(false);
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      ...CF_ENV,
      ORIGIN_RASTER_SEMANTIC_DELIVERY_GATE: 'true',
    }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-semantic-gate']).toBe('rejected');
    expect(response.headers['x-origin-visual-semantic-verified']).toBeUndefined();
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(11);
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

  it('marks an ambiguous lost generation response non-retryable and never switches providers', async () => {
    const fetchMock = vi.fn()
      // Provider selection readiness probe.
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      // Provider re-check immediately before inference.
      .mockResolvedValueOnce(cfEnvelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(cfEnvelope([]))
      .mockResolvedValueOnce(cfEnvelope({ input: {}, output: {} }))
      // The request may have reached the provider, but the response is lost.
      .mockRejectedValueOnce(new Error('socket reset after request dispatch'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      ...CF_ENV,
      POLLINATIONS_API_KEY: 'test-pollinations-key',
    }))
      .post('/api/generate-image')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(502);
    expect(response.body.retryable).toBe(false);
    expect(response.body.message).toContain('自動再試行を停止');
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('gen.pollinations.ai'))).toBe(false);
  });

});
