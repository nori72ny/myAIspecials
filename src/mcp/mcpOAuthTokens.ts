import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface McpOAuthTokens { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string[] }
export type McpOAuthGrantStatus = 'authorizing' | 'exchanging' | 'active' | 'refreshing' | 'revoked' | 'reauthorization_required';
export interface McpOAuthGrant {
  ownerId: string; serverId: string; grantId: string; configHash: string; version: number;
  status: McpOAuthGrantStatus; ciphertext: string | null;
}
export interface McpOAuthGrantStore {
  /** Atomically replace current grant with a new generation, max 20 server records per owner. */
  begin(record: McpOAuthGrant): Promise<void>;
  get(ownerId: string, serverId: string): Promise<McpOAuthGrant | undefined>;
  /** Compare generation, config, version and status. No late operation may resurrect a revoked grant. */
  replace(next: McpOAuthGrant, previous: McpOAuthGrant): Promise<boolean>;
  /** Atomically erase local credentials and return the prior record for best-effort remote revocation. */
  revoke(ownerId: string, serverId: string): Promise<McpOAuthGrant | undefined>;
}
export class McpOAuthError extends Error {
  constructor(readonly code: string) { super(code); }
}
export const oauthFailure = (code: string): never => { throw new McpOAuthError(code); };
export function validateOAuthOwner(ownerId: string, serverId: string): void {
  if (!/^[A-Za-z0-9:_-]{1,192}$/.test(ownerId) || !/^[A-Za-z0-9-]{1,64}$/.test(serverId)) oauthFailure('MCP_OAUTH_IDENTITY_INVALID');
}
export function validOAuthTokens(value: unknown): value is McpOAuthTokens {
  if (!value || typeof value !== 'object') return false;
  const token = value as McpOAuthTokens;
  return typeof token.accessToken === 'string' && token.accessToken.length <= 8192 && /^[A-Za-z0-9._~+/-]+=*$/.test(token.accessToken)
    && (token.refreshToken === undefined || typeof token.refreshToken === 'string' && /^[\x21-\x7e]{1,8192}$/.test(token.refreshToken))
    && Number.isSafeInteger(token.expiresAt) && token.expiresAt > 0
    && Array.isArray(token.scopes) && token.scopes.length <= 20
    && new Set(token.scopes).size === token.scopes.length
    && token.scopes.every(scope => typeof scope === 'string' && /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(scope));
}

/** Explicit key ring permits read-old/write-current rotation without exposing keys to the browser. */
export class McpOAuthTokenCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;
  constructor(private readonly activeKeyId: string, keys: Readonly<Record<string, Buffer>>) {
    this.keys = new Map(Object.entries(keys).map(([id, key]) => [id, Buffer.from(key)]));
    if (!this.keys.has(activeKeyId) || this.keys.size > 5 || [...this.keys].some(([id, key]) => !/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32)) oauthFailure('MCP_OAUTH_KEY_CONFIG_INVALID');
  }
  private aad(grant: McpOAuthGrant, keyId: string): Buffer {
    return Buffer.from(JSON.stringify(['origin-mcp-oauth-tokens-v1', keyId, grant.ownerId, grant.serverId, grant.grantId, grant.configHash]));
  }
  seal(tokens: McpOAuthTokens, grant: McpOAuthGrant): string {
    if (!validOAuthTokens(tokens)) return oauthFailure('MCP_OAUTH_TOKEN_INVALID');
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, nonce);
    cipher.setAAD(this.aad(grant, this.activeKeyId));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
    return ['v1', this.activeKeyId, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }
  open(grant: McpOAuthGrant): McpOAuthTokens {
    try {
      const raw = grant.ciphertext ?? '';
      if (raw.length > 32768 || !/^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const [, keyId, nonce, tag, payload] = raw.split('.'); const key = this.keys.get(keyId);
      if (!key) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
      decipher.setAAD(this.aad(grant, keyId)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const tokens: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8'));
      if (!validOAuthTokens(tokens)) throw new Error();
      return tokens;
    } catch { return oauthFailure('MCP_OAUTH_CREDENTIAL_UNAVAILABLE'); }
  }
}
