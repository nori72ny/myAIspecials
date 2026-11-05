import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createImageGatewayEvalPreflightRouter } from './imageGatewayEvalPreflightRouter';

function app() {
  const instance = express();
  instance.use(createImageGatewayEvalPreflightRouter());
  return instance;
}

describe('imageGatewayEvalPreflightRouter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['free production', { FREE_ONLY: 'true', VERCEL_ENV: 'production' }],
    ['free preview', { FREE_ONLY: 'true', VERCEL_ENV: 'preview' }],
    ['misconfigured preview', { FREE_ONLY: 'false', VERCEL_ENV: 'preview' }],
    ['unset environment', {}],
  ])('permanently disables paid gateway evaluation for %s', async (_label, _env) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app()).get('/api/eval/image-gateway/credits');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('EVAL_ROUTE_NOT_AVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
