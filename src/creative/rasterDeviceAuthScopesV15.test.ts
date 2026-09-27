import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRasterImageV15Router } from './rasterImageV15Router.js';

const DATA_KEY = Buffer.alloc(32, 9).toString('base64');
const APP_CLIENT_ID = 'pk_ORIGINScopeTest123';
const env: NodeJS.ProcessEnv = {
  ORIGIN_CODING_JOB_DATA_KEY: DATA_KEY,
  ORIGIN_POLLINATIONS_CLIENT_ID: APP_CLIENT_ID,
};

function app() {
  const instance = express();
  instance.use(express.json({ limit: '64kb' }));
  instance.use(createRasterImageV15Router(env));
  return instance;
}

function sealedCookie(headers: Record<string, unknown>, name: string): string {
  const raw = headers['set-cookie'];
  const values = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  const cookie = values.find((value) => value.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0];
}

function controlledNow(initial = Date.UTC(2026, 8, 27, 9, 0, 0)) {
  let current = initial;
  vi.spyOn(Date, 'now').mockImplementation(() => current);
  return { advance: (milliseconds: number) => { current += milliseconds; } };
}

function providerStartResponse() {
  return new Response(JSON.stringify({
    device_code: 'provider-device-secret',
    user_code: 'SCOPE-01',
    verification_uri: '/device',
    expires_in: 600,
    interval: 1,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('raster device authorization scopes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['profile', 'keys'])('rejects a token missing the required usage scope: %s', async (scope) => {
    const clock = controlledNow();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerStartResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'sk_provider_secret_token',
        token_type: 'bearer',
        expires_in: 3600,
        scope,
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const instance = app();
    const start = await request(instance).post('/api/creative/v1.5/raster/connect/start').send({});
    expect(start.status).toBe(200);
    expect(start.body.scope).toBe('usage');
    clock.advance(1_000);

    const complete = await request(instance)
      .post('/api/creative/v1.5/raster/connect/complete')
      .set('Cookie', sealedCookie(start.headers, '__Host-origin-image-device'))
      .send({});

    expect(complete.status).toBe(502);
    expect(complete.body).toEqual({ ok: false, code: 'IMAGE_DEVICE_TOKEN_INVALID' });
    const setCookie = Array.isArray(complete.headers['set-cookie'])
      ? complete.headers['set-cookie'].join('\n')
      : String(complete.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('__Host-origin-image-device=;');
    expect(setCookie).not.toContain('__Host-origin-image-token=');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['usage', 'profile usage', 'usage profile'])('accepts usage scope and preserves additional account scopes: %s', async (scope) => {
    const clock = controlledNow();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerStartResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'sk_provider_secret_token',
        token_type: 'bearer',
        expires_in: 3600,
        scope,
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const instance = app();
    const start = await request(instance).post('/api/creative/v1.5/raster/connect/start').send({});
    expect(start.status).toBe(200);
    expect(start.body.scope).toBe('usage');
    clock.advance(1_000);

    const complete = await request(instance)
      .post('/api/creative/v1.5/raster/connect/complete')
      .set('Cookie', sealedCookie(start.headers, '__Host-origin-image-device'))
      .send({});

    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({
      ok: true,
      connected: true,
      scope,
      secretDelivery: 'server-only',
    });
    expect(sealedCookie(complete.headers, '__Host-origin-image-token')).not.toContain('sk_provider_secret_token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
