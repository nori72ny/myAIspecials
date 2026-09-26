import { randomUUID } from 'node:crypto';
import { McpOAuthAuthorization, oauthIdentityHash, oauthProviderHash, type McpOAuthIdentity, type McpOAuthPendingStore, type McpOAuthProvider } from './mcpOAuthAuthorization.js';
import { McpOAuthTokenClient, type McpOAuthTokenEndpoint } from './mcpOAuthTokenClient.js';
import { McpOAuthTokenCipher, oauthFailure, validateOAuthOwner, type McpOAuthGrant, type McpOAuthGrantStore, type McpOAuthTokens } from './mcpOAuthTokens.js';

/** Server-only broker. No global credential cache; no default environment/provider activation. */
export class McpOAuthBroker {
  private readonly providers: ReadonlyMap<string, McpOAuthProvider>;
  private readonly pkceKey: Buffer;
  constructor(private readonly options: {
    providers: readonly McpOAuthProvider[]; pendingStore: McpOAuthPendingStore; grantStore: McpOAuthGrantStore;
    pkceKey: Buffer; tokenCipher: McpOAuthTokenCipher; clientSecrets?: Readonly<Record<string, string>>;
    /** Optional owner-bound metadata resolver for dynamically registered OAuth clients. */
    resolveProvider?: (ownerId: string, serverId: string, reviewed: McpOAuthProvider) => Promise<McpOAuthProvider>;
    /** Optional owner-bound secret resolver for dynamically registered confidential clients. */
    resolveClientSecret?: (ownerId: string, serverId: string) => Promise<string | undefined>;
    /** Trusted test seam; production defaults to guarded Node HTTPS. */
    createTokenClient?: (provider: McpOAuthProvider, clientSecret?: string) => McpOAuthTokenEndpoint;
    /** Optional pre-authorization discovery verification. Failures block OAuth before state/grant creation. */
    verifyProvider?: (provider: McpOAuthProvider) => Promise<void>;
  }) {
    // Construct once for strict startup validation. Actual authorization objects are
    // recreated with owner-resolved metadata so dynamic client IDs are state-bound.
    new McpOAuthAuthorization(options.pendingStore, options.pkceKey, options.providers);
    this.pkceKey = Buffer.from(options.pkceKey);
    this.providers = new Map(options.providers.map(value => [value.serverId, structuredClone(value)]));
  }
  /** Public metadata only: lets management UI distinguish reviewed OAuth servers without exposing provider endpoints or credentials. */
  supports(serverId: string): boolean {
    return /^[A-Za-z0-9-]{1,64}$/.test(serverId) && this.providers.has(serverId);
  }
  private baseProvider(ownerId: string, serverId: string): McpOAuthProvider {
    validateOAuthOwner(ownerId, serverId);
    return structuredClone(this.providers.get(serverId) ?? oauthFailure('MCP_OAUTH_SERVER_NOT_ALLOWED'));
  }
  private authorization(provider: McpOAuthProvider) {
    return new McpOAuthAuthorization(this.options.pendingStore, this.pkceKey, [provider]);
  }
  private async provider(ownerId: string, serverId: string) {
    const reviewed = this.baseProvider(ownerId, serverId);
    let provider = reviewed;
    if (this.options.resolveProvider) {
      try { provider = await this.options.resolveProvider(ownerId, serverId, structuredClone(reviewed)); }
      catch { return oauthFailure('MCP_OAUTH_PROVIDER_UNAVAILABLE'); }
    }
    if (!provider || provider.serverId !== serverId) return oauthFailure('MCP_OAUTH_PROVIDER_UNAVAILABLE');
    try { this.authorization(provider); }
    catch { return oauthFailure('MCP_OAUTH_PROVIDER_UNAVAILABLE'); }
    return { provider: structuredClone(provider), configHash: oauthProviderHash(provider) };
  }
  private async client(ownerId: string, serverId: string, provider?: McpOAuthProvider): Promise<McpOAuthTokenEndpoint> {
    const resolved = provider ?? (await this.provider(ownerId, serverId)).provider;
    let secret = this.options.clientSecrets?.[serverId];
    if (!secret && this.options.resolveClientSecret) {
      try { secret = await this.options.resolveClientSecret(ownerId, serverId); }
      catch { return oauthFailure('MCP_OAUTH_CREDENTIAL_UNAVAILABLE'); }
    }
    if (resolved.tokenEndpointAuthMethod !== 'none' && !secret && !this.options.createTokenClient) {
      return oauthFailure('MCP_OAUTH_CREDENTIAL_UNAVAILABLE');
    }
    return this.options.createTokenClient?.(resolved, secret) ?? new McpOAuthTokenClient(resolved, secret);
  }
  private async read(ownerId: string, serverId: string, resolved?: Awaited<ReturnType<McpOAuthBroker['provider']>>) {
    const provider = resolved ?? await this.provider(ownerId, serverId);
    let record: McpOAuthGrant | undefined;
    try { record = await this.options.grantStore.get(ownerId, serverId); }
    catch { return oauthFailure('MCP_OAUTH_STORE_UNAVAILABLE'); }
    if (!record || record.ownerId !== ownerId || record.serverId !== serverId || record.configHash !== provider.configHash) return oauthFailure('MCP_OAUTH_REAUTHORIZATION_REQUIRED');
    return { record, client: await this.client(ownerId, serverId, provider.provider), ...provider };
  }
  private async change(record: McpOAuthGrant, status: McpOAuthGrant['status'], ciphertext: string | null = null): Promise<McpOAuthGrant> {
    const next = { ...record, version: record.version + 1, status, ciphertext };
    let changed: boolean;
    try { changed = await this.options.grantStore.replace(next, record); }
    catch { return oauthFailure('MCP_OAUTH_STORE_UNAVAILABLE'); }
    if (!changed) return oauthFailure('MCP_OAUTH_GRANT_CHANGED');
    return next;
  }
  private async abandon(record: McpOAuthGrant): Promise<void> {
    // No retry/lease takeover: a crash or uncertain refresh leaves a non-usable
    // grant until explicit reauthorization/disconnect. This CAS cannot undo revoke.
    await this.change(record, 'reauthorization_required').catch(() => undefined);
  }
  async begin(who: McpOAuthIdentity, serverId: string): Promise<{ authorizationUrl: string }> {
    oauthIdentityHash(who);
    const resolved = await this.provider(who.ownerId, serverId);
    const { provider, configHash } = resolved;
    if (this.options.verifyProvider) {
      try { await this.options.verifyProvider(structuredClone(provider)); }
      catch { return oauthFailure('MCP_OAUTH_DISCOVERY_FAILED'); }
    }
    const record: McpOAuthGrant = { ownerId: who.ownerId, serverId, grantId: randomUUID(), configHash, version: 1, status: 'authorizing', ciphertext: null };
    try { await this.options.grantStore.begin(record); }
    catch { return oauthFailure('MCP_OAUTH_BEGIN_UNAVAILABLE'); }
    try { return await this.authorization(provider).begin(who, serverId, record.grantId); }
    catch { await this.abandon(record); return oauthFailure('MCP_OAUTH_BEGIN_UNAVAILABLE'); }
  }
  private async persist(record: McpOAuthGrant, client: McpOAuthTokenEndpoint, tokens: McpOAuthTokens) {
    try { return await this.change(record, 'active', this.options.tokenCipher.seal(tokens, record)); }
    catch {
      // If disconnect/new generation won, discard and try revoking newly issued
      // credentials. A failed remote revocation is not reported as confirmed.
      await client.revoke(tokens).catch(() => false);
      await this.abandon(record);
      return oauthFailure('MCP_OAUTH_GRANT_CHANGED');
    }
  }
  async complete(who: McpOAuthIdentity, serverId: string, query: URLSearchParams): Promise<{ linked: true; serverId: string }> {
    const resolved = await this.provider(who.ownerId, serverId);
    const callback = await this.authorization(resolved.provider).consumeCallback(who, serverId, query);
    const { record, client } = await this.read(who.ownerId, serverId, resolved);
    if (record.status !== 'authorizing' || record.grantId !== callback.grantId || record.configHash !== callback.configHash) return oauthFailure('MCP_OAUTH_GRANT_CHANGED');
    const claim = await this.change(record, 'exchanging');
    let tokens: McpOAuthTokens;
    try { tokens = await client.exchange(callback.form); }
    catch { await this.abandon(claim); return oauthFailure('MCP_OAUTH_REAUTHORIZATION_REQUIRED'); }
    await this.persist(claim, client, tokens);
    return { linked: true, serverId };
  }
  /** INTERNAL ONLY. Resolve immediately before creating an owner-scoped MCP session.
   * Never return this token to UI/model or fall back to a saved connection snapshot.
   */
  async resolveCredential(ownerId: string, serverId: string): Promise<string> {
    const { record, client } = await this.read(ownerId, serverId);
    if (record.status === 'refreshing' || record.status === 'exchanging') return oauthFailure('MCP_OAUTH_OPERATION_IN_PROGRESS');
    if (record.status !== 'active') return oauthFailure('MCP_OAUTH_REAUTHORIZATION_REQUIRED');
    const tokens = this.options.tokenCipher.open(record);
    if (tokens.expiresAt > Date.now() + 30000) return tokens.accessToken;
    if (!tokens.refreshToken) { await this.abandon(record); return oauthFailure('MCP_OAUTH_REAUTHORIZATION_REQUIRED'); }
    const claim = await this.change(record, 'refreshing', record.ciphertext);
    let refreshed: McpOAuthTokens;
    try { refreshed = await client.refresh(tokens); }
    catch { await this.abandon(claim); return oauthFailure('MCP_OAUTH_REAUTHORIZATION_REQUIRED'); }
    await this.persist(claim, client, refreshed);
    return refreshed.accessToken;
  }
  async disconnect(ownerId: string, serverId: string): Promise<{ disconnected: true; remoteRevocationConfirmed: boolean }> {
    const resolved = await this.provider(ownerId, serverId);
    let previous: McpOAuthGrant | undefined;
    try { previous = await this.options.grantStore.revoke(ownerId, serverId); }
    catch { return oauthFailure('MCP_OAUTH_STORE_UNAVAILABLE'); }
    let remoteRevocationConfirmed = false;
    if (previous?.ownerId === ownerId && previous.serverId === serverId && previous.configHash === resolved.configHash && previous.ciphertext) {
      try {
        const confirmed = await (await this.client(ownerId, serverId, resolved.provider)).revoke(this.options.tokenCipher.open(previous));
        // An in-flight exchange may have issued credentials we haven't seen yet.
        remoteRevocationConfirmed = confirmed && previous.status === 'active';
      } catch { /* Locally disconnected; upstream state remains unknown. */ }
    }
    return { disconnected: true, remoteRevocationConfirmed };
  }
  /** Explicit per-grant re-encryption with the current key. Does not refresh or extend expiry. */
  async rotateEncryption(ownerId: string, serverId: string): Promise<void> {
    const { record } = await this.read(ownerId, serverId);
    if (record.status !== 'active') return oauthFailure('MCP_OAUTH_REAUTHORIZATION_REQUIRED');
    await this.change(record, 'active', this.options.tokenCipher.seal(this.options.tokenCipher.open(record), record));
  }
}