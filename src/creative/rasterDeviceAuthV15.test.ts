import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRasterImageV15Router } from './rasterImageV15Router.js';

const DATA_KEY = Buffer.alloc(32, 7).toString('base64');
const env = { ORIGIN_CODING_JOB_DATA_KEY: DATA_KEY };

function app() {
  const instance = express();
  instance.use(express.json({ limit: '64kb' }));
  instance.use(createRasterImageV15Router(env));
  return instance;
}

function setCookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  if (Array.isArray(raw)) return raw.map(String);
  return typeof raw === 'string' ? [raw] : [];
}

// Supertest uses HTTP, so its cookie jar correctly withholds Secure cookies.
// Explicitly transport only the sealed cookie, preserving the production flags.
function sealedCookie(headers: Record<string, unknown>, name: string): string {
  const cookie = setCookies(headers).find(value => value.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  expect(cookie).toContain('; Path=/;');
  expect(cookie).toContain('; HttpOnly; Secure; SameSite=Strict');
  expect(cookie).not.toContain('Domain=');
  return cookie!.split(';')[0];
}

describe('raster device authorization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts device authorization without exposing the provider device code', async () => {
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      device_code: 'provider-device-secret',
      user_code: 'ABCD-1234',
      verification_uri: '/device',
      expires_in: 600,
      interval: 5,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app()).post('/api/creative/v1.5/raster/connect/start').send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      userCode: 'ABCD-1234',
      verificationUri: 'https://enter.pollinations.ai/device',
      scope: 'generate usage',
      secretDelivery: 'server-only',
    });
    expect(JSON.stringify(response.body)).not.toContain('provider-device-secret');
    const cookie = setCookies(response.headers as Record<string, unknown>)[0] ?? '';
    expect(cookie).toContain('__Host-origin-image-device=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('provider-device-secret');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://enter.pollinations.ai/api/device/code');
  });

  it('exchanges the sealed pending code and keeps the access token out of response and plaintext cookies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: 'provider-device-secret',
        user_code: 'ABCD-1234',
        verification_uri: '/device',
        expires_in: 600,
        interval: 5,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'sk_provider_secret_token',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'generate usage',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const agent = request.agent(app());
    const start = await agent.post('/api/creative/v1.5/raster/connect/start').send({});
    expect(start.status).toBe(200);

    const complete = await agent.post('/api/creative/v1.5/raster/connect/complete')
      .set('Cookie', sealedCookie(start.headers, '__Host-origin-image-device')).send({});
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ ok: true, connected: true, secretDelivery: 'server-only' });
    expect(JSON.stringify(complete.body)).not.toContain('sk_provider_secret_token');
    const cookies = setCookies(complete.headers as Record<string, unknown>);
    expect(cookies.some((value: string) => value.includes('__Host-origin-image-token='))).toBe(true);
    expect(cookies.join('\n')).not.toContain('sk_provider_secret_token');

    const status = await agent.get('/api/creative/v1.5/raster/connect/status')
      .set('Cookie', sealedCookie(complete.headers, '__Host-origin-image-token'));
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ connected: true, mode: 'device-cookie', deviceAuthReady: true });
  });

  it('reports authorization_pending without clearing the pending session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: 'provider-device-secret',
        user_code: 'ABCD-1234',
        verification_uri: '/device',
        expires_in: 600,
        interval: 5,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'authorization_pending',
      }), { status: 400, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const agent = request.agent(app());
    const start = await agent.post('/api/creative/v1.5/raster/connect/start').send({});
    expect(start.status).toBe(200);
    const complete = await agent.post('/api/creative/v1.5/raster/connect/complete')
      .set('Cookie', sealedCookie(start.headers, '__Host-origin-image-device')).send({});
    expect(complete.status).toBe(202);
    expect(complete.body).toMatchObject({ pending: true, code: 'authorization_pending', interval: 5 });
    expect(setCookies(complete.headers)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['access_denied', 'expired_token'])('clears pending state after %s without issuing a token', async (error) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: 'provider-device-secret', user_code: 'ABCD-1234',
        verification_uri: '/device', expires_in: 600, interval: 5,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const instance = app();
    const start = await request(instance).post('/api/creative/v1.5/raster/connect/start').send({});
    const complete = await request(instance).post('/api/creative/v1.5/raster/connect/complete')
      .set('Cookie', sealedCookie(start.headers, '__Host-origin-image-device')).send({});
    expect(complete.status).toBe(409);
    expect(complete.body.code).toBe('IMAGE_DEVICE_AUTH_DENIED');
    const cookies = setCookies(complete.headers);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('__Host-origin-image-device=;');
    expect(cookies[0]).toContain('Max-Age=0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a tampered pending cookie before contacting the provider', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      device_code: 'provider-device-secret', user_code: 'ABCD-1234',
      verification_uri: '/device', expires_in: 600, interval: 5,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const instance = app();
    const start = await request(instance).post('/api/creative/v1.5/raster/connect/start').send({});
    const cookie = sealedCookie(start.headers, '__Host-origin-image-device');
    const parts = cookie.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    const complete = await request(instance).post('/api/creative/v1.5/raster/connect/complete')
      .set('Cookie', parts.join('.')).send({});
    expect(complete.status).toBe(409);
    expect(complete.body.code).toBe('IMAGE_DEVICE_AUTH_EXPIRED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects by expiring both sealed cookies', async () => {
    const response = await request(app()).post('/api/creative/v1.5/raster/connect/disconnect').send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, connected: false });
    const cookies = setCookies(response.headers as Record<string, unknown>);
    expect(cookies.join('\n')).toContain('__Host-origin-image-token=');
    expect(cookies.join('\n')).toContain('Max-Age=0');
  });
});
