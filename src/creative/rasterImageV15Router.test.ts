import { createHash } from 'node:crypto';

import express from 'express';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRasterImageV15Router } from './rasterImageV15Router';
import { planRasterVisualRequestV15 } from './rasterVisualPlannerV15';

const CF_ENV: NodeJS.ProcessEnv = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: `test-${'x'.repeat(40)}`,
};

function cfEnvelope(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    success: status >= 200 && status < 300,
    result,
    // v2 plan proof requires a verifiably complete subscriptions read.
    ...(Array.isArray(result) ? {
      result_info: { count: result.length, page: 1, per_page: 20, total_count: result.length },
    } : {}),
    errors: [],
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

function referenceDataUrl(width = 320, height = 240): string {
  return `data:image/png;base64,${Buffer.from(pngBytes(width, height)).toString('base64')}`;
}

function parseBinaryBody(res: SupertestResponse, callback: (err: Error, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null!, Buffer.concat(chunks)));
  res.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
}

// The App.tsx success gate, reproduced condition by condition (the
// conjunction that throws 'unverified-raster-response', plus the body
// digest comparison that follows it). This is the cross-boundary
// regression guard for IMAGE_DELIVERY_TRIAGE_2026-11-13: the router's
// real success response must pass every condition the client enforces,
// so a contract drift on either side fails CI instead of production.
function clientRasterContractFailures(
  headers: Record<string, string | undefined>,
  body: Buffer,
  options: { referenceEdit?: boolean } = {},
): string[] {
  const failures: string[] = [];
  const check = (label: string, passed: boolean) => { if (!passed) failures.push(label); };
  const mimeType = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const sha256 = headers['x-origin-visual-sha256'] ?? '';
  const providerId = headers['x-origin-visual-provider'] ?? '';
  const model = headers['x-origin-visual-model'] ?? '';
  const generationId = headers['x-origin-visual-generation-id'] ?? '';
  const visualBrainVersion = headers['x-origin-visual-brain'] ?? '';
  const visualPlan = headers['x-origin-visual-plan'] ?? '';
  const visualPlanSha256 = headers['x-origin-visual-plan-sha256'] ?? '';
  const purpose = headers['x-origin-visual-purpose'] ?? '';
  const typographyOverlay = headers['x-origin-visual-typography-overlay'] ?? '';
  const sourceCriticVersion = headers['x-origin-visual-critic'] ?? '';
  const sourceQualityScore = Number(headers['x-origin-visual-quality-score'] ?? '0');
  const sourceActualWidth = Number(headers['x-origin-visual-actual-width'] ?? '0');
  const sourceActualHeight = Number(headers['x-origin-visual-actual-height'] ?? '0');
  const width = Number(headers['x-origin-visual-width'] ?? '0');
  const height = Number(headers['x-origin-visual-height'] ?? '0');
  const cost = headers['x-origin-cost-usd'];
  const freeOnly = headers['x-origin-free-only'];
  const paidFallback = headers['x-origin-paid-fallback'];
  const secretDelivery = headers['x-origin-secret-delivery'];
  const providerTask = headers['x-origin-visual-task'];
  const referenceCount = headers['x-origin-visual-reference-count'];
  const expectsReferenceEdit = Boolean(options.referenceEdit);
  check('mimeType', ['image/png', 'image/jpeg', 'image/webp'].includes(mimeType));
  check('sha256', /^[a-f0-9]{64}$/i.test(sha256));
  check('providerId', providerId === 'pollinations-zero-cost' || providerId === 'cloudflare-workers-ai-free');
  check('model', Boolean(model));
  check('generationId', /^raster-[a-f0-9]{24}$/i.test(generationId));
  check('visualBrainVersion', visualBrainVersion === 'visual-brain-v1');
  check('visualPlan', visualPlan === 'raster-visual-plan-v1');
  check('visualPlanSha256', /^[a-f0-9]{64}$/i.test(visualPlanSha256));
  check('purpose', /^[a-z-]{1,40}$/.test(purpose));
  check('typographyOverlay', typographyOverlay === 'recommended' || typographyOverlay === 'not-required');
  check('sourceCriticVersion', sourceCriticVersion === 'raster-structural-critic-v1');
  check('sourceQualityScore', sourceQualityScore === 100);
  check('sourceActualWidth', sourceActualWidth === width);
  check('sourceActualHeight', sourceActualHeight === height);
  check('width', Number.isInteger(width) && width >= 256 && width <= 1536);
  check('height', Number.isInteger(height) && height >= 256 && height <= 1536);
  check('cost', cost === '0');
  check('freeOnly', freeOnly === 'true');
  check('paidFallback', paidFallback === 'false');
  check('secretDelivery', secretDelivery === 'server-only');
  check('providerTask', expectsReferenceEdit
    ? providerTask === 'edit' && referenceCount === '1'
    : providerTask === undefined || providerTask === 'generate');
  check('bodyDigest', createHash('sha256').update(body).digest('hex') === sha256.toLowerCase());
  return failures;
}

