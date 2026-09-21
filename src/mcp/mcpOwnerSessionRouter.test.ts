// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseMcpOwnerSessionRouter } from './mcpOwnerSessionRouter.js';

const appOrigin = 'https://origin.example.com';
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
const jwt = (sub = owner, sessionId = session) => ['header', Buffer.from(JSON.stringify({ sub, session_id: sessionId })).toString('base64url'), 'signature'].join('.');
const access = jwt();
const rotatedAccess = jwt(owner, '44444444-4444-4444-8444-444444444444');
const refresh = 'v1.fixture-refresh-token';
const rotatedRefresh = 'v1.rotated-refresh-token';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

function tokenResponse(accessToken = access, refreshToken = refresh) {
  return json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer', expires_in: 3600 });
}

function build(fetchImpl: typeof fetch) {
  const app = express();
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use(createSupabaseMcpOwnerSessionRouter({
    appOrigin,
    supabaseUrl: 'https://project.supabase.co/',
    publishableKey: 'publishable-fixture',
    allowedOwnerIds: [owner],
    fetchImpl,
  }));
  return app;
}

function mutation(target: request.Test) {
  return target.set('Origin', appOrigin).set('X-Origin-MCP-Intent', 'manage').set('Content-Type', 'application/json');
}

function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

describe('MCP owner session lifecycle', () => {
  it('logs in only after the issued access token verifies as an allowed owner and never returns tokens in JSON', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/token?grant_type=password')) {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('apikey')).toBe('publishable-fixture');
        expect(JSON.parse(String(init?.body))).toEqual({ email: 'owner@example.com', password: 'fixture-password' });
        return tokenResponse();
      }
      expect(url).toBe('https://project.supabase.co/auth/v1/user');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${access}`);
      return json({ id: owner, role: 'authenticated' });
    });
    const res = await mutation(request(build(fetchImpl as typeof fetch)).post('/api/mcp/session/login'))
      .send({ email: 'owner@example.com', password: 'fixture-password' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, authenticated: true });
    expect(JSON.stringify(res.body)).not.toContain(access);
    expect(JSON.stringify(res.body)).not.toContain(refresh);
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    expect(cookies.some(value => value.startsWith(`__Host-origin-session=${access};`))).toBe(true);
    expect(cookies.some(value => value.startsWith(`__Host-origin-refresh=${refresh};`))).toBe(true);
    for (const value of cookies) expect(value).toMatch(/Path=\/; HttpOnly; Secure; SameSite=Strict/);
  });

  it('rejects a valid Supabase account outside the server owner allowlist and clears any previous cookies', async () => {
    const otherAccess = jwt(other);
    const fetchImpl = vi.fn(async (input: string | URL | RequestInfo) => String(input).includes('grant_type=password')
      ? tokenResponse(otherAccess, refresh)
      : json({ id: other, role: 'authenticated' }));
    const res = await mutation(request(build(fetchImpl as typeof fetch)).post('/api/mcp/session/login'))
      .send({ email: 'other@example.com', password: 'fixture-password' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, code: 'MCP_LOGIN_FAILED' });
    expect(setCookies(res)).toEqual(expect.arrayContaining([
      expect.stringContaining('__Host-origin-session=;'),
      expect.stringContaining('__Host-origin-refresh=;'),
    ]));
  });

  it('rotates both HttpOnly cookies after a successful refresh and sends only the refresh token upstream', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
        expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: refresh });
        expect(String(init?.body)).not.toContain(access);
        return tokenResponse(rotatedAccess, rotatedRefresh);
      }
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${rotatedAccess}`);
      return json({ id: owner, role: 'authenticated' });
    });
    const res = await mutation(request(build(fetchImpl as typeof fetch)).post('/api/mcp/session/refresh'))
      .set('Cookie', `__Host-origin-refresh=${refresh}`)
      .send({});
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies.some(value => value.startsWith(`__Host-origin-session=${rotatedAccess};`))).toBe(true);
    expect(cookies.some(value => value.startsWith(`__Host-origin-refresh=${rotatedRefresh};`))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(rotatedRefresh);
  });

  it('clears local cookies when refresh is missing, duplicated, or rejected without accepting stale state', async () => {
    for (const cookie of [undefined, `__Host-origin-refresh=${refresh}; __Host-origin-refresh=${refresh}`]) {
      const fetchImpl = vi.fn();
      let target = mutation(request(build(fetchImpl as typeof fetch)).post('/api/mcp/session/refresh'));
      if (cookie) target = target.set('Cookie', cookie);
      const res = await target.send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MCP_SESSION_EXPIRED');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(setCookies(res)).toHaveLength(2);
    }
    const rejected = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    const res = await mutation(request(build(rejected as typeof fetch)).post('/api/mcp/session/refresh'))
      .set('Cookie', `__Host-origin-refresh=${refresh}`).send({});
    expect(res.status).toBe(401);
    expect(setCookies(res)).toHaveLength(2);
  });

  it('logs out locally even when remote Supabase revocation fails', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const res = await mutation(request(build(fetchImpl as typeof fetch)).post('/api/mcp/session/logout'))
      .set('Cookie', `__Host-origin-session=${access}; __Host-origin-refresh=${refresh}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, authenticated: false });
    expect(setCookies(res)).toHaveLength(2);
    expect(setCookies(res).every(value => value.includes('Max-Age=0'))).toBe(true);
  });

  it('blocks cross-origin or missing-intent mutations before any Auth network access', async () => {
    const fetchImpl = vi.fn();
    const app = build(fetchImpl as typeof fetch);
    const crossOrigin = await request(app).post('/api/mcp/session/login')
      .set('Origin', 'https://evil.example.com').set('X-Origin-MCP-Intent', 'manage')
      .send({ email: 'owner@example.com', password: 'fixture-password' });
    expect(crossOrigin.status).toBe(403);
    const missingIntent = await request(app).post('/api/mcp/session/login')
      .set('Origin', appOrigin).send({ email: 'owner@example.com', password: 'fixture-password' });
    expect(missingIntent.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed for malformed successful token responses instead of setting cookies', async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 0 }));
    const res = await mutation(request(build(fetchImpl as typeof fetch)).post('/api/mcp/session/login'))
      .send({ email: 'owner@example.com', password: 'fixture-password' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, code: 'MCP_SESSION_UNAVAILABLE' });
    expect(setCookies(res)).toHaveLength(0);
  });
});
