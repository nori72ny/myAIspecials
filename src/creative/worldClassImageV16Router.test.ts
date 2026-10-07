import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorldClassImageV16Router } from './worldClassImageV16Router';

const SHA = 'a'.repeat(40);
const BASE_ENV: NodeJS.ProcessEnv = {
  OPENROUTER_API_KEY: 'sk-or-test-' + 'x'.repeat(32),
  ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'true',
  ORIGIN_IMAGE_WORLD_CLASS_MODEL: 'openai/gpt-image-2.5-sunburst',
  ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
  VERCEL_GIT_COMMIT_SHA: SHA,
};

function app(env: NodeJS.ProcessEnv) {
  const instance = express();
  instance.use(express.json({ limit: '3mb' }));
  instance.use(createWorldClassImageV16Router(env));
  return instance;
}

function pngBytes(): Buffer {
  const bytes = Buffer.alloc(2048, 7);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes, 0);
  return bytes;
}

function modelsResponse(editing = true, onlyModel?: string): Response {
  const ids = onlyModel ? [onlyModel] : [
    'openai/gpt-image-2.5-sunburst',
    'openai/gpt-image-2.5-flare',
    'microsoft/mai-image-2.6',
    'x-ai/grok-imagine-image-2.0',
    'google/gemini-3.1-flash-image',
  ];
  return new Response(JSON.stringify({
    data: ids.map((id) => ({
      id,
      supported_parameters: {
        resolution: { type: 'enum', values: ['1K','2K'] },
        aspect_ratio: { type: 'enum', values: ['1:1','16:9','9:16'] },
        ...(editing ? { input_references: { type: 'range', min: 0, max: 16 } } : {}),
      },
    })),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function generatedResponse(cost = 0.12): Response {
  return new Response(JSON.stringify({
    data: [{ b64_json: pngBytes().toString('base64') }],
    usage: { cost },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('worldClassImageV16Router', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails closed when world-class mode is disabled', async () => {
    const response = await request(app({ ...BASE_ENV, ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'false' }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級ホテルの広告ビジュアル' });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_MODE_DISABLED');
  });

  it('fails closed when the deployed exact SHA is not independently qualified', async () => {
    const response = await request(app({
      ...BASE_ENV,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'b'.repeat(40),
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級ホテルの広告ビジュアル' });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED');
  });

  it('never allows the evaluation bypass in production', async () => {
    const response = await request(app({
      ...BASE_ENV,
      VERCEL_ENV: 'production',
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'b'.repeat(40),
      ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級ホテルの広告ビジュアル' });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED');
  });

  it('labels non-production evaluation output without falsely claiming qualification', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(generatedResponse(0.12));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      ...BASE_ENV,
      VERCEL_ENV: 'preview',
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'b'.repeat(40),
      ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級ホテルの広告ビジュアル' });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-release-sha']).toBe(SHA);
    expect(response.headers['x-origin-world-class-qualified-sha']).toBeUndefined();
    expect(response.headers['x-origin-world-class-evaluation']).toBe('true');
  });

  it('reports ready only when enabled, keyed, provider-ready, and exact-sha qualified', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(modelsResponse());
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app(BASE_ENV)).get('/api/creative/v1.6/world-class/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      ready: true,
      enabled: true,
      qualified: true,
      provider: 'openrouter-image-api',
      model: 'openai/gpt-image-2.5-sunburst',
      providerReady: true,
      publicationPolicy: 'exact-sha-qualified-only',
      freeOnly: false,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });
  });

  it('generates through the frontier model only after capability and exact-sha gates pass', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(generatedResponse(0.12));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(BASE_ENV))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級ホテルの縦型広告、映画的照明、文字なし', width: 1080, height: 1920 });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-provider']).toBe('openrouter-image-api');
    expect(response.headers['x-origin-visual-model']).toBe('openai/gpt-image-2.5-sunburst');
    expect(response.headers['x-origin-visual-routing']).toBe('frontier-auto');
    expect(response.headers['x-origin-visual-prompt-profile']).toBe('text-layout');
    expect(response.headers['x-origin-release-sha']).toBe(SHA);
    expect(response.headers['x-origin-world-class-qualified-sha']).toBe(SHA);
    expect(response.headers['x-origin-world-class-evaluation']).toBeUndefined();
    expect(response.headers['x-origin-cost-usd']).toBe('0.12');
    expect(response.headers['x-origin-free-only']).toBe('false');
    expect(response.headers['x-origin-paid-fallback']).toBe('false');
    expect(response.headers['x-origin-visual-sha256']).toMatch(/^[a-f0-9]{64}$/);

    const call = fetchMock.mock.calls[1];
    expect(String(call?.[0])).toBe('https://openrouter.ai/api/v1/images');
    const payload = JSON.parse(String(call?.[1]?.body));
    expect(payload).toMatchObject({
      model: 'openai/gpt-image-2.5-sunburst',
      n: 1,
      resolution: '1K',
      aspect_ratio: '9:16',
      quality: 'high',
      output_format: 'png',
    });
    expect(payload.prompt).toContain('PRIMARY INSTRUCTION:');
    expect(payload.prompt).toContain('高級ホテルの縦型広告、映画的照明、文字なし');
    expect(payload.prompt).toContain('EXECUTION CONSTRAINTS:');
  });

  it('routes multi-reference editing to MAI-Image-2.6 for stronger controlled composition', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse(true, 'microsoft/mai-image-2.6'))
      .mockResolvedValueOnce(generatedResponse(0.12));
    vi.stubGlobal('fetch', fetchMock);

    const source = `data:image/png;base64,${pngBytes().toString('base64')}`;
    const response = await request(app(BASE_ENV))
      .post('/api/creative/v1.6/world-class/edit')
      .send({ prompt: '人物と商品を維持して背景だけ高級ホテルに変更', referenceImages: [source, source] });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-model']).toBe('microsoft/mai-image-2.6');
    expect(response.headers['x-origin-visual-routing']).toBe('frontier-auto');
    expect(response.headers['x-origin-visual-prompt-profile']).toBe('product-commercial');
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload.model).toBe('microsoft/mai-image-2.6');
    expect(payload.input_references).toHaveLength(2);
  });

  it('allows an explicit approved frontier model without changing the publication gate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse(true, 'x-ai/grok-imagine-image-2.0'))
      .mockResolvedValueOnce(generatedResponse(0.08));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app(BASE_ENV))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '映画的な夜の東京', model: 'x-ai/grok-imagine-image-2.0' });

    expect(response.status).toBe(200);
    expect(response.headers['x-origin-visual-model']).toBe('x-ai/grok-imagine-image-2.0');
    expect(response.headers['x-origin-visual-routing']).toBe('explicit-model');
  });

  it('sends editing references in the OpenRouter image_url object format', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse(true))
      .mockResolvedValueOnce(generatedResponse(0.12));
    vi.stubGlobal('fetch', fetchMock);
    const source = `data:image/png;base64,${pngBytes().toString('base64')}`;
    const response = await request(app(BASE_ENV))
      .post('/api/creative/v1.6/world-class/edit')
      .send({ prompt: '背景だけ夜景に変更', referenceImages: [source] });
    expect(response.status).toBe(200);
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload.input_references).toEqual([{
      type: 'image_url',
      image_url: { url: source },
    }]);
  });

  it('requires verified editing capability before forwarding reference images', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(modelsResponse(false));
    vi.stubGlobal('fetch', fetchMock);

    const source = `data:image/png;base64,${pngBytes().toString('base64')}`;
    const response = await request(app(BASE_ENV))
      .post('/api/creative/v1.6/world-class/edit')
      .send({ prompt: '背景だけ夜景に変更', referenceImages: [source] });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_MODEL_CAPABILITY_UNVERIFIED');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not suggest retrying a provider payment failure or expose its raw body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(new Response('private-provider-billing-detail', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app(BASE_ENV))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '商品広告を作成してください' });
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ ok: false, code: 'OPENROUTER_IMAGE_HTTP_402', retryable: false, paidFallbackUsed: false });
    expect(response.body.message).toContain('管理者');
    expect(JSON.stringify(response.body)).not.toContain('private-provider-billing-detail');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('enforces the configured post-response cost cap', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(generatedResponse(0.4));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      ...BASE_ENV,
      ORIGIN_IMAGE_WORLD_CLASS_MAX_COST_USD: '0.25',
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '商品広告を作成してください' });

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_COST_CAP_EXCEEDED');
  });

  it('blocks sensitive material before any provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app(BASE_ENV))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: 'APIキー sk-abcdefghijklmnopqrstuv をポスターにしてください' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SENSITIVE_INPUT_BLOCKED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
