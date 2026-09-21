import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { openMcpCredential, sealMcpCredential } from './mcpConnections.js';

export interface McpOAuthProvider {
  serverId: string; issuer: string; authorizationEndpoint: string; tokenEndpoint: string;
  clientId: string; redirectUri: string; resource?: string; scopes: readonly string[];
  /** Authorization-only scopes that a provider intentionally omits from token scope responses (for example GitHub offline_access). */
  untrackedScopes?: readonly string[];
  /** Some providers forbid a scope parameter on refresh. Default is include. */
  refreshScope?: 'include' | 'omit';
  revocationEndpoint?: string;
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post';
  /** Explicitly reviewed provider capability. When true, callback issuer is mandatory; when false, state+PKCE+session binding remain mandatory. */
  pkceS256: true; responseIssuer: boolean; zeroCostApproved: true;
}
export interface McpOAuthPending {
  ownerId: string; serverId: string; stateHash: string; sessionHash: string;
  configHash: string; verifierCiphertext: string;
  grantId: string;
}
export interface McpOAuthPendingStore {
  /** Atomically replace this owner's pending attempt for this server; max 20/owner, TTL 5 minutes. */
  put(record: McpOAuthPending): Promise<void>;
  /** Atomic delete-and-return, only for an unexpired exact binding. Never retry a consumed callback. */
  consume(binding: Omit<McpOAuthPending, 'verifierCiphertext' | 'grantId'>): Promise<McpOAuthPending | undefined>;
}
export interface McpOAuthIdentity {
  ownerId: string;
  /** Server-verified login-session binding; never accept a browser-supplied arbitrary ID. */
  sessionBinding: string;
}
export const oauthHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const oauthProviderHash = (provider: McpOAuthProvider): string => oauthHash(JSON.stringify([
  provider.serverId, provider.issuer, provider.authorizationEndpoint, provider.tokenEndpoint,
  provider.clientId, provider.redirectUri, provider.resource ?? null, [...provider.scopes].sort(),
  [...(provider.untrackedScopes ?? [])].sort(), provider.refreshScope ?? 'include',
  provider.revocationEndpoint ?? null, provider.tokenEndpointAuthMethod ?? 'none', provider.responseIssuer,
]));
const fail = (code: string): never => { throw new Error(code); };
function endpoint(raw: string): void {
  try {
    const url = new URL(raw);
    if (raw.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.')) throw new Error();
  } catch { fail('MCP_OAUTH_CONFIG_INVALID'); }
}
export function oauthIdentityHash(value: McpOAuthIdentity): string {
  if (!/^[A-Za-z0-9:_-]{1,192}$/.test(value.ownerId) || value.sessionBinding.length < 32 || value.sessionBinding.length > 8192) fail('MCP_OAUTH_IDENTITY_INVALID');
  return oauthHash(JSON.stringify(['origin-mcp-session-v1', value.ownerId, value.sessionBinding]));
}
function encryptionBinding(record: McpOAuthPending) {
  return { id: record.stateHash, ownerId: record.ownerId, serverId: record.serverId,
    endpoint: JSON.stringify(['origin-mcp-pkce-v1', record.sessionHash, record.configHash, record.grantId]) };
}

/** Server-only authorization preparation consumed internally by McpOAuthBroker.
 * Routes/login/providers are deliberately not activated by constructing this service.
 */
export class McpOAuthAuthorization {
  private readonly providers: ReadonlyMap<string, { provider: McpOAuthProvider; configHash: string }>;
  private readonly key: Buffer;
  constructor(private readonly store: McpOAuthPendingStore, key: Buffer, providers: readonly McpOAuthProvider[]) {
    if (key.length !== 32 || providers.length < 1 || providers.length > 20) fail('MCP_OAUTH_CONFIG_INVALID');
    this.key = Buffer.from(key);
    this.providers = new Map(providers.map(value => {
      const provider = structuredClone(value);
      for (const url of [provider.issuer, provider.authorizationEndpoint, provider.tokenEndpoint, provider.redirectUri]) endpoint(url);
      if (provider.resource !== undefined) endpoint(provider.resource);
      if (provider.revocationEndpoint !== undefined) endpoint(provider.revocationEndpoint);
      if (!['none', 'client_secret_basic', 'client_secret_post'].includes(provider.tokenEndpointAuthMethod ?? 'none')) fail('MCP_OAUTH_CONFIG_INVALID');
      const untrackedScopes = provider.untrackedScopes ?? [];
      if (!/^[A-Za-z0-9-]{1,64}$/.test(provider.serverId) || !provider.clientId || provider.clientId.length > 2048 || /[\x00-\x20\x7f]/.test(provider.clientId)
        || provider.pkceS256 !== true || typeof provider.responseIssuer !== 'boolean' || provider.zeroCostApproved !== true
        || !provider.scopes.length || provider.scopes.length > 20 || new Set(provider.scopes).size !== provider.scopes.length
        || provider.scopes.some(scope => !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(scope))
        || untrackedScopes.length > provider.scopes.length || new Set(untrackedScopes).size !== untrackedScopes.length
        || untrackedScopes.some(scope => !provider.scopes.includes(scope))
        || !['include', 'omit'].includes(provider.refreshScope ?? 'include')) fail('MCP_OAUTH_CONFIG_INVALID');
      const configHash = oauthProviderHash(provider);
      return [provider.serverId, { provider, configHash }];
    }));
    if (this.providers.size !== providers.length) fail('MCP_OAUTH_CONFIG_INVALID');
  }
  private configured(serverId: string) {
    return this.providers.get(serverId) ?? fail('MCP_OAUTH_SERVER_NOT_ALLOWED');
  }
  async begin(who: McpOAuthIdentity, serverId: string, grantId: string = randomUUID()): Promise<{ authorizationUrl: string }> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(grantId)) fail('MCP_OAUTH_STATE_INVALID');
    const sessionHash = oauthIdentityHash(who);
    const { provider, configHash } = this.configured(serverId);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const record: McpOAuthPending = { ownerId: who.ownerId, serverId, stateHash: oauthHash(state), sessionHash, configHash, grantId, verifierCiphertext: '' };
    record.verifierCiphertext = sealMcpCredential(verifier, encryptionBinding(record), this.key);
    try { await this.store.put(record); } catch { return fail('MCP_OAUTH_STORE_UNAVAILABLE'); }
    const url = new URL(provider.authorizationEndpoint);
    const params = new URLSearchParams({ response_type: 'code', client_id: provider.clientId, redirect_uri: provider.redirectUri,
      scope: provider.scopes.join(' '), state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    if (provider.resource) params.set('resource', provider.resource);
    url.search = params.toString();
    return { authorizationUrl: url.href };
  }
  /** INTERNAL ONLY: the result contains secrets for the broker's guarded server-side exchange.
   * Never serialize it to the browser, logs or model. Consumption precedes exchange so
   * timeouts/unknown completion cannot lead to an automatic authorization-code replay.
   */
  async consumeCallback(who: McpOAuthIdentity, serverId: string, query: URLSearchParams): Promise<{ tokenEndpoint: string; form: URLSearchParams; grantId: string; configHash: string }> {
    const sessionHash = oauthIdentityHash(who);
    const { provider, configHash } = this.configured(serverId);
    const callbackIssuer = query.get('iss');
    if (query.toString().length > 16_384 || [...new Set(query.keys())].some(key => query.getAll(key).length !== 1)
      || (provider.responseIssuer ? callbackIssuer !== provider.issuer : callbackIssuer !== null && callbackIssuer !== provider.issuer)) return fail('MCP_OAUTH_CALLBACK_INVALID');
    const state = query.get('state') ?? ''; const code = query.get('code'); const error = query.get('error');
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || query.has('code') === query.has('error') || (!code && !error)
      || (code && (code.length > 8192 || /[\x00-\x20\x7f]/.test(code)))) return fail('MCP_OAUTH_CALLBACK_INVALID');
    const binding = { ownerId: who.ownerId, serverId, stateHash: oauthHash(state), sessionHash, configHash };
    let record: McpOAuthPending | undefined;
    try { record = await this.store.consume(binding); } catch { return fail('MCP_OAUTH_STORE_UNAVAILABLE'); }
    if (!record || Object.entries(binding).some(([key, value]) => record![key as keyof McpOAuthPending] !== value)) return fail('MCP_OAUTH_STATE_INVALID');
    if (error) return fail('MCP_OAUTH_ACCESS_DENIED');
    let verifier: string;
    try { verifier = openMcpCredential({ ...encryptionBinding(record), credential: record.verifierCiphertext }, this.key); }
    catch { return fail('MCP_OAUTH_STATE_INVALID'); }
    if (!/^[A-Za-z0-9_-]{43}$/.test(verifier)) return fail('MCP_OAUTH_STATE_INVALID');
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: code!,
      client_id: provider.clientId, redirect_uri: provider.redirectUri, code_verifier: verifier });
    if (provider.resource) form.set('resource', provider.resource);
    return { tokenEndpoint: provider.tokenEndpoint, grantId: record.grantId, configHash, form };
  }
}
