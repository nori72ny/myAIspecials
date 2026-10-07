import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createWorldClassImageV16Router } from './worldClassImageV16Router';

const SHA = 'a'.repeat(40);

function app(env: NodeJS.ProcessEnv) {
  const instance = express();
  instance.use(express.json({ limit: '3mb' }));
  instance.use(createWorldClassImageV16Router(env));
  return instance;
}

describe('createWorldClassImageV16Router compatibility', () => {
  it('delegates the legacy V1.6 name to the zero-cost router', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
    })).get('/api/creative/v1.6/world-class/status');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      provider: 'cloudflare-workers-ai-free',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      routingPolicy: 'zero-cost-quality-first-v1',
    });
  });

  it('never revives paid image generation when an OpenRouter key is present', async () => {
    const response = await request(app({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
      OPENROUTER_API_KEY: 'sk-or-test-' + 'x'.repeat(32),
    }))
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級ホテルの広告ビジュアル' });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ZERO_COST_IMAGE_PROVIDER_UNAVAILABLE');
    expect(response.body.freeOnly).toBe(true);
    expect(response.body.costUsd).toBe(0);
  });
});