const DEFECT_FREE_CRITIC_ANSWER = JSON.stringify({
  promptAdherence: [],
  composition: [],
  subjectIntegrity: [],
  styleExecution: [],
  textHandling: [],
  artifactControl: [],
  professionalUsefulness: [],
  safetyPassed: true,
  safetyIssues: [],
  summary: '依頼どおりの画像です。',
});

// Stubs the Cloudflare Free proof pipeline exactly as the delivery tests
// below need it: plan proof reads, a usage aggregate, image runs that
// return the given bytes, and a defect-free semantic critic.
function stubSuccessfulCloudflarePipeline(
  state: { usedNeurons: number; imageRuns: number },
  image: Uint8Array,
) {
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
              aiInferenceAdaptiveGroups: [{ count: 1, sum: { totalNeurons: state.usedNeurons } }],
            }],
          },
        },
      });
    }
    if (target.includes('/ai/run/@cf/black-forest-labs/flux-2-klein-4b')) {
      state.imageRuns += 1;
      state.usedNeurons += 140;
      return cfEnvelope(Buffer.from(image).toString('base64'));
    }
    if (target.includes('/ai/run/@cf/moondream/')) return cfEnvelope({ answer: DEFECT_FREE_CRITIC_ANSWER });
    throw new Error(`unexpected fetch: ${target}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
      activeCandidates: 2,
      bestOfNEnabled: true,
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
    stubSuccessfulCloudflarePipeline(state, pngBytes(768, 1024));

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 })
      .buffer(true)
      .parse(parseBinaryBody);

    // Binary contract (IMAGE_DELIVERY_TRIAGE_2026-11-13): the success
    // response is the image bytes themselves, with the delivery evidence
    // carried in headers. Usage reconciliation detail stays observable on
    // the failure path (see the reconciliation test below); a 200 here
    // already proves the post-generation reconciliation passed.
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toContain('filename="origin-image.png"');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.equals(Buffer.from(pngBytes(768, 1024)))).toBe(true);
    expect(response.headers).toMatchObject({
      'x-origin-structural-verified': 'true',
      'x-origin-visual-verified': 'true',
      'x-origin-visual-brain': 'visual-brain-v1',
      'x-origin-visual-plan': 'raster-visual-plan-v1',
      'x-origin-visual-critic': 'raster-structural-critic-v1',
      'x-origin-visual-quality-score': '100',
      'x-origin-visual-width': '768',
      'x-origin-visual-height': '1024',
      'x-origin-visual-actual-width': '768',
      'x-origin-visual-actual-height': '1024',
      'x-origin-visual-task': 'generate',
      'x-origin-visual-reference-count': '0',
      'x-origin-visual-provider': 'cloudflare-workers-ai-free',
      'x-origin-visual-model': '@cf/black-forest-labs/flux-2-klein-4b',
      'x-origin-cost-usd': '0',
      'x-origin-free-only': 'true',
      'x-origin-paid-fallback': 'false',
      'x-origin-secret-delivery': 'server-only',
    });
    const plan = planRasterVisualRequestV15('静かな湖と朝焼け', { width: 768, height: 1024 });
    expect(response.headers['x-origin-visual-purpose']).toBe(plan.purpose);
    expect(response.headers['x-origin-visual-typography-overlay'])
      .toBe(plan.requiresDeterministicTypography ? 'recommended' : 'not-required');
    expect(response.headers['x-origin-visual-plan-sha256'])
      .toBe(createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
    expect(response.headers['x-origin-visual-sha256'])
      .toBe(createHash('sha256').update(response.body).digest('hex'));
    expect(response.headers['x-origin-visual-generation-id'])
      .toBe(`raster-${(response.headers['x-origin-visual-sha256'] ?? '').slice(0, 24)}`);
    expect(clientRasterContractFailures(response.headers, response.body)).toEqual([]);
    // Two candidates are the standard policy for every prompt.
    expect(state.imageRuns).toBe(2);
  });

  it('delivers a binary success the app client accepts for the production blue-bird plan shape', async () => {
    // Cross-boundary regression for IMAGE_DELIVERY_TRIAGE_2026-11-13: in
    // production (2026-11-13) this exact request — the image sheet's
    // default 1024x1024 for 「青い鳥」 — returned 200 yet the app showed
    // only the generic failure message, because the JSON success shape
    // failed the client's binary verification. The real router response
    // must now pass every client condition for this plan shape
    // (purpose 'photograph', typography 'not-required').
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T12:00:00.000Z'));
    const state = { usedNeurons: 100, imageRuns: 0 };
    stubSuccessfulCloudflarePipeline(state, pngBytes(1024, 1024));

    const plan = planRasterVisualRequestV15('青い鳥', { width: 1024, height: 1024 });
    expect(plan.ready).toBe(true);
    expect(plan.purpose).toBe('photograph');
    expect(plan.requiresDeterministicTypography).toBe(false);

    const response = await request(app(CF_ENV))
      .post('/api/generate-image')
      .send({ prompt: '青い鳥', width: 1024, height: 1024 })
      .buffer(true)
      .parse(parseBinaryBody);

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-purpose']).toBe('photograph');
    expect(response.headers['x-origin-visual-typography-overlay']).toBe('not-required');
    expect(clientRasterContractFailures(response.headers, response.body)).toEqual([]);
  });

  it('includes the observed usage snapshot when reconciliation fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
    const state = { usedNeurons: 100, imageRuns: 0 };
    const criticAnswer = JSON.stringify({
      promptAdherence: [],
      composition: [],
      subjectIntegrity: [],
      styleExecution: [],
      textHandling: [],
      artifactControl: [],
      professionalUsefulness: [],
      safetyPassed: true,
      safetyIssues: [],
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
                aiInferenceAdaptiveGroups: [{ count: 1, sum: { totalNeurons: state.usedNeurons } }],
              }],
            },
          },
        });
      }
      if (target.includes('/ai/run/@cf/black-forest-labs/flux-2-klein-4b')) {
        state.imageRuns += 1;
        // A backlog-sized jump lands inside this request's window, and no
        // call of this request reported its own usage, so neither evidence
        // can attribute the consumption and the image is withheld.
        state.usedNeurons += 5_000;
        return cfEnvelope(Buffer.from(pngBytes(768, 1024)).toString('base64'));
      }
      if (target.includes('/ai/run/@cf/moondream/')) return cfEnvelope({ answer: criticAnswer });
      throw new Error(`unexpected fetch: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(CF_ENV))
      .post('/api/creative/v1.5/raster/generate')
      .send({ prompt: '静かな湖と朝焼け', width: 768, height: 1024 });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ok: false,
      code: 'CLOUDFLARE_USAGE_RECONCILIATION_FAILED',
      freeOnly: true,
      paidFallbackUsed: false,
      retryable: false,
    });
    // The failure is diagnosable from the response alone: what the request
    // started from, what the aggregate showed, and that no per-request
    // usage reports were available to attribute the consumption.
    expect(response.body.usage).toMatchObject({
      allocationNeurons: 10_000,
      usedBeforeNeurons: 100,
      reservedNeurons: 1_146,
      candidatesPlanned: 2,
      candidatesGenerated: 2,
      observedDeltaNeurons: 10_000,
      usedAfterNeurons: 10_100,
      reconciliationMethod: null,
      reportedNeurons: null,
      reconciliationReason: 'per-request-usage-incomplete',
    });
    // The diagnostics also name which calls reported nothing, per
    // candidate: both generation calls and both semantic-critic calls.
    expect(response.body.usage.unreportedCalls).toEqual([
      { candidateIndex: 0, retried: false, call: 'generation' },
      { candidateIndex: 0, retried: false, call: 'semantic-critic' },
      { candidateIndex: 1, retried: false, call: 'generation' },
      { candidateIndex: 1, retried: false, call: 'semantic-critic' },
    ]);
    expect(state.imageRuns).toBe(2);
  });

  it('runs best-of-2 candidate selection for quality-critical purposes within the quota reserve', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-06T12:00:00.000Z'));
    const state = { usedNeurons: 100, imageRuns: 0 };
    // Defect-list contract: candidate 0 carries one defect on each of
    // three axes (derived 3,3,3,4,4,4,4 -> score 89); candidate 1 is
    // defect-free (derived all 4 -> score 100).
    const criticAnswer = (defects: Record<string, string[]>) => JSON.stringify({
      promptAdherence: [], composition: [], subjectIntegrity: [], styleExecution: [],
      textHandling: [], artifactControl: [], professionalUsefulness: [],
      ...defects,
      safetyPassed: true, safetyIssues: [], summary: '評価済みです。',
    });
    const criticAnswers = [
      criticAnswer({
        promptAdherence: ['依頼とわずかに異なる要素があります'],
        composition: ['主体がわずかに中心からずれています'],
        subjectIntegrity: ['輪郭の一部がわずかに歪んでいます'],
      }),
      criticAnswer({}),
    ];
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
                aiInferenceAdaptiveGroups: [{ count: 1, sum: { totalNeurons: state.usedNeurons } }],
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
      .send({ prompt: '高級で未来的なORIGINのスマホ広告画像を作ってください', width: 768, height: 1024 })
      .buffer(true)
      .parse(parseBinaryBody);

    expect(response.status).toBe(200);
    // Binary contract: the selected candidate's bytes are the body, and
    // the plan purpose travels in the evidence headers. (Candidate
    // selection internals — scores, selected index — are pipeline state,
    // covered by the generation module's own tests; the wire contract is
    // what this router test pins.)
    expect(response.headers['x-origin-visual-purpose']).toBe('advertisement');
    expect(response.body.equals(Buffer.from(pngBytes(768, 1024)))).toBe(true);
    expect(clientRasterContractFailures(response.headers, response.body)).toEqual([]);
    expect(state.imageRuns).toBe(2);
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
                aiInferenceAdaptiveGroups: [{ count: 40, sum: { totalNeurons: 9_900 } }],
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
