import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { McpOAuthBroker } from './mcpOAuthBroker.js';
import { McpOAuthTokenCipher, type McpOAuthGrant, type McpOAuthGrantStore, type McpOAuthTokens } from './mcpOAuthTokens.js';
import type { McpOAuthPending, McpOAuthPendingStore, McpOAuthProvider } from './mcpOAuthAuthorization.js';

const provider: McpOAuthProvider = { serverId: 'fixture', issuer: 'https://auth.example.test', authorizationEndpoint: 'https://auth.example.test/authorize',
  tokenEndpoint: 'https://auth.example.test/token', revocationEndpoint: 'https://auth.example.test/revoke', clientId: 'origin',
  redirectUri: 'https://origin.example.test/callback', resource: 'https://mcp.example.test/mcp', scopes: ['read'], pkceS256: true, responseIssuer: true, zeroCostApproved: true };
const tokenSet = (seconds = 3600): McpOAuthTokens => ({ accessToken: randomBytes(32).toString('base64url'), refreshToken: randomBytes(32).toString('base64url'), expiresAt: Date.now() + seconds * 1000, scopes: ['read'] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  let grant: McpOAuthGrant | undefined; let pending: McpOAuthPending | undefined;
  const grants: McpOAuthGrantStore = {
    async begin(record) {
      if (grant && !['authorizing', 'revoked', 'reauthorization_required'].includes(grant.status)) throw new Error();
      grant = structuredClone(record);
    },
    async get(owner, server) { return grant?.ownerId === owner && grant.serverId === server ? structuredClone(grant) : undefined; },
    async replace(next, previous) {
      if (!grant || ['ownerId', 'serverId', 'grantId', 'configHash', 'version', 'status'].some(key => grant![key as keyof McpOAuthGrant] !== previous[key as keyof McpOAuthGrant])) return false;
      grant = structuredClone(next); return true;
    },
    async revoke(owner, server) {
      if (grant?.ownerId !== owner || grant.serverId !== server) return undefined;
      const old = structuredClone(grant); grant = { ...grant, version: grant.version + 1, status: 'revoked', ciphertext: null }; pending = undefined; return old;
    },
  };
  const pendingStore: McpOAuthPendingStore = {
    async put(value) { pending = structuredClone(value); },
    async consume(binding) {
      if (!pending || Object.entries(binding).some(([key, value]) => pending![key as keyof McpOAuthPending] !== value)) return undefined;
      const value = pending; pending = undefined; return value;
    },
  };
  const key = randomBytes(32); const cipher = new McpOAuthTokenCipher('first', { first: key });
  const issued = tokenSet();
  const client = { exchange: vi.fn(async () => issued), refresh: vi.fn(async () => tokenSet()), revoke: vi.fn(async () => true) };
  const options = { providers: [provider], pendingStore, grantStore: grants, pkceKey: randomBytes(32), tokenCipher: cipher, createTokenClient: () => client };
  const broker = new McpOAuthBroker(options);
  const who = { ownerId: 'owner', sessionBinding: randomBytes(32).toString('hex') };
  const start = async () => {
    const url = new URL((await broker.begin(who, provider.serverId)).authorizationUrl);
    return new URLSearchParams({ state: url.searchParams.get('state')!, code: randomBytes(32).toString('hex'), iss: provider.issuer });
  };
  const link = async () => broker.complete(who, provider.serverId, await start());
  return { broker, who, client, issued, options, key, grants, cipher, start, link, current: () => structuredClone(grant!) };
}
describe('MCP OAuth token broker', () => {
  it('completes PKCE exchange once and only returns nonsecret metadata', async () => {
    const f = fixture(); const query = await f.start();
    const result = await f.broker.complete(f.who, provider.serverId, query);
    expect(result).toEqual({ linked: true, serverId: provider.serverId });
    expect(JSON.stringify(f.current())).not.toContain(f.issued.accessToken);
    expect(await f.broker.resolveCredential(f.who.ownerId, provider.serverId)).toBe(f.issued.accessToken);
    await expect(f.broker.complete(f.who, provider.serverId, query)).rejects.toThrow();
    expect(f.client.exchange).toHaveBeenCalledTimes(1);
    await expect(f.broker.resolveCredential('another-owner', provider.serverId)).rejects.toThrow('MCP_OAUTH_REAUTHORIZATION_REQUIRED');
  });
  it('claims refresh before the network call, so concurrent callers cannot reuse a refresh token', async () => {
    const f = fixture(); f.issued.expiresAt = Date.now() + 1000; await f.link();
    const pending = deferred<McpOAuthTokens>(); const started = deferred<void>();
    f.client.refresh.mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const first = f.broker.resolveCredential(f.who.ownerId, provider.serverId); await started.promise;
    await expect(f.broker.resolveCredential(f.who.ownerId, provider.serverId)).rejects.toThrow('MCP_OAUTH_OPERATION_IN_PROGRESS');
    const fresh = tokenSet(); pending.resolve(fresh);
    expect(await first).toBe(fresh.accessToken); expect(f.client.refresh).toHaveBeenCalledTimes(1);
    expect(f.cipher.open(f.current()).refreshToken).toBe(fresh.refreshToken);
  });
  it('does not retry unknown refresh completion and erases locally usable credentials', async () => {
    const f = fixture(); f.issued.expiresAt = Date.now() + 1000; await f.link();
    f.client.refresh.mockRejectedValue(new Error('upstream-secret'));
    await expect(f.broker.resolveCredential(f.who.ownerId, provider.serverId)).rejects.toThrow(/^MCP_OAUTH_REAUTHORIZATION_REQUIRED$/);
    await expect(f.broker.resolveCredential(f.who.ownerId, provider.serverId)).rejects.toThrow(/^MCP_OAUTH_REAUTHORIZATION_REQUIRED$/);
    expect(f.current().ciphertext).toBeNull(); expect(f.client.refresh).toHaveBeenCalledTimes(1);
  });
  it('does not retry an uncertain code exchange', async () => {
    const f = fixture(); const query = await f.start(); f.client.exchange.mockRejectedValue(new Error('private'));
    await expect(f.broker.complete(f.who, provider.serverId, query)).rejects.toThrow('MCP_OAUTH_REAUTHORIZATION_REQUIRED');
    await expect(f.broker.complete(f.who, provider.serverId, query)).rejects.toThrow();
    expect(f.client.exchange).toHaveBeenCalledTimes(1); expect(f.current().status).toBe('reauthorization_required');
  });
  it.each(['exchange', 'refresh'] as const)('disconnect fences a late %s response and revokes newly issued credentials', async operation => {
    const f = fixture(); let query: URLSearchParams | undefined;
    if (operation === 'refresh') { f.issued.expiresAt = Date.now() + 1000; await f.link(); } else query = await f.start();
    const pending = deferred<McpOAuthTokens>(); const started = deferred<void>();
    f.client[operation].mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const work = operation === 'exchange' ? f.broker.complete(f.who, provider.serverId, query!) : f.broker.resolveCredential(f.who.ownerId, provider.serverId);
    const outcome = work.catch(error => error.message); await started.promise;
    expect(await f.broker.disconnect(f.who.ownerId, provider.serverId)).toEqual({ disconnected: true, remoteRevocationConfirmed: false });
    const fresh = tokenSet(); pending.resolve(fresh);
    expect(await outcome).toBe('MCP_OAUTH_GRANT_CHANGED'); expect(f.current().status).toBe('revoked'); expect(f.current().ciphertext).toBeNull();
    expect(f.client.revoke).toHaveBeenCalledWith(fresh);
  });
  it('keeps a disconnect effective even when remote revocation fails', async () => {
    const f = fixture(); await f.link(); f.client.revoke.mockResolvedValue(false);
    expect(await f.broker.disconnect(f.who.ownerId, provider.serverId)).toEqual({ disconnected: true, remoteRevocationConfirmed: false });
    await expect(f.broker.resolveCredential(f.who.ownerId, provider.serverId)).rejects.toThrow('MCP_OAUTH_REAUTHORIZATION_REQUIRED');
  });
  it('does not allow an old callback after disconnect and reauthorization', async () => {
    const f = fixture(); const old = await f.start(); const oldId = f.current().grantId;
    await f.broker.disconnect(f.who.ownerId, provider.serverId); const next = await f.start();
    expect(f.current().grantId).not.toBe(oldId);
    await expect(f.broker.complete(f.who, provider.serverId, old)).rejects.toThrow();
    await f.broker.complete(f.who, provider.serverId, next); expect(f.client.exchange).toHaveBeenCalledTimes(1);
  });
  it('rotates encryption with read-old/write-new keys without changing expiry or calling the provider', async () => {
    const f = fixture(); await f.link();
    const nextCipher = new McpOAuthTokenCipher('second', { first: f.key, second: randomBytes(32) });
    const next = new McpOAuthBroker({ ...f.options, tokenCipher: nextCipher });
    await next.rotateEncryption(f.who.ownerId, provider.serverId);
    expect(f.current().ciphertext).toMatch(/^v1\.second\./); expect(nextCipher.open(f.current())).toEqual(f.issued);
    expect(f.client.refresh).not.toHaveBeenCalled();
  });
  it('binds encrypted credentials to owner, server, generation and provider configuration', async () => {
    const f = fixture(); await f.link();
    for (const override of [{ ownerId: 'other' }, { serverId: 'other' }, { grantId: randomUUID() }, { configHash: randomBytes(32).toString('hex') }]) {
      expect(() => f.cipher.open({ ...f.current(), ...override })).toThrow('MCP_OAUTH_CREDENTIAL_UNAVAILABLE');
    }
    expect(() => new McpOAuthTokenCipher('other', { other: randomBytes(32) }).open(f.current())).toThrow('MCP_OAUTH_CREDENTIAL_UNAVAILABLE');
  });
  it('will not silently replace an active link with another authorization request', async () => {
    const f = fixture(); await f.link();
    await expect(f.start()).rejects.toThrow('MCP_OAUTH_BEGIN_UNAVAILABLE');
    expect(await f.broker.resolveCredential(f.who.ownerId, provider.serverId)).toBe(f.issued.accessToken);
  });
});
