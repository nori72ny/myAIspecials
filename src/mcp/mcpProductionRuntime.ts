import { Pool } from 'pg';
import { createNodeMcpManagement } from './mcpNodeIntegration.js';
import { McpOAuthBroker } from './mcpOAuthBroker.js';
import type { McpOAuthProvider } from './mcpOAuthAuthorization.js';
import { PostgresMcpOAuthGrantStore } from './mcpOAuthGrantStore.js';
import { PostgresMcpOAuthPendingStore } from './mcpOAuthPendingStore.js';
import { McpOAuthTokenCipher } from './mcpOAuthTokens.js';
import { PostgresMcpConnectionStore } from './mcpPostgresStore.js';
import { createSupabaseMcpAuthenticatorFromEnv } from './mcpSupabaseAuth.js';
import type { McpManagementDependencies } from './mcpManagementRouter.js';
import type { McpServerChoice } from './mcpConnections.js';

const ENABLED = 'true';
const CLIENT_SECRET_ENV = /^ORIGIN_MCP_[A-Z0-9_]+_CLIENT_SECRET$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const SERVER_ID = /^[A-Za-z0-9-]{1,64}$/;

const invalid = (): never => { throw new Error('MCP_RUNTIME_CONFIG_INVALID'); };

function exactHttps(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) return invalid();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !url.hostname.includes('.')) return invalid();
    return url.href;
  } catch { return invalid(); }
}

function key32(raw: unknown): Buffer {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length > 64) return invalid();
  const value = Buffer.from(raw, 'base64');
  if (value.length !== 32) return invalid();
  return value;
}

function databaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 8192) return invalid();
  try {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.username.length > 256 || url.password.length > 2048) return invalid();
    return raw;
  } catch { return invalid(); }
}

type ReviewedOAuth = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  revocationEndpoint?: string;
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic';
  clientSecretEnv?: string;
  pkceS256: true;
  responseIssuer: true;
  zeroCostApproved: true;
};

type ReviewedServer = {
  id: string;
  label: string;
  endpoint: string;
  zeroCostApproved: true;
  oauth: ReviewedOAuth;
};

function reviewedServers(raw: string, appOrigin: string, env: NodeJS.ProcessEnv) {
  if (Buffer.byteLength(raw) > 64 * 1024) return invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return invalid(); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) return invalid();

  const ids = new Set<string>();
  const servers: McpServerChoice[] = [];
  const providers: McpOAuthProvider[] = [];
  const clientSecrets: Record<string, string> = {};

  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const value = item as Record<string, unknown>;
    if (Object.keys(value).some(key => !['id', 'label', 'endpoint', 'zeroCostApproved', 'oauth'].includes(key))) return invalid();
    const id = value.id;
    const label = value.label;
    if (typeof id !== 'string' || !SERVER_ID.test(id) || ids.has(id) || typeof label !== 'string' || !label.trim() || label.length > 80
      || value.zeroCostApproved !== true || !value.oauth || typeof value.oauth !== 'object' || Array.isArray(value.oauth)) return invalid();
    ids.add(id);

    const endpoint = exactHttps(value.endpoint);
    const oauth = value.oauth as Record<string, unknown>;
    if (Object.keys(oauth).some(key => ![
      'issuer', 'authorizationEndpoint', 'tokenEndpoint', 'clientId', 'redirectUri', 'resource', 'scopes', 'revocationEndpoint',
      'tokenEndpointAuthMethod', 'clientSecretEnv', 'pkceS256', 'responseIssuer', 'zeroCostApproved',
    ].includes(key))) return invalid();

    if (typeof oauth.clientId !== 'string' || !oauth.clientId || oauth.clientId.length > 2048 || /[\x00-\x20\x7f]/.test(oauth.clientId)
      || !Array.isArray(oauth.scopes) || oauth.scopes.some(scope => typeof scope !== 'string')
      || oauth.pkceS256 !== true || oauth.responseIssuer !== true || oauth.zeroCostApproved !== true) return invalid();

    const expectedRedirect = new URL(`/api/mcp/oauth/${id}/callback`, appOrigin).href;
    const redirectUri = exactHttps(oauth.redirectUri);
    if (redirectUri !== expectedRedirect) return invalid();
    const authMethod = oauth.tokenEndpointAuthMethod === undefined ? 'none' : oauth.tokenEndpointAuthMethod;
    if (authMethod !== 'none' && authMethod !== 'client_secret_basic') return invalid();

    if (authMethod === 'client_secret_basic') {
      if (typeof oauth.clientSecretEnv !== 'string' || !CLIENT_SECRET_ENV.test(oauth.clientSecretEnv)) return invalid();
      const secret = env[oauth.clientSecretEnv]?.trim();
      if (!secret || secret.length > 2048 || /[\x00-\x20\x7f]/.test(secret)) return invalid();
      clientSecrets[id] = secret;
    } else if (oauth.clientSecretEnv !== undefined) return invalid();

    servers.push({ id, label: label.trim(), endpoint, zeroCostApproved: true });
    providers.push({
      serverId: id,
      issuer: exactHttps(oauth.issuer),
      authorizationEndpoint: exactHttps(oauth.authorizationEndpoint),
      tokenEndpoint: exactHttps(oauth.tokenEndpoint),
      clientId: oauth.clientId,
      redirectUri,
      resource: exactHttps(oauth.resource),
      scopes: oauth.scopes as string[],
      ...(oauth.revocationEndpoint === undefined ? {} : { revocationEndpoint: exactHttps(oauth.revocationEndpoint) }),
      tokenEndpointAuthMethod: authMethod,
      pkceS256: true,
      responseIssuer: true,
      zeroCostApproved: true,
    });
  }
  return { servers, providers, clientSecrets };
}

