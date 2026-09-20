import { randomUUID } from 'node:crypto';
import { McpOAuthAuthorization, oauthIdentityHash, oauthProviderHash, type McpOAuthIdentity, type McpOAuthPendingStore, type McpOAuthProvider } from './mcpOAuthAuthorization.js';
import { McpOAuthTokenClient, type McpOAuthTokenEndpoint } from './mcpOAuthTokenClient.js';
import { McpOAuthTokenCipher, oauthFailure, validateOAuthOwner, type McpOAuthGrant, type McpOAuthGrantStore, type McpOAuthTokens } from './mcpOAuthTokens.js';

/** Server-only broker. No global credential cache; no default environment/provider activation. */
export class McpOAuthBroker {
  private readonly authorization: McpOAuthAuthorization;
  private readonly providers: ReadonlyMap<string, { configHash: string; client: McpOAuthTokenEndpoint }>;
  constructor(private readonly options: {
    providers: readonly McpOAuthProvider[]; pendingStore: McpOAuthPendingStore; grantStore: McpOAuthGrantStore;
    pkceKey: Buffer; tokenCipher: McpOAuthTokenCipher; clientSecrets?: Readonly<Record<string, string>>;
    /** Trusted test seam; production defaults to guarded Node HTTPS. */
    createTokenClient?: (provider: McpOAuthProvider) => McpOAuthTokenEndpoint;
  }) {
    this.authorization = new McpOAuthAuthorization(options.pendingStore, options.pkceKey, options.providers);
    this.providers = new Map(options.providers.map(value => {
      const provider = structuredClone(value);
      return [provider.serverId, { configHash: oauthProviderHash(provider),
        client: options.createTokenClient?.(provider) ?? new McpOAuthTokenClient(provider, options.clientSecrets?.[provider.serverId]) }];
    }));
  }
  /** Public metadata only: lets management UI distinguish reviewed OAuth servers without exposing provider endpoints or credentials. */
  supports(serverId: string): boolean {
    return /^[A-Za-z0-9-]{1,64}$/.test(serverId) && this.providers.has(serverId);
  }
  private provider(ownerId: string, serverId: string) {
    validateOAuthOwner(ownerId, serverId);
    return this.providers.get(serverId) ?? oauthFailure('MCP_OAUTH_SERVER_NOT_ALLOWED');
  }
  private async read(ownerId: string, serverId: string) {
    const provider = this.provider(ownerId, serverId);
    let record: McpOAuthGrant | undefined;
    try { record = await this.options.grantStore.get(ownerId, serverId); }
    catch { return oauthFailure('MCP_OAUTH_STORE_UNAVAILABLE'); }
    if (!record || record.ownerId !== ownerId || record.serverId !== serverId || record.configHash !== provider.configHash) return oauthFailure('MCP_OAUTH_REAUTHORIZATION_REQUIRED');
    return { record, ...provider };
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
    const { configHash } = this.provider(who.ownerId, serverId);
    const record: McpOAuthGrant = { ownerId: who.ownerId, serverId, grantId: randomUUID(), configHash, version: 1, status: 'authorizing', ciphertext: null };
    try { await this.options.grantStore.begin(record); }
    catch { return oauthFailure('MCP_OAUTH_BEGIN_UNAVAILABLE'); }
    try { return await this.authorization.begin(who, serverId, record.grantId); }
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
    const callback = await this.authorization.consumeCallback(who, serverId, query);
    const { record, client } = await this.read(who.ownerId, serverId);
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
    const provider = this.provider(ownerId, serverId);
    let previous: McpOAuthGrant | undefined;
    try { previous = await this.options.grantStore.revoke(ownerId, serverId); }
    catch { return oauthFailure('MCP_OAUTH_STORE_UNAVAILABLE'); }
    let remoteRevocationConfirmed = false;
    if (previous?.ownerId === ownerId && previous.serverId === serverId && previous.configHash === provider.configHash && previous.ciphertext) {
      try {
        const confirmed = await provider.client.revoke(this.options.tokenCipher.open(previous));
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
