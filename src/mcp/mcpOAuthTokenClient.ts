import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpOAuthProvider } from './mcpOAuthAuthorization.js';
import { createNodeMcpFetch } from './mcpNodeFetch.js';
import { oauthFailure, validOAuthTokens, type McpOAuthTokens } from './mcpOAuthTokens.js';

export interface McpOAuthTokenEndpoint {
  exchange(form: URLSearchParams): Promise<McpOAuthTokens>;
  refresh(tokens: McpOAuthTokens): Promise<McpOAuthTokens>;
  revoke(tokens: McpOAuthTokens): Promise<boolean>;
}
const sameScopes = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(scope => b.includes(scope));
const encodeForm = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);

/** Node-only fixed-endpoint HTTPS client. No discovery, redirect, native-fetch fallback or retry. */
export class McpOAuthTokenClient implements McpOAuthTokenEndpoint {
  private readonly provider: McpOAuthProvider;
  private readonly tokenFetch: FetchLike;
  private readonly revokeFetch?: FetchLike;
  private readonly authorization?: string;
  private readonly clientSecret?: string;
  private readonly rawClientSecret?: string;
  constructor(provider: McpOAuthProvider, clientSecret?: string, options: {
    /** Trusted test/integration seam; production callers must leave this unset. */
    guardedFetchFactory?: (endpoint: string) => FetchLike;
  } = {}) {
    this.provider = structuredClone(provider);
    const factory = options.guardedFetchFactory ?? ((endpoint: string, allowDeleteBody = false) => createNodeMcpFetch({
      endpoint, allowedOrigins: [new URL(endpoint).origin], maxResponseBytes: 32768, allowDeleteBody,
    }));
    this.tokenFetch = factory(provider.tokenEndpoint);
    if (provider.revocationEndpoint) this.revokeFetch = factory(provider.revocationEndpoint, provider.revocationMethod === 'github-delete-grant');
    if (provider.tokenEndpointAuthMethod === 'client_secret_basic' || provider.tokenEndpointAuthMethod === 'client_secret_post') {
      if (!clientSecret || clientSecret.length > 2048 || /[\x00-\x20\x7f]/.test(clientSecret)) oauthFailure('MCP_OAUTH_CLIENT_AUTH_INVALID');
      this.rawClientSecret = clientSecret;
      if (provider.tokenEndpointAuthMethod === 'client_secret_basic') {
        this.authorization = `Basic ${Buffer.from(`${encodeForm(provider.clientId)}:${encodeForm(clientSecret)}`).toString('base64')}`;
      } else {
        this.clientSecret = clientSecret;
      }
    } else if (clientSecret !== undefined) oauthFailure('MCP_OAUTH_CLIENT_AUTH_INVALID');
  }
  private async post(endpoint: string, fetchImpl: FetchLike, form: URLSearchParams, tokenResponse: boolean): Promise<Record<string, unknown>> {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const body = new URLSearchParams(form);
    if (this.authorization) body.delete('client_id'); else body.set('client_id', this.provider.clientId);
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    const operation = async () => {
      const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: abort.signal,
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', ...(this.authorization ? { authorization: this.authorization } : {}) },
        body: body.toString() });
      if (response.status !== 200 || response.url && response.url !== endpoint) { void response.body?.cancel().catch(() => undefined); throw new Error(); }
      if (!tokenResponse) { void response.body?.cancel().catch(() => undefined); return {}; }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) { void response.body?.cancel().catch(() => undefined); throw new Error(); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 32768) throw new Error();
          chunks.push(value);
        }
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        return parsed as Record<string, unknown>;
      } finally { void reader.cancel().catch(() => undefined); }
    };
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new Error()); }, 15000);
      })]);
    } catch { return oauthFailure('MCP_OAUTH_TOKEN_REQUEST_FAILED'); }
    finally { clearTimeout(timer); abort.abort(); }
  }
  private trackedScopes(): string[] {
    const untracked = new Set(this.provider.untrackedScopes ?? []);
    return this.provider.scopes.filter(scope => !untracked.has(scope));
  }
  private async tokens(form: URLSearchParams, previous?: McpOAuthTokens): Promise<McpOAuthTokens> {
    // Use request start for expiry, so a slow response cannot extend token validity.
    const started = Date.now();
    const value = await this.post(this.provider.tokenEndpoint, this.tokenFetch, form, true);
    const expectedScopes = previous?.scopes ?? this.trackedScopes();
    const scopes = value.scope === undefined
      ? expectedScopes
      : typeof value.scope === 'string'
        ? value.scope.trim() === '' ? [] : value.scope.trim().split(/[ ,]+/).filter(Boolean)
        : [];
    const githubApp = this.provider.permissionModel === 'github-app';
    if (value.error !== undefined || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer'
      || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) < 1 || Number(value.expires_in) > 86400
      || !sameScopes(scopes, expectedScopes)
      || githubApp && (Number(value.expires_in) !== 28800
        || typeof value.access_token !== 'string' || !value.access_token.startsWith('ghu_')
        || typeof value.refresh_token !== 'string' || !value.refresh_token.startsWith('ghr_')
        || scopes.length !== 0)) return oauthFailure('MCP_OAUTH_TOKEN_INVALID');
    const tokens = { accessToken: value.access_token, refreshToken: value.refresh_token,
      expiresAt: started + Number(value.expires_in) * 1000, scopes };
    if (!validOAuthTokens(tokens) || tokens.expiresAt <= Date.now() || previous && (!tokens.refreshToken || tokens.refreshToken === previous.refreshToken)) return oauthFailure('MCP_OAUTH_TOKEN_INVALID');
    return tokens;
  }
  exchange(form: URLSearchParams): Promise<McpOAuthTokens> {
    const expected = ['grant_type', 'code', 'client_id', 'redirect_uri', 'code_verifier', ...(this.provider.resource ? ['resource'] : [])];
    if ([...form.keys()].length !== expected.length || expected.some(key => form.getAll(key).length !== 1)
      || form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== this.provider.clientId
      || form.get('redirect_uri') !== this.provider.redirectUri
      || (this.provider.resource ? form.get('resource') !== this.provider.resource : form.has('resource'))
      || !/^[A-Za-z0-9_-]{43}$/.test(form.get('code_verifier') ?? '') || !/^[\x21-\x7e]{1,8192}$/.test(form.get('code') ?? '')) return Promise.reject(new Error('MCP_OAUTH_EXCHANGE_INVALID'));
    return this.tokens(form);
  }
  refresh(tokens: McpOAuthTokens): Promise<McpOAuthTokens> {
    if (!validOAuthTokens(tokens) || !tokens.refreshToken || !sameScopes(tokens.scopes, this.trackedScopes())) return Promise.reject(new Error('MCP_OAUTH_REFRESH_UNAVAILABLE'));
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    if (this.provider.resource) form.set('resource', this.provider.resource);
    if ((this.provider.refreshScope ?? (this.provider.permissionModel === 'github-app' ? 'omit' : 'include')) === 'include') form.set('scope', tokens.scopes.join(' '));
    return this.tokens(form, tokens);
  }
  async revoke(tokens: McpOAuthTokens): Promise<boolean> {
    if (!this.revokeFetch || !this.provider.revocationEndpoint || !validOAuthTokens(tokens)) return false;
    const method = this.provider.revocationMethod ?? 'rfc7009-post';
    if (method === 'github-delete-grant') {
      if (!this.rawClientSecret) return false;
      const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const authorization = `Basic ${Buffer.from(`${this.provider.clientId}:${this.rawClientSecret}`).toString('base64')}`;
        const response = await Promise.race([
          this.revokeFetch(this.provider.revocationEndpoint, {
            method: 'DELETE', redirect: 'error', signal: abort.signal,
            headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', authorization },
            body: JSON.stringify({ access_token: tokens.accessToken }),
          }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error()); }, 15_000); }),
        ]);
        const exact = !response.url || response.url === this.provider.revocationEndpoint;
        void response.body?.cancel().catch(() => undefined);
        return response.status === 204 && exact;
      } catch { return false; }
      finally { clearTimeout(timer); abort.abort(); }
    }
    let confirmed = true;
    // RFC 7009 providers are asked to revoke both explicitly; they need not cascade refresh-token revocation.
    for (const [hint, token] of [['refresh_token', tokens.refreshToken], ['access_token', tokens.accessToken]]) {
      if (!token) continue;
      try { await this.post(this.provider.revocationEndpoint, this.revokeFetch, new URLSearchParams({ token, token_type_hint: hint }), false); }
      catch { confirmed = false; }
    }
    return confirmed;
  }
}
