import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createImageGatewayEvalPreflightRouter } from './imageGatewayEvalPreflightRouter';

function app(env: NodeJS.ProcessEnv) {
  const instance = express();
  instance.use(createImageGatewayEvalPreflightRouter(env));
  return instance;
}

const MODELS = [
  'bytedance/seedream-5.0-pro',
  'bytedance/seedream-5.0-lite',
  'recraft/recraft-v4.1',
  'recraft/recraft-v4',
  'bfl/flux-pro-1.1',
];

describe('imageGatewayEvalPreflightRouter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is unavailable in production', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app({
      VERCEL_ENV: 'production',
      VERCEL_OIDC_TOKEN: 'token',
    })).get('/api/eval/image-gateway/credits');
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed in preview without Vercel OIDC', async () => {
    const response = await request(app({ VERCEL_ENV: 'preview' }))
      .get('/api/eval/image-gateway/credits');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('VERCEL_OIDC_TOKEN_NOT_AVAILABLE');
  });

  it('verifies credits and required image models without generating an image', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        balance: 10,
        total_spent: 2.5,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: MODELS.map((id) => ({ id })),
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({
      VERCEL_ENV: 'preview',
      VERCEL_OIDC_TOKEN: 'oidc-token',
    })).get('/api/eval/image-gateway/credits');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.oidcAuthenticated).toBe(true);
    expect(response.body.allRequiredModelsAvailable).toBe(true);
    expect(response.body.hardEvaluationCapUsd).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/credits');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/v1/models');
  });
});
