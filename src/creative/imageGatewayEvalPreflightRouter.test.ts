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

  it('reports model readiness and whether at least $6 is funded without generating an image', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        balance: '10',
        total_used: '2.5',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: MODELS.map((id) => ({ id })),
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ VERCEL_ENV: 'preview' }))
      .get('/api/eval/image-gateway/credits')
      .set('x-vercel-oidc-token', 'oidc-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      previewOnly: true,
      oidcAuthenticated: true,
      allRequiredModelsAvailable: true,
      fundedForEvaluation: true,
      minimumEvaluationBalanceUsd: 6,
      hardEvaluationCapUsd: 6,
      publicationEffect: 'none',
    });
    expect(response.body.credits).toEqual({ balanceUsd: 10, totalUsedUsd: 2.5 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports an unfunded evaluation when gateway balance is below the hard round cap', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: '0', total_used: '0' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: MODELS.map((id) => ({ id })) }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app({ VERCEL_ENV: 'preview' }))
      .get('/api/eval/image-gateway/credits')
      .set('x-vercel-oidc-token', 'oidc-token');

    expect(response.status).toBe(200);
    expect(response.body.fundedForEvaluation).toBe(false);
    expect(response.body.credits.balanceUsd).toBe(0);
  });
});
