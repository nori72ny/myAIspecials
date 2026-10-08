import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createWorldClassImageZeroCostRouter } from './worldClassImageZeroCostRouter';

const SHA = 'a'.repeat(40);

function app(env: NodeJS.ProcessEnv) {
  const instance = express();
  instance.use(express.json({ limit: '3mb' }));
  instance.use(createWorldClassImageZeroCostRouter(env));
  return instance;
}

describe('worldClassImageZeroCostRouter', () => {
  it('advertises a strict zero-cost production contract even when providers are unconfigured', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
    })).get('/api/creative/v1.6/world-class/status');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ok: false,
      ready: false,
      qualified: true,
      provider: 'cloudflare-workers-ai-free',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      standardFallbackReady: false,
      standardFallbackProvider: null,
      publicationPolicy: 'exact-sha-qualified-only',
      dailyFreeAllocationPolicy: 'fail-closed-on-provider-free-quota-exhaustion',
    });
  });

  it('does not use a paid OpenRouter image key as a fallback', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
      OPENROUTER_API_KEY: 'sk-or-test-' + 'x'.repeat(32),
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高品質な商品広告、文字なし' });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ZERO_COST_WORLD_CLASS_PROVIDER_UNAVAILABLE');
    expect(response.body.freeOnly).toBe(true);
    expect(response.body.costUsd).toBe(0);
    expect(response.body.paidFallbackEnabled).toBe(false);
  });

  it('fails closed when evaluation bypass has no explicit preview or development context', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'b'.repeat(40),
      ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級な商品広告' });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED');
  });

  it.each(['development', 'staging', 'production'] as const)(
    'rejects the evaluation bypass for non-test NODE_ENV=%s on a preview deployment',
    async (nodeEnv) => {
      const response = await request(app({
        VERCEL_GIT_COMMIT_SHA: SHA,
        ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'b'.repeat(40),
        ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
        VERCEL_ENV: 'preview',
        NODE_ENV: nodeEnv,
      }))
        .post('/api/creative/v1.6/world-class/generate')
        .send({ prompt: '写真風の画像' });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED');
    },
  );

  it('requires a valid exact candidate SHA even in a sealed test evaluator', async () => {
    const response = await request(app({
      ORIGIN_RELEASE_SHA: 'invalid-or-missing-sha',
      ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
      NODE_ENV: 'test',
      VERCEL_ENV: 'preview',
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級商品の広告写真' });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED');
  });

  it('rejects the evaluation bypass when the deployment environment is production', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'b'.repeat(40),
      ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
      VERCEL_ENV: 'production',
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級な商品広告' });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED');
  });

  it('never silently substitutes standard quality even with an exactly qualified SHA', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'false',
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '映画的な商品画像' });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ZERO_COST_WORLD_CLASS_PROVIDER_UNAVAILABLE');
    expect(response.headers['x-origin-visual-quality-tier']).toBeUndefined();
    expect(response.body.paidFallbackEnabled).toBe(false);
  });

  it('keeps unqualified Production fail-closed before any provider can run', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'b'.repeat(40),
      OPENROUTER_API_KEY: 'sk-or-test-' + 'x'.repeat(32),
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '東京の夜景' });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED');
    expect(response.body.freeOnly).toBe(true);
  });
});