function tokenCipher(raw: string): McpOAuthTokenCipher {
  if (Buffer.byteLength(raw) > 16 * 1024) return invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid();
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).some(key => !['activeKeyId', 'keys'].includes(key)) || typeof value.activeKeyId !== 'string' || !KEY_ID.test(value.activeKeyId)
    || !value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys)) return invalid();
  const entries = Object.entries(value.keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 5) return invalid();
  const keys: Record<string, Buffer> = {};
  for (const [id, rawKey] of entries) {
    if (!KEY_ID.test(id)) return invalid();
    keys[id] = key32(rawKey);
  }
  return new McpOAuthTokenCipher(value.activeKeyId, keys);
}

/**
 * Production/serverless composition for the MCP management surface.
 * Disabled unless explicitly enabled. Once enabled, partial or malformed configuration
 * throws instead of silently falling back to in-memory state, unsigned identity, or a
 * different database/connector.
 */
export function createMcpProductionRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): McpManagementDependencies | undefined {
  if (env.ORIGIN_MCP_ENABLED !== ENABLED) return undefined;
  if (env.FREE_ONLY !== ENABLED) return invalid();

  const appOrigin = env.APP_URL?.trim();
  if (!appOrigin) return invalid();
  const appUrl = new URL(appOrigin);
  if (appUrl.protocol !== 'https:' || appUrl.origin !== appOrigin || appUrl.pathname !== '/' || appUrl.search || appUrl.hash) return invalid();

  const authenticate = createSupabaseMcpAuthenticatorFromEnv(env);
  const configRaw = env.ORIGIN_MCP_REVIEWED_SERVERS_JSON;
  const databaseRaw = env.ORIGIN_MCP_DATABASE_URL;
  const pkceRaw = env.ORIGIN_MCP_PKCE_KEY_BASE64;
  const keyringRaw = env.ORIGIN_MCP_TOKEN_KEYRING_JSON;
  if (!authenticate || !configRaw || !databaseRaw || !pkceRaw || !keyringRaw) return invalid();

  const reviewed = reviewedServers(configRaw, appOrigin, env);
  const pool = new Pool({ connectionString: databaseUrl(databaseRaw.trim()), max: 2, idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000, allowExitOnIdle: true });
  const broker = new McpOAuthBroker({
    providers: reviewed.providers,
    pendingStore: new PostgresMcpOAuthPendingStore(pool),
    grantStore: new PostgresMcpOAuthGrantStore(pool),
    pkceKey: key32(pkceRaw.trim()),
    tokenCipher: tokenCipher(keyringRaw),
    clientSecrets: reviewed.clientSecrets,
  });

  return createNodeMcpManagement({
    appOrigin,
    authenticate,
    store: new PostgresMcpConnectionStore(pool),
    servers: reviewed.servers,
    oauth: broker,
    resolveCredential: (ownerId, serverId) => broker.resolveCredential(ownerId, serverId),
    disconnectCredential: async (ownerId, serverId) => { await broker.disconnect(ownerId, serverId); },
  });
}
