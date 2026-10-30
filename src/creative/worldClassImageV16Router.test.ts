import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorldClassImageV16Router } from './worldClassImageV16Router';

function app(env: NodeJS.ProcessEnv) {
  const instance = express();
  instance.use(express.json({ limit: '3mb' }));
  instance.use(createWorldClassImageV16Router(env));
  return instance;
}

describe('worldClassImageV16Router zero-cost boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['missing FREE_ONLY setting', {}],
    ['FREE_ONLY explicitly false', {
      FREE_ONLY: 'false',
      ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'true',
      OPENROUTER_API_KEY: 'sk-or-test-' + 'x'.repeat(32),
    }],
    ['FREE_ONLY true', {
      FREE_ONLY: 'true',
      ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'true',
      OPENROUTER_API_KEY: 'sk-or-test-' + 'x'.repeat(32),
    }],
    ['production with a qualified SHA and key', {
      VERCEL_ENV: 'production',
      FREE_ONLY: 'false',
      ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'true',
      OPENROUTER_API_KEY: 'sk-or-test-' + 'x'.repeat(32),
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: 'a'.repeat(40),
      VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    }],
  ])('blocks status, generation, and editing even with %s', async (_label, env) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const instance = app(env);

    const status = await request(instance).get('/api/creative/v1.6/world-class/status');
    const generate = await request(instance)
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高級ホテルの広告ビジュアル' });
    const edit = await request(instance)
      .post('/api/creative/v1.6/world-class/edit')
      .send({ prompt: '背景を変更', referenceImages: ['data:image/png;base64,QUJDRA=='] });

    for (const response of [status, generate, edit]) {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        ok: false,
        ready: false,
        freeOnly: true,
        paidFallbackEnabled: false,
        code: 'PAID_IMAGE_ROUTE_DISABLED_BY_ZERO_COST_POLICY',
        retryable: false,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
