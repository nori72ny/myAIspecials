import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpOAuthTokenClient } from './mcpOAuthTokenClient.js';
import type { McpOAuthProvider } from './mcpOAuthAuthorization.js';

const provider: McpOAuthProvider = { serverId: 'fixture', issuer: 'https://auth.example.test', authorizationEndpoint: 'https://auth.example.test/authorize',
  tokenEndpoint: 'https://auth.example.test/token', revocationEndpoint: 'https://auth.example.test/revoke', clientId: 'origin',
  redirectUri: 'https://origin.example.test/callback', resource: 'https://mcp.example.test/mcp', scopes: ['read'], pkceS256: true, responseIssuer: true, zeroCostApproved: true };
const responseBody = () => ({ access_token: randomBytes(32).toString('base64url'), refresh_token: randomBytes(32).toString('base64url'), expires_in: 3600, token_type: 'Bearer', scope: 'read' });
const form = () => new URLSearchParams({ grant_type: 'authorization_code', client_id: provider.clientId, redirect_uri: provider.redirectUri,
  resource: provider.resource, code: randomBytes(32).toString('hex'), code_verifier: randomBytes(32).toString('base64url') });
afterEach(() => vi.useRealTimers());
describe('MCP OAuth token endpoint boundary', () => {
  it('posts the code/PKCE form to the fixed endpoint with a bound resource', async () => {
    const body = responseBody(); const request = vi.fn(async () => Response.json(body));
    const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => request });
    const now = Date.now(); const tokens = await client.exchange(form());
    expect(tokens.accessToken).toBe(body.access_token); expect(tokens.expiresAt).toBeGreaterThanOrEqual(now + 3600000);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(provider.tokenEndpoint); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
    expect(new URLSearchParams(String(init.body)).get('resource')).toBe(provider.resource);
    expect(new Headers(init.headers).get('authorization')).toBeNull();
  });
  it('uses reviewed confidential-client Basic auth without putting the secret in the body', async () => {
    const secret = randomBytes(32).toString('base64url'); const request = vi.fn(async () => Response.json(responseBody()));
    const client = new McpOAuthTokenClient({ ...provider, tokenEndpointAuthMethod: 'client_secret_basic' }, secret, { guardedFetchFactory: () => request });
    await client.exchange(form());
    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe(`Basic ${Buffer.from(`origin:${secret}`).toString('base64')}`);
    expect(String(init.body)).not.toContain(secret); expect(new URLSearchParams(String(init.body)).has('client_id')).toBe(false);
  });
  it('supports reviewed GitHub-style exchange/refresh and confirms remote grant revocation', async () => {
    const secret = randomBytes(32).toString('base64url');
    const compatible: McpOAuthProvider = { ...provider, resource: undefined, scopes: ['repo', 'offline_access'],
      untrackedScopes: ['offline_access'], refreshScope: 'omit', responseIssuer: false, tokenEndpointAuthMethod: 'client_secret_post',
      revocationEndpoint: 'https://api.github.com/applications/origin/grant', revocationMethod: 'github-delete-grant' };
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const request = vi.fn(async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ ...responseBody(), scope: 'repo' });
    });
    const client = new McpOAuthTokenClient(compatible, secret, { guardedFetchFactory: () => request });
    const exchangeForm = new URLSearchParams({ grant_type: 'authorization_code', client_id: compatible.clientId,
      redirect_uri: compatible.redirectUri, code: randomBytes(32).toString('hex'), code_verifier: randomBytes(32).toString('base64url') });
    const first = await client.exchange(exchangeForm);
    expect(first.scopes).toEqual(['repo']);
    const firstBody = new URLSearchParams(String(requests[0].init.body));
    expect(firstBody.get('client_id')).toBe(compatible.clientId);
    expect(firstBody.get('client_secret')).toBe(secret);
    expect(firstBody.has('resource')).toBe(false);
    const fresh = await client.refresh(first);
    expect(fresh.scopes).toEqual(['repo']);
    const refreshBody = new URLSearchParams(String(requests[1].init.body));
    expect(refreshBody.has('scope')).toBe(false);
    expect(refreshBody.has('resource')).toBe(false);
    expect(refreshBody.get('client_secret')).toBe(secret);
    expect(await client.revoke(fresh)).toBe(true);
    expect(requests[2].url).toBe(compatible.revocationEndpoint);
    expect(requests[2].init.method).toBe('DELETE');
    expect(JSON.parse(String(requests[2].init.body))).toEqual({ access_token: fresh.accessToken });
    expect(new Headers(requests[2].init.headers).get('authorization')).toBe(`Basic ${Buffer.from(`origin:${secret}`).toString('base64')}`);
  });

  it.each([
    { token_type: 'DPoP' }, { access_token: 'bad\r\nheader' }, { expires_in: 0 }, { expires_in: '3600' },
    { expires_in: 86401 }, { scope: 'read write' }, { scope: 'read read' }, { error: 'secret-upstream-details' },
  ])('rejects invalid or expanded token response %j', async invalid => {
    const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => async () => Response.json({ ...responseBody(), ...invalid }) });
    await expect(client.exchange(form())).rejects.toThrow(/^MCP_OAUTH_TOKEN_INVALID$/);
  });
  it('rejects a mismatched exchange before making a network request', async () => {
    const request = vi.fn(); const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => request });
    const input = form(); input.set('resource', 'https://other.example.test');
    await expect(client.exchange(input)).rejects.toThrow('MCP_OAUTH_EXCHANGE_INVALID'); expect(request).not.toHaveBeenCalled();
  });
  it.each([302, 400, 500])('does not retry HTTP %s or expose response bodies', async status => {
    const request = vi.fn(async () => new Response('private-upstream-error', { status }));
    const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => request });
    await expect(client.exchange(form())).rejects.toThrow(/^MCP_OAUTH_TOKEN_REQUEST_FAILED$/); expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized JSON even if cancellation never acknowledges', async () => {
    const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(32769)); }, cancel() { return new Promise<void>(() => {}); },
    }), { headers: { 'content-type': 'application/json' } }) });
    await expect(client.exchange(form())).rejects.toThrow('MCP_OAUTH_TOKEN_REQUEST_FAILED');
  });
  it('bounds the entire request even if a transport ignores AbortSignal', async () => {
    vi.useFakeTimers(); const request = vi.fn(() => new Promise<Response>(() => {}));
    const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => request });
    const result = client.exchange(form()).catch(error => error.message);
    await vi.advanceTimersByTimeAsync(15000); expect(await result).toBe('MCP_OAUTH_TOKEN_REQUEST_FAILED'); expect(request).toHaveBeenCalledTimes(1);
  });
  it('requires refresh rotation and retains neither an omitted nor a reused refresh token', async () => {
    const old = { accessToken: randomBytes(32).toString('hex'), refreshToken: randomBytes(32).toString('hex'), expiresAt: Date.now(), scopes: ['read'] };
    for (const refresh_token of [undefined, old.refreshToken]) {
      const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => async () => Response.json({ ...responseBody(), refresh_token }) });
      await expect(client.refresh(old)).rejects.toThrow('MCP_OAUTH_TOKEN_INVALID');
    }
  });
  it('revokes refresh and access tokens separately and reports uncertain revocation honestly', async () => {
    const requests: URLSearchParams[] = [];
    const client = new McpOAuthTokenClient(provider, undefined, { guardedFetchFactory: () => async (_url, init) => {
      requests.push(new URLSearchParams(String(init?.body))); return new Response('', { status: requests.length === 1 ? 500 : 200 });
    } });
    expect(await client.revoke({ accessToken: randomBytes(32).toString('hex'), refreshToken: randomBytes(32).toString('hex'), expiresAt: Date.now(), scopes: ['read'] })).toBe(false);
    expect(requests.map(value => value.get('token_type_hint'))).toEqual(['refresh_token', 'access_token']);
  });
});
