import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpOAuthProvider } from './mcpOAuthAuthorization.js';
import type { McpServerChoice } from './mcpConnections.js';
import { createNodeMcpFetch, mcpFixedHeadersForProfile } from './mcpNodeFetch.js';

const MAX_JSON_BYTES = 32 * 1024;
const MAX_HEADER_BYTES = 8 * 1024;

const fail = (): never => { throw new Error('MCP_OAUTH_DISCOVERY_FAILED'); };

function strictHttps(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 2048) return fail();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !url.hostname.includes('.')) return fail();
    return url.href;
  } catch { return fail(); }
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) return fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) return fail();
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail();
    return parsed as Record<string, unknown>;
  } catch {
    return fail();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function metadataReference(header: string | null, resourceEndpoint: string): string {
  if (!header || Buffer.byteLength(header) > MAX_HEADER_BYTES || !/^Bearer\b/i.test(header)) return fail();
  const matches = [...header.matchAll(/\bresource_metadata="([^"\r\n]{1,2048})"/g)];
  if (matches.length !== 1) return fail();
  const href = strictHttps(matches[0][1]);
  const resource = new URL(resourceEndpoint);
  const metadata = new URL(href);
  if (metadata.origin !== resource.origin || !metadata.pathname.startsWith('/.well-known/oauth-protected-resource')) return fail();
  return metadata.href;
}

function authorizationMetadataCandidates(issuer: string): string[] {
  const url = new URL(strictHttps(issuer));
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  const values = path
    ? [
        `${url.origin}/.well-known/oauth-authorization-server${path}`,
        `${url.origin}/.well-known/openid-configuration${path}`,
        `${url.origin}${path}/.well-known/openid-configuration`,
      ]
    : [
        `${url.origin}/.well-known/oauth-authorization-server`,
        `${url.origin}/.well-known/openid-configuration`,
      ];
  return values.map(strictHttps);
}

async function firstMetadata(
  candidates: readonly string[],
  factory: (endpoint: string) => FetchLike,
): Promise<Record<string, unknown>> {
  for (const endpoint of candidates) {
    try {
      const response = await factory(endpoint)(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json' },
      });
      if (response.status === 200) return await jsonObject(response);
      void response.body?.cancel().catch(() => undefined);
    } catch {
      // Continue to the next standards-defined metadata location only.
    }
  }
  return fail();
}

/**
 * Verifies MCP OAuth discovery against the reviewed static provider configuration.
 * Discovered URLs can confirm a reviewed configuration but can never redirect ORIGIN
 * to a new, unreviewed authorization or token endpoint.
 */
export async function verifyMcpOAuthDiscovery(options: {
  server: McpServerChoice;
  provider: McpOAuthProvider;
  /** Trusted test seam. Production always uses the guarded Node adapter. */
  guardedFetchFactory?: (endpoint: string, fixedHeaders?: Readonly<Record<string, string>>) => FetchLike;
}): Promise<void> {
  const serverEndpoint = strictHttps(options.server.endpoint);
  const provider = structuredClone(options.provider);
  const factory = options.guardedFetchFactory ?? ((endpoint: string, fixedHeaders?: Readonly<Record<string, string>>) =>
    createNodeMcpFetch({
      endpoint,
      allowedOrigins: [new URL(endpoint).origin],
      maxResponseBytes: MAX_JSON_BYTES,
      fixedHeaders,
    }));

  let challenge: Response;
  try {
    challenge = await factory(serverEndpoint, mcpFixedHeadersForProfile(options.server.transportProfile))(serverEndpoint, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
  } catch {
    return fail();
  }
  if (challenge.status !== 401) {
    void challenge.body?.cancel().catch(() => undefined);
    return fail();
  }
  const resourceMetadataUrl = metadataReference(challenge.headers.get('www-authenticate'), serverEndpoint);
  void challenge.body?.cancel().catch(() => undefined);

  let resourceMetadata: Record<string, unknown>;
  try {
    const response = await factory(resourceMetadataUrl)(resourceMetadataUrl, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
    resourceMetadata = await jsonObject(response);
  } catch {
    return fail();
  }

  if (strictHttps(resourceMetadata.resource) !== serverEndpoint) return fail();
  const authorizationServers = resourceMetadata.authorization_servers;
  if (!Array.isArray(authorizationServers) || authorizationServers.length < 1 || authorizationServers.length > 5
    || authorizationServers.some(value => typeof value !== 'string')) return fail();
  const issuers = authorizationServers.map(strictHttps);
  if (!issuers.includes(strictHttps(provider.issuer))) return fail();

  const authorizationMetadata = await firstMetadata(
    authorizationMetadataCandidates(provider.issuer),
    endpoint => factory(endpoint),
  );
  if (strictHttps(authorizationMetadata.issuer) !== strictHttps(provider.issuer)
    || strictHttps(authorizationMetadata.authorization_endpoint) !== strictHttps(provider.authorizationEndpoint)
    || strictHttps(authorizationMetadata.token_endpoint) !== strictHttps(provider.tokenEndpoint)) return fail();

  const responseTypes = authorizationMetadata.response_types_supported;
  const pkce = authorizationMetadata.code_challenge_methods_supported;
  if (!Array.isArray(responseTypes) || !responseTypes.includes('code')
    || !Array.isArray(pkce) || !pkce.includes('S256')) return fail();
}
