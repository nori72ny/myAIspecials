import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { McpOAuthBroker } from './mcpOAuthBroker.js';
import type { McpOAuthPending, McpOAuthPendingStore, McpOAuthProvider } from './mcpOAuthAuthorization.js';
import { McpOAuthTokenCipher, type McpOAuthGrant, type McpOAuthGrantStore, type McpOAuthTokens } from './mcpOAuthTokens.js';

const reviewedProvider: McpOAuthProvider = {
  serverId: 'github-files',
  issuer: 'https://github.com/login/oauth',
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  tokenEndpoint: 'https://github.com/login/oauth/access_token',
  clientId: 'origin-dynamic-github-app',
  redirectUri: 'https://origin.example.com/api/mcp/oauth/github-files/callback',
  scopes: [],
  permissionModel: 'github-app',
  refreshScope: 'omit',
  revocationEndpoint: 'https://api.github.com/applications/origin-dynamic-github-app/grant',
  revocationMethod: 'github-delete-grant',
  tokenEndpointAuthMethod: 'client_secret_post',
  pkceS256: true,
  responseIssuer: false,
  zeroCostApproved: true,
};

function stores() {
  let pending: McpOAuthPending | undefined;
  let grant: McpOAuthGrant | undefined;
  const pendingStore: McpOAuthPendingStore = {
    async put(value) { pending = structuredClone(value); },
    async consume(binding) {
      if (!pending || Object.entries(binding).some(([key, value]) => pending![key as keyof McpOAuthPending] !== value)) return undefined;
      const value = pending;
      pending = undefined;
      return structuredClone(value);
    },
  };
  const grantStore: McpOAuthGrantStore = {
    async begin(value) { grant = structuredClone(value); },
    async get(ownerId, serverId) {
      return grant?.ownerId === ownerId && grant.serverId === serverId ? structuredClone(grant) : undefined;
    },
    async replace(next, previous) {
      if (!grant || grant.ownerId !== previous.ownerId || grant.serverId !== previous.serverId
        || grant.grantId !== previous.grantId || grant.configHash !== previous.configHash
        || grant.version !== previous.version || grant.status !== previous.status) return false;
      grant = structuredClone(next);
      return true;
    },
    async revoke(ownerId, serverId) {
      if (!grant || grant.ownerId !== ownerId || grant.serverId !== serverId) return undefined;
      const previous = structuredClone(grant);
      grant = { ...grant, version: grant.version + 1, status: 'revoked', ciphertext: null };
      return previous;
    },
  };
  return { pendingStore, grantStore };
}

describe('dynamic owner-bound OAuth provider metadata', () => {
  it('uses the registered GitHub App client ID and secret for both authorization and code exchange', async () => {
    const { pendingStore, grantStore } = stores();
    const actualClientId = 'Iv23ownerregisteredclient';
    const actualSecret = 'owner-registered-secret-value-1234567890';
    const resolveProvider = vi.fn(async (_ownerId: string, _serverId: string, reviewed: McpOAuthProvider) => ({
      ...reviewed,
      clientId: actualClientId,
      revocationEndpoint: `https://api.github.com/applications/${actualClientId}/grant`,
    }));
    const resolveClientSecret = vi.fn(async () => actualSecret);
    const issued: McpOAuthTokens = {
      accessToken: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + 3600_000,
      scopes: [],
    };
    const exchange = vi.fn(async (_form: URLSearchParams) => issued);
    const createTokenClient = vi.fn((provider: McpOAuthProvider, clientSecret?: string) => ({
      exchange,
      refresh: vi.fn(async () => issued),
      revoke: vi.fn(async () => true),
      provider,
      clientSecret,
    }));
    const broker = new McpOAuthBroker({
      providers: [reviewedProvider],
      pendingStore,
      grantStore,
      pkceKey: randomBytes(32),
      tokenCipher: new McpOAuthTokenCipher('k1', { k1: randomBytes(32) }),
      resolveProvider,
      resolveClientSecret,
      createTokenClient,
    });
    const who = { ownerId: 'owner', sessionBinding: randomBytes(32).toString('hex') };

    const authorizationUrl = new URL((await broker.begin(who, reviewedProvider.serverId)).authorizationUrl);
    expect(authorizationUrl.searchParams.get('client_id')).toBe(actualClientId);
    const state = authorizationUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    await broker.complete(who, reviewedProvider.serverId, new URLSearchParams({
      state: state!,
      code: randomBytes(32).toString('hex'),
    }));

    expect(resolveProvider).toHaveBeenCalled();
    expect(resolveClientSecret).toHaveBeenCalledWith(who.ownerId, reviewedProvider.serverId);
    expect(createTokenClient).toHaveBeenCalledWith(expect.objectContaining({ clientId: actualClientId }), actualSecret);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][0].get('client_id')).toBe(actualClientId);
    expect(await broker.resolveCredential(who.ownerId, reviewedProvider.serverId)).toBe(issued.accessToken);
  });

  it('fails closed when owner-specific provider metadata cannot be resolved', async () => {
    const { pendingStore, grantStore } = stores();
    const broker = new McpOAuthBroker({
      providers: [reviewedProvider],
      pendingStore,
      grantStore,
      pkceKey: randomBytes(32),
      tokenCipher: new McpOAuthTokenCipher('k1', { k1: randomBytes(32) }),
      resolveProvider: async () => { throw new Error('missing-registration'); },
      resolveClientSecret: async () => undefined,
    });
    const who = { ownerId: 'owner', sessionBinding: randomBytes(32).toString('hex') };
    await expect(broker.begin(who, reviewedProvider.serverId)).rejects.toThrow('MCP_OAUTH_PROVIDER_UNAVAILABLE');
    expect(await grantStore.get(who.ownerId, reviewedProvider.serverId)).toBeUndefined();
  });
});