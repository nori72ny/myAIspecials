import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { McpOAuthAuthorization, type McpOAuthPending, type McpOAuthPendingStore, type McpOAuthProvider } from './mcpOAuthAuthorization.js';

const provider: McpOAuthProvider = {
  serverId: 'reviewed', issuer: 'https://auth.example.test', authorizationEndpoint: 'https://auth.example.test/authorize',
  tokenEndpoint: 'https://auth.example.test/token', clientId: 'origin-test', redirectUri: 'https://origin.example.test/api/mcp/oauth/callback',
  resource: 'https://mcp.example.test/mcp', scopes: ['files:read'], pkceS256: true, responseIssuer: true, zeroCostApproved: true,
};
function fixture() {
  let pending: McpOAuthPending | undefined;
  const store: McpOAuthPendingStore = {
    async put(record) { pending = structuredClone(record); },
    async consume(binding) {
      if (!pending || Object.entries(binding).some(([key, value]) => pending![key as keyof McpOAuthPending] !== value)) return undefined;
      const result = pending; pending = undefined; return result;
    },
  };
  const key = randomBytes(32); const who = { ownerId: 'owner-a', sessionBinding: randomBytes(32).toString('hex') };
  const service = new McpOAuthAuthorization(store, key, [provider]);
  const begin = async () => new URL((await service.begin(who, provider.serverId)).authorizationUrl);
  const callback = (url: URL) => new URLSearchParams({ state: url.searchParams.get('state')!, iss: provider.issuer, code: randomBytes(32).toString('hex') });
  return { service, who, key, store, begin, callback, pending: () => pending };
}
describe('MCP OAuth authorization transaction', () => {
  it('uses S256 and keeps state/session/verifier out of durable plaintext; consumes once', async () => {
    const f = fixture(); const url = await f.begin(); const query = f.callback(url);
    expect(url.origin + url.pathname).toBe(provider.authorizationEndpoint);
    expect(url.searchParams.get('resource')).toBe(provider.resource);
    expect(url.searchParams.get('scope')).toBe('files:read');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const snapshot = JSON.stringify(f.pending());
    expect(snapshot).not.toContain(url.searchParams.get('state'));
    expect(snapshot).not.toContain(f.who.sessionBinding);
    const exchange = await f.service.consumeCallback(f.who, provider.serverId, query);
    const verifier = exchange.form.get('code_verifier')!;
    expect(snapshot).not.toContain(verifier);
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(exchange.tokenEndpoint).toBe(provider.tokenEndpoint);
    expect(exchange.form.get('redirect_uri')).toBe(provider.redirectUri);
    expect(exchange.form.get('resource')).toBe(provider.resource);
    await expect(f.service.consumeCallback(f.who, provider.serverId, query)).rejects.toThrow('MCP_OAUTH_STATE_INVALID');
  });
  it.each(['owner', 'session', 'state', 'issuer', 'config'])('rejects a changed %s binding without accepting the callback', async field => {
    const f = fixture(); const url = await f.begin(); const query = f.callback(url); let who = f.who; let service = f.service;
    if (field === 'owner') who = { ...who, ownerId: 'owner-b' };
    if (field === 'session') who = { ...who, sessionBinding: randomBytes(32).toString('hex') };
    if (field === 'state') query.set('state', randomBytes(32).toString('base64url'));
    if (field === 'issuer') query.set('iss', 'https://attacker.example.test');
    if (field === 'config') service = new McpOAuthAuthorization(f.store, f.key, [{ ...provider, resource: 'https://other.example.test/mcp' }]);
    await expect(service.consumeCallback(who, provider.serverId, query)).rejects.toThrow(/MCP_OAUTH_(STATE|CALLBACK)_INVALID/);
    expect(f.pending()).toBeDefined();
  });
  it('starting again invalidates the earlier attempt', async () => {
    const f = fixture(); const first = await f.begin(); const second = await f.begin();
    await expect(f.service.consumeCallback(f.who, provider.serverId, f.callback(first))).rejects.toThrow('MCP_OAUTH_STATE_INVALID');
    await expect(f.service.consumeCallback(f.who, provider.serverId, f.callback(second))).resolves.toHaveProperty('tokenEndpoint');
  });
  it('consumes denial without exposing upstream error descriptions', async () => {
    const f = fixture(); const query = f.callback(await f.begin()); query.delete('code'); query.set('error', 'upstream-private-message');
    await expect(f.service.consumeCallback(f.who, provider.serverId, query)).rejects.toThrow(/^MCP_OAUTH_ACCESS_DENIED$/);
    expect(f.pending()).toBeUndefined();
  });
  it('rejects duplicate parameters and simultaneous code/error', async () => {
    const f = fixture(); const query = f.callback(await f.begin()); query.append('state', query.get('state')!);
    await expect(f.service.consumeCallback(f.who, provider.serverId, query)).rejects.toThrow('MCP_OAUTH_CALLBACK_INVALID');
    query.delete('state'); query.set('state', randomBytes(32).toString('base64url')); query.set('error', 'denied');
    await expect(f.service.consumeCallback(f.who, provider.serverId, query)).rejects.toThrow('MCP_OAUTH_CALLBACK_INVALID');
  });
  it('fails closed on key mismatch and does not retry the consumed state', async () => {
    const f = fixture(); const query = f.callback(await f.begin());
    const other = new McpOAuthAuthorization(f.store, randomBytes(32), [provider]);
    await expect(other.consumeCallback(f.who, provider.serverId, query)).rejects.toThrow('MCP_OAUTH_STATE_INVALID');
    expect(f.pending()).toBeUndefined();
  });
  it('copies reviewed configuration and rejects unsafe endpoints or unsupported profiles', async () => {
    const f = fixture();
    for (const overrides of [{ authorizationEndpoint: 'http://auth.example.test' }, { redirectUri: 'https://origin.example.test/cb?next=evil' },
      { tokenEndpoint: 'https://127.0.0.1/token' }, { pkceS256: false }, { responseIssuer: false }, { scopes: ['read write'] }]) {
      expect(() => new McpOAuthAuthorization(f.store, f.key, [{ ...provider, ...overrides } as McpOAuthProvider])).toThrow('MCP_OAUTH_CONFIG_INVALID');
    }
    const config = structuredClone(provider); const service = new McpOAuthAuthorization(f.store, f.key, [config]); config.scopes = ['write'];
    expect(new URL((await service.begin(f.who, provider.serverId)).authorizationUrl).searchParams.get('scope')).toBe('files:read');
  });
  it('sanitizes storage failures', async () => {
    const f = fixture(); f.store.put = async () => { throw new Error('secret'); };
    await expect(f.begin()).rejects.toThrow(/^MCP_OAUTH_STORE_UNAVAILABLE$/);
  });
});
