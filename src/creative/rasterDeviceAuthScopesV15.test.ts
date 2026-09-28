import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRasterImageV15Router } from './rasterImageV15Router.js';

const DATA_KEY = Buffer.alloc(32, 9).toString('base64');
const APP_CLIENT_ID = 'pk_ORIGINScopeTest123';
const env: NodeJS.ProcessEnv = {
  ORIGIN_CODING_JOB_DATA_KEY: DATA_KEY,
  ORIGIN_POLLINATIONS_CLIENT_ID: APP_CLIENT_ID,
  APP_URL: 'https://origin.example.com',
};

function app() {
  const instance = express();
  instance.use(express.json({ limit: '64kb' }));
  instance.use(createRasterImageV15Router(env));
  return instance;
}

function cookie(headers: Record<string, unknown>, name: string): string {
  const raw = headers['set-cookie'];
  const values = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  const found = values.find(value => value.startsWith(`${name}=`));
  expect(found).toBeDefined();
  return found!.split(';')[0];
}

async function begin() {
  const response = await request(app()).post('/api/creative/v1.5/raster/connect/start').send({});
  expect(response.status).toBe(200);
  const auth = new URL(response.body.authorizationUri);
  return {
    pending: cookie(response.headers, '__Host-origin-image-device'),
    state: auth.searchParams.get('state')!,
  };
}

describe('raster OAuth scopes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['profile', 'keys'])('rejects a callback token missing usage scope: %s', async (scope) => {
    const started = await begin();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'sk_provider_secret_token',
      token_type: 'bearer',
      expires_in: 3600,
      scope,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const response = await request(app())
      .get('/api/creative/v1.5/raster/connect/callback')
      .set('Cookie', started.pending)
      .query({ code: 'oauth-code', state: started.state });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('https://origin.example.com/?image_connect=invalid');
    const set = Array.isArray(response.headers['set-cookie'])
      ? response.headers['set-cookie'].join('\n')
      : String(response.headers['set-cookie'] ?? '');
    expect(set).toContain('__Host-origin-image-device=;');
    expect(set).not.toContain('__Host-origin-image-token=');
  });

  it.each(['usage', 'profile usage', 'usage,profile'])('accepts a token containing usage scope: %s', async (scope) => {
    const started = await begin();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'sk_provider_secret_token',
      token_type: 'bearer',
      expires_in: 3600,
      scope,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const response = await request(app())
      .get('/api/creative/v1.5/raster/connect/callback')
      .set('Cookie', started.pending)
      .query({ code: 'oauth-code', state: started.state });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('https://origin.example.com/?image_connect=approved');
    expect(cookie(response.headers, '__Host-origin-image-token')).not.toContain('sk_provider_secret_token');
  });
});
