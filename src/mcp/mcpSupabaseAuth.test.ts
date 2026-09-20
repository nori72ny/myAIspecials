// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { createSupabaseMcpAuthenticator, createSupabaseMcpAuthenticatorFromEnv } from './mcpSupabaseAuth.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const token = ['header', 'payload', 'signature'].join('.');
const request = (value?: string) => ({ get: (name: string) => name.toLowerCase() === 'cookie' ? value : undefined }) as Request;
const response = (body: object, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json', ...init.headers }, ...init,
});

describe('Supabase MCP session authentication', () => {
  it('verifies an HttpOnly cookie through the fixed Auth endpoint and binds the configured owner', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe('https://project.supabase.co/auth/v1/user');
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${token}`);
      expect(headers.get('apikey')).toBe('publishable-fixture');
      expect(String(url)).not.toContain(token);
      return response({ id: owner, role: 'authenticated', user_metadata: { owner: false } });
    });
    const authenticate = createSupabaseMcpAuthenticator({ supabaseUrl: 'https://project.supabase.co/', publishableKey: 'publishable-fixture', allowedOwnerIds: [owner], fetchImpl });
    await expect(authenticate(request(`theme=dark; __Host-origin-session=${token}`))).resolves.toEqual({ subjectId: `supabase:${owner}` });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects missing, duplicate, malformed and oversized cookie values before network access', async () => {
    const fetchImpl = vi.fn();
    const authenticate = createSupabaseMcpAuthenticator({ supabaseUrl: 'https://project.supabase.co/', publishableKey: 'publishable-fixture', allowedOwnerIds: [owner], fetchImpl });
    for (const value of [undefined, `__Host-origin-session=invalid`, `__Host-origin-session=${token}; __Host-origin-session=${token}`, `x=${'a'.repeat(17_000)}`]) {
      await expect(authenticate(request(value))).resolves.toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects valid Supabase users outside the server allowlist and ignores editable metadata', async () => {
    const fetchImpl = vi.fn(async () => response({ id: other, role: 'authenticated', user_metadata: { owner: true } }));
    const authenticate = createSupabaseMcpAuthenticator({ supabaseUrl: 'https://project.supabase.co/', publishableKey: 'publishable-fixture', allowedOwnerIds: [owner], fetchImpl });
    await expect(authenticate(request(`__Host-origin-session=${token}`))).resolves.toBeNull();
  });

  it.each([
    new Response('', { status: 401, headers: { 'content-type': 'application/json' } }),
    new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response(JSON.stringify({ id: owner, role: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '40000' } }),
    new Response('x'.repeat(40_000), { status: 200, headers: { 'content-type': 'application/json' } }),
  ])('fails closed for invalid Auth responses', async invalid => {
    const authenticate = createSupabaseMcpAuthenticator({ supabaseUrl: 'https://project.supabase.co/', publishableKey: 'publishable-fixture', allowedOwnerIds: [owner], fetchImpl: async () => invalid.clone() });
    await expect(authenticate(request(`__Host-origin-session=${token}`))).resolves.toBeNull();
  });

  it('fails closed when Auth exceeds its deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
    const authenticate = createSupabaseMcpAuthenticator({ supabaseUrl: 'https://project.supabase.co/', publishableKey: 'publishable-fixture', allowedOwnerIds: [owner], fetchImpl, timeoutMs: 250 });
    const pending = authenticate(request(`__Host-origin-session=${token}`));
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('remains disabled for incomplete or invalid environment configuration', () => {
    expect(createSupabaseMcpAuthenticatorFromEnv({})).toBeUndefined();
    expect(createSupabaseMcpAuthenticatorFromEnv({ SUPABASE_URL: 'http://unsafe.test/', SUPABASE_PUBLISHABLE_KEY: 'key', ORIGIN_OWNER_SUPABASE_USER_IDS: owner })).toBeUndefined();
  });
});
