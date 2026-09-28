import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRasterImageV15Router } from './rasterImageV15Router.js';

const DATA_KEY = Buffer.alloc(32, 7).toString('base64');
const APP_CLIENT_ID = 'pk_ORIGINPersonalTest123';
const env: NodeJS.ProcessEnv = {
  ORIGIN_CODING_JOB_DATA_KEY: DATA_KEY,
  ORIGIN_POLLINATIONS_CLIENT_ID: APP_CLIENT_ID,
  APP_URL: 'https://origin.example.com',
};

function app(runtimeEnv: NodeJS.ProcessEnv = env) {
  const instance = express();
  instance.use(express.json({ limit: '64kb' }));
  instance.use(createRasterImageV15Router(runtimeEnv));
  return instance;
}

function cookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  return Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
}

function cookie(headers: Record<string, unknown>, name: string): string {
  const found = cookies(headers).find(value => value.startsWith(`${name}=`));
  expect(found).toBeDefined();
  return found!.split(';')[0];
}

describe('raster PKCE authorization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails closed unless app id, app URL and encryption key are all configured', async () => {
    for (const runtimeEnv of [
      { ORIGIN_CODING_JOB_DATA_KEY: DATA_KEY, APP_URL: 'https://origin.example.com' },
      { ORIGIN_CODING_JOB_DATA_KEY: DATA_KEY, ORIGIN_POLLINATIONS_CLIENT_ID: APP_CLIENT_ID },
      { APP_URL: 'https://origin.example.com', ORIGIN_POLLINATIONS_CLIENT_ID: APP_CLIENT_ID },
    ]) {
      const status = await request(app(runtimeEnv)).get('/api/creative/v1.5/raster/connect/status');
      expect(status.body.deviceAuthReady).toBe(false);
      const start = await request(app(runtimeEnv)).post('/api/creative/v1.5/raster/connect/start').send({});
      expect(start.status).toBe(503);
    }
  });

  it('creates a PKCE authorization restricted to audited model, zero budget and usage scope', async () => {
    const response = await request(app()).post('/api/creative/v1.5/raster/connect/start').send({});
    expect(response.status).toBe(200);
    const url = new URL(response.body.authorizationUri);
    expect(url.origin).toBe('https://enter.pollinations.ai');
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(APP_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('https://origin.example.com/api/creative/v1.5/raster/connect/callback');
    expect(url.searchParams.get('scope')).toBe('usage');
    expect(url.searchParams.get('models')).toBe('tomdacatto/sana');
    expect(url.searchParams.get('budget')).toBe('0');
    expect(url.searchParams.get('expiry')).toBe('7');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body).toMatchObject({ model: 'tomdacatto/sana', budgetPollen: 0, secretDelivery: 'server-only' });
    const pending = cookies(response.headers as Record<string, unknown>).join('\n');
    expect(pending).toContain('__Host-origin-image-device=');
    expect(pending).toContain('HttpOnly');
    expect(pending).toContain('Secure');
    expect(pending).toContain('SameSite=Strict');
    expect(pending).not.toContain(url.searchParams.get('state') ?? 'impossible');
  });

  it('exchanges callback code server-side and never exposes sk token', async () => {
    const start = await request(app()).post('/api/creative/v1.5/raster/connect/start').send({});
    const auth = new URL(start.body.authorizationUri);
    const state = auth.searchParams.get('state')!;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://enter.pollinations.ai/api/oauth/token');
      expect(init?.method).toBe('POST');
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('client_id')).toBe(APP_CLIENT_ID);
      expect(form.get('redirect_uri')).toBe('https://origin.example.com/api/creative/v1.5/raster/connect/callback');
      expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{64}$/);
      return new Response(JSON.stringify({
        access_token: 'sk_provider_secret_token',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'usage',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const callback = await request(app())
      .get('/api/creative/v1.5/raster/connect/callback')
      .set('Cookie', cookie(start.headers, '__Host-origin-image-device'))
      .query({ code: 'oauth-code', state });

    expect(callback.status).toBe(303);
    expect(callback.headers.location).toBe('https://origin.example.com/?image_connect=approved');
    const set = cookies(callback.headers).join('\n');
    expect(set).toContain('__Host-origin-image-token=');
    expect(set).not.toContain('sk_provider_secret_token');
  });

  it('rejects callback state mismatch before token exchange', async () => {
    const start = await request(app()).post('/api/creative/v1.5/raster/connect/start').send({});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const callback = await request(app())
      .get('/api/creative/v1.5/raster/connect/callback')
      .set('Cookie', cookie(start.headers, '__Host-origin-image-device'))
      .query({ code: 'oauth-code', state: 'wrong-state' });
    expect(callback.status).toBe(303);
    expect(callback.headers.location).toBe('https://origin.example.com/?image_connect=invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disconnects by expiring both auth cookies', async () => {
    const response = await request(app()).post('/api/creative/v1.5/raster/connect/disconnect').send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, connected: false });
    const set = cookies(response.headers as Record<string, unknown>).join('\n');
    expect(set).toContain('__Host-origin-image-token=');
    expect(set).toContain('__Host-origin-image-device=');
    expect(set).toContain('Max-Age=0');
  });
});
