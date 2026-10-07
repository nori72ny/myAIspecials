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
    expect(response.body.code).toBe('ZERO_COST_IMAGE_PROVIDER_UNAVAILABLE');
    expect(response.body.freeOnly).toBe(true);
    expect(response.body.costUsd).toBe(0);
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
