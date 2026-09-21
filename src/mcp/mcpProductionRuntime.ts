import { Pool } from 'pg';
import { createNodeMcpAgentSessionFactory, createNodeMcpManagement } from './mcpNodeIntegration.js';
import { McpOAuthBroker } from './mcpOAuthBroker.js';
import type { McpOAuthProvider } from './mcpOAuthAuthorization.js';
import { PostgresMcpOAuthGrantStore } from './mcpOAuthGrantStore.js';
import { PostgresMcpOAuthPendingStore } from './mcpOAuthPendingStore.js';
import { McpOAuthTokenCipher } from './mcpOAuthTokens.js';
import { verifyMcpOAuthDiscovery } from './mcpOAuthDiscovery.js';
import { PostgresMcpConnectionStore } from './mcpPostgresStore.js';
import { PostgresMcpToolGrantStore } from './mcpToolGrantStore.js';
import { createSupabaseMcpAuthenticatorFromEnv } from './mcpSupabaseAuth.js';
import { createSupabaseMcpOwnerSessionRouterFromEnv } from './mcpOwnerSessionRouter.js';
import type { McpManagementDependencies } from './mcpManagementRouter.js';
import type { McpServerChoice } from './mcpConnections.js';
import { createMcpAgentRouter } from './mcpAgentRouter.js';
import { McpGithubAppBootstrap, createMcpGithubAppSecretCipherFromKeyringJson } from './mcpGithubAppBootstrap.js';
import { PostgresMcpGithubAppRegistrationStore, PostgresMcpGithubManifestPendingStore } from './mcpGithubAppStore.js';
import { createMcpGithubAppRouter } from './mcpGithubAppRouter.js';

const ENABLED = 'true';
const CLIENT_SECRET_ENV = /^ORIGIN_MCP_[A-Z0-9_]+_CLIENT_SECRET$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const SERVER_ID = /^[A-Za-z0-9-]{1,64}$/;
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g;
const DYNAMIC_GITHUB_CLIENT_ID = 'origin-dynamic-github-app';

const invalid = (): never => { throw new Error('MCP_RUNTIME_CONFIG_INVALID'); };

function exactHttps(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) return invalid();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !url.hostname.includes('.')) return invalid();
    return url.href;
  } catch { return invalid(); }
}

function verifiedReadOnlyExecutionEndpoint(endpoint: string, profile: unknown): boolean {
  if (profile !== 'github-file-readonly') return false;
  const url = new URL(endpoint);
  return url.origin === 'https://api.githubcopilot.com' && url.pathname === '/mcp/x/repos/readonly';
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
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password
      || url.username.length > 256 || url.password.length > 2048 || url.hash) return invalid();
    // node-postgres lets SSL query parameters replace the explicit TLS object. Reject
    // them so the CA + rejectUnauthorized policy below cannot be weakened by the URL.
    for (const key of url.searchParams.keys()) if (key.toLowerCase().startsWith('ssl')) return invalid();
    return raw;
  } catch { return invalid(); }
}

function databaseCa(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < 64 || raw.length > 64 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return invalid();
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'base64')); }
  catch { return invalid(); }
  if (Buffer.byteLength(decoded) > 32 * 1024 || /\0/.test(decoded)) return invalid();
  const blocks = decoded.match(CERTIFICATE_BLOCK);
  if (!blocks || blocks.length < 1 || blocks.length > 4 || blocks.join('\n') !== decoded.trim()) return invalid();
  return `${decoded.trim()}\n`;
}

type ReviewedOAuth = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId?: string;
  clientIdSource?: 'github-app-registration';
  redirectUri: string;
  resource?: string;
  scopes: string[];
  permissionModel?: 'oauth-scopes' | 'github-app';
  untrackedScopes?: string[];
  refreshScope?: 'include' | 'omit';
  revocationEndpoint?: string;
  revocationMethod?: 'rfc7009-post' | 'github-delete-grant';
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post';
  clientSecretEnv?: string;
  pkceS256: true;
  responseIssuer: boolean;
  zeroCostApproved: true;
};

type ReviewedServer = {
  id: string;
  label: string;
  endpoint: string;
  zeroCostApproved: true;
  executionMode?: 'read-only';
  transportProfile?: 'github-file-readonly';
  zeroCostEvidence: {
    evidenceId: string; verifiedAt: string; expiresAt: string; termsUrl: string;
    billingPlan: 'free'; paidFallback: false;
  };
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
  const dynamicGithubServerIds: string[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const value = item as Record<string, unknown>;
    if (Object.keys(value).some(key => !['id', 'label', 'endpoint', 'zeroCostApproved', 'executionMode', 'transportProfile', 'zeroCostEvidence', 'oauth'].includes(key))) return invalid();
    const id = value.id;
    const label = value.label;
    if (typeof id !== 'string' || !SERVER_ID.test(id) || ids.has(id) || typeof label !== 'string' || !label.trim() || label.length > 80
      || value.zeroCostApproved !== true || (value.executionMode !== undefined && value.executionMode !== 'read-only')
      || (value.transportProfile !== undefined && value.transportProfile !== 'github-file-readonly')
      || (value.executionMode === 'read-only') !== (value.transportProfile === 'github-file-readonly')
      || !value.zeroCostEvidence || typeof value.zeroCostEvidence !== 'object' || Array.isArray(value.zeroCostEvidence)
      || !value.oauth || typeof value.oauth !== 'object' || Array.isArray(value.oauth)) return invalid();
    ids.add(id);

    const evidence = value.zeroCostEvidence as Record<string, unknown>;
    if (Object.keys(evidence).some(key => !['evidenceId', 'verifiedAt', 'expiresAt', 'termsUrl', 'billingPlan', 'paidFallback'].includes(key))
      || typeof evidence.evidenceId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(evidence.evidenceId)
      || typeof evidence.verifiedAt !== 'string' || typeof evidence.expiresAt !== 'string' || typeof evidence.termsUrl !== 'string'
      || evidence.billingPlan !== 'free' || evidence.paidFallback !== false) return invalid();
    const verifiedAt = Date.parse(evidence.verifiedAt); const expiresAt = Date.parse(evidence.expiresAt); const current = Date.now();
    if (!Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt) || verifiedAt > current + 5 * 60_000 || expiresAt <= current
      || expiresAt <= verifiedAt || expiresAt - verifiedAt > 31 * 86400_000) return invalid();
    const termsUrl = exactHttps(evidence.termsUrl);

    const endpoint = exactHttps(value.endpoint);
    if (value.executionMode === 'read-only' && !verifiedReadOnlyExecutionEndpoint(endpoint, value.transportProfile)) return invalid();
    const oauth = value.oauth as Record<string, unknown>;
    if (Object.keys(oauth).some(key => ![
      'issuer', 'authorizationEndpoint', 'tokenEndpoint', 'clientId', 'clientIdSource', 'redirectUri', 'resource', 'scopes', 'permissionModel', 'untrackedScopes', 'refreshScope', 'revocationEndpoint', 'revocationMethod',
      'tokenEndpointAuthMethod', 'clientSecretEnv', 'pkceS256', 'responseIssuer', 'zeroCostApproved',
    ].includes(key))) return invalid();

    const dynamicGithubClient = oauth.clientIdSource === 'github-app-registration';
    if (oauth.clientIdSource !== undefined && !dynamicGithubClient) return invalid();
    if (dynamicGithubClient ? oauth.clientId !== undefined : typeof oauth.clientId !== 'string' || !oauth.clientId || oauth.clientId.length > 2048 || /[\x00-\x20\x7f]/.test(oauth.clientId)) return invalid();

    const permissionModel = oauth.permissionModel === undefined ? 'oauth-scopes' : oauth.permissionModel;
    const untrackedScopes = oauth.untrackedScopes === undefined ? [] : oauth.untrackedScopes;
    if (!['oauth-scopes', 'github-app'].includes(String(permissionModel))
      || !Array.isArray(oauth.scopes) || oauth.scopes.some(scope => typeof scope !== 'string')
      || (permissionModel === 'oauth-scopes' && oauth.scopes.length < 1)
      || (permissionModel === 'github-app' && oauth.scopes.length !== 0)
      || !Array.isArray(untrackedScopes) || untrackedScopes.some(scope => typeof scope !== 'string')
      || untrackedScopes.some(scope => !(oauth.scopes as unknown[]).includes(scope))
      || (permissionModel === 'github-app' && untrackedScopes.length !== 0)
      || oauth.pkceS256 !== true || typeof oauth.responseIssuer !== 'boolean' || oauth.zeroCostApproved !== true
      || !['include', 'omit'].includes(oauth.refreshScope === undefined ? (permissionModel === 'github-app' ? 'omit' : 'include') : String(oauth.refreshScope))) return invalid();

    const expectedRedirect = new URL(`/api/mcp/oauth/${id}/callback`, appOrigin).href;
    const redirectUri = exactHttps(oauth.redirectUri);
    if (redirectUri !== expectedRedirect) return invalid();
    const authMethod = oauth.tokenEndpointAuthMethod === undefined ? 'none' : oauth.tokenEndpointAuthMethod;
    if (!['none', 'client_secret_basic', 'client_secret_post'].includes(String(authMethod))) return invalid();

    if (value.transportProfile === 'github-file-readonly') {
      if (permissionModel !== 'github-app'
        || (oauth.scopes as unknown[]).length !== 0
        || untrackedScopes.length !== 0
        || oauth.resource !== undefined
        || oauth.refreshScope !== 'omit'
        || oauth.responseIssuer !== false
        || authMethod !== 'client_secret_post'
        || oauth.revocationMethod !== 'github-delete-grant'
        || exactHttps(oauth.issuer) !== 'https://github.com/login/oauth'
        || exactHttps(oauth.authorizationEndpoint) !== 'https://github.com/login/oauth/authorize'
        || exactHttps(oauth.tokenEndpoint) !== 'https://github.com/login/oauth/access_token') return invalid();
      if (dynamicGithubClient) {
        if (oauth.revocationEndpoint !== undefined || oauth.clientSecretEnv !== undefined) return invalid();
        dynamicGithubServerIds.push(id);
      } else {
        const clientId = oauth.clientId as string;
        if (exactHttps(oauth.revocationEndpoint) !== `https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`) return invalid();
      }
    } else if (dynamicGithubClient) return invalid();

    if (authMethod === 'client_secret_basic' || authMethod === 'client_secret_post') {
      if (!dynamicGithubClient) {
        if (typeof oauth.clientSecretEnv !== 'string' || !CLIENT_SECRET_ENV.test(oauth.clientSecretEnv)) return invalid();
        const secret = env[oauth.clientSecretEnv]?.trim();
        if (!secret || secret.length > 2048 || /[\x00-\x20\x7f]/.test(secret)) return invalid();
        clientSecrets[id] = secret;
      }
    } else if (oauth.clientSecretEnv !== undefined) return invalid();

    const clientId = dynamicGithubClient ? DYNAMIC_GITHUB_CLIENT_ID : oauth.clientId as string;
    const revocationEndpoint = dynamicGithubClient
      ? `https://api.github.com/applications/${DYNAMIC_GITHUB_CLIENT_ID}/grant`
      : oauth.revocationEndpoint === undefined ? undefined : exactHttps(oauth.revocationEndpoint);
    servers.push({ id, label: label.trim(), endpoint, zeroCostApproved: true,
      ...(value.executionMode === 'read-only' ? { executionMode: 'read-only' as const, transportProfile: 'github-file-readonly' as const } : {}),
      zeroCostEvidence: {
        evidenceId: evidence.evidenceId, verifiedAt: evidence.verifiedAt, expiresAt: evidence.expiresAt,
        termsUrl, billingPlan: 'free', paidFallback: false,
      },
    });
    providers.push({
      serverId: id,
      issuer: exactHttps(oauth.issuer),
      authorizationEndpoint: exactHttps(oauth.authorizationEndpoint),
      tokenEndpoint: exactHttps(oauth.tokenEndpoint),
      clientId,
      redirectUri,
      ...(oauth.resource === undefined ? {} : { resource: exactHttps(oauth.resource) }),
      scopes: oauth.scopes as string[],
      permissionModel: permissionModel as 'oauth-scopes' | 'github-app',
      ...(untrackedScopes.length === 0 ? {} : { untrackedScopes: untrackedScopes as string[] }),
      refreshScope: (oauth.refreshScope === undefined ? (permissionModel === 'github-app' ? 'omit' : 'include') : oauth.refreshScope) as 'include' | 'omit',
      ...(revocationEndpoint === undefined ? {} : { revocationEndpoint }),
      ...(oauth.revocationMethod === undefined ? {} : { revocationMethod: oauth.revocationMethod as 'rfc7009-post' | 'github-delete-grant' }),
      tokenEndpointAuthMethod: authMethod as 'none' | 'client_secret_basic' | 'client_secret_post',
      pkceS256: true,
      responseIssuer: oauth.responseIssuer as boolean,
      zeroCostApproved: true,
    });
  }
  return { servers, providers, clientSecrets, dynamicGithubServerIds };
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
export type McpProductionRuntime = McpManagementDependencies & {
  agentRouter?: ReturnType<typeof createMcpAgentRouter>;
  githubBootstrapRouter?: ReturnType<typeof createMcpGithubAppRouter>;
};

export function createMcpProductionRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): McpProductionRuntime | undefined {
  if (env.ORIGIN_MCP_ENABLED !== ENABLED) return undefined;
  if (env.FREE_ONLY !== ENABLED) return invalid();

  const appOrigin = env.APP_URL?.trim();
  if (!appOrigin) return invalid();
  const appUrl = new URL(appOrigin);
  if (appUrl.protocol !== 'https:' || appUrl.origin !== appOrigin || appUrl.pathname !== '/' || appUrl.search || appUrl.hash) return invalid();

  const authenticate = createSupabaseMcpAuthenticatorFromEnv(env);
  const configRaw = env.ORIGIN_MCP_REVIEWED_SERVERS_JSON;
  const databaseRaw = env.ORIGIN_MCP_DATABASE_URL;
  const databaseCaRaw = env.ORIGIN_MCP_DATABASE_CA_BASE64;
  const pkceRaw = env.ORIGIN_MCP_PKCE_KEY_BASE64;
  const keyringRaw = env.ORIGIN_MCP_TOKEN_KEYRING_JSON;
  if (!authenticate || !configRaw || !databaseRaw || !databaseCaRaw || !pkceRaw || !keyringRaw) return invalid();

  const reviewed = reviewedServers(configRaw, appOrigin, env);
  const pool = new Pool({
    connectionString: databaseUrl(databaseRaw.trim()),
    ssl: { ca: databaseCa(databaseCaRaw.trim()), rejectUnauthorized: true },
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  });

  const dynamicGithubServerIds = new Set(reviewed.dynamicGithubServerIds);
  const githubBootstrapEnabled = env.ORIGIN_MCP_GITHUB_BOOTSTRAP_ENABLED === ENABLED;
  let githubRegistrationStore: PostgresMcpGithubAppRegistrationStore | undefined;
  let githubSecretCipher: ReturnType<typeof createMcpGithubAppSecretCipherFromKeyringJson> | undefined;
  if (githubBootstrapEnabled || dynamicGithubServerIds.size > 0) {
    const bootstrapKeyring = env.ORIGIN_MCP_GITHUB_APP_KEYRING_JSON?.trim();
    if (!bootstrapKeyring) return invalid();
    githubRegistrationStore = new PostgresMcpGithubAppRegistrationStore(pool);
    githubSecretCipher = createMcpGithubAppSecretCipherFromKeyringJson(bootstrapKeyring);
  }

  const broker = new McpOAuthBroker({
    providers: reviewed.providers,
    pendingStore: new PostgresMcpOAuthPendingStore(pool),
    grantStore: new PostgresMcpOAuthGrantStore(pool),
    pkceKey: key32(pkceRaw.trim()),
    tokenCipher: tokenCipher(keyringRaw),
    clientSecrets: reviewed.clientSecrets,
    ...(dynamicGithubServerIds.size > 0 ? {
      resolveProvider: async (ownerId: string, serverId: string, provider: McpOAuthProvider) => {
        if (!dynamicGithubServerIds.has(serverId) || !githubRegistrationStore) return provider;
        const registration = await githubRegistrationStore.get(ownerId);
        if (!registration || registration.status !== 'registered') throw new Error('MCP_GITHUB_APP_NOT_REGISTERED');
        return {
          ...provider,
          clientId: registration.clientId,
          revocationEndpoint: `https://api.github.com/applications/${encodeURIComponent(registration.clientId)}/grant`,
        };
      },
      resolveClientSecret: async (ownerId: string, serverId: string) => {
        if (!dynamicGithubServerIds.has(serverId) || !githubRegistrationStore || !githubSecretCipher) return undefined;
        const registration = await githubRegistrationStore.get(ownerId);
        if (!registration || registration.status !== 'registered') return undefined;
        return githubSecretCipher.open(registration);
      },
    } : {}),
    verifyProvider: async provider => {
      const server = reviewed.servers.find(candidate => candidate.id === provider.serverId);
      if (!server) throw new Error('MCP_OAUTH_DISCOVERY_FAILED');
      await verifyMcpOAuthDiscovery({ server, provider });
    },
  });

  const connectionStore = new PostgresMcpConnectionStore(pool);
  const toolGrantStore = new PostgresMcpToolGrantStore(pool);

  let githubBootstrapRouter: ReturnType<typeof createMcpGithubAppRouter> | undefined;
  if (githubBootstrapEnabled) {
    const expectedOwnerLogin = env.ORIGIN_MCP_GITHUB_OWNER_LOGIN?.trim();
    if (!expectedOwnerLogin || !/^[A-Za-z0-9-]{1,39}$/.test(expectedOwnerLogin) || !githubRegistrationStore || !githubSecretCipher) return invalid();
    const bootstrap = new McpGithubAppBootstrap({
      appOrigin,
      expectedOwnerLogin,
      pendingStore: new PostgresMcpGithubManifestPendingStore(pool),
      registrationStore: githubRegistrationStore,
      secretCipher: githubSecretCipher,
    });
    githubBootstrapRouter = createMcpGithubAppRouter({ appOrigin, bootstrap, authenticate });
  }
  const management = createNodeMcpManagement({
    appOrigin,
    authenticate,
    store: connectionStore,
    toolGrants: toolGrantStore,
    servers: reviewed.servers,
    oauth: broker,
    resolveCredential: (ownerId, serverId) => broker.resolveCredential(ownerId, serverId),
    disconnectCredential: async (ownerId, serverId) => { await broker.disconnect(ownerId, serverId); },
  });

  const readOnlyServers = reviewed.servers.filter(server => server.executionMode === 'read-only');
  if (readOnlyServers.length === 0) return { ...management, ...(githubBootstrapRouter ? { githubBootstrapRouter } : {}) };

  const sessionFactory = createNodeMcpAgentSessionFactory({
    store: connectionStore,
    toolGrants: toolGrantStore,
    servers: readOnlyServers,
    resolveCredential: (ownerId, serverId) => broker.resolveCredential(ownerId, serverId),
    // Exact tool grants are owner-approved and fingerprint pinned. Automatic execution
    // is additionally limited here to connectors reviewed as strict read-only servers.
    authorize: async ({ signal }) => !signal.aborted,
  });
  return {
    ...management,
    agentRouter: createMcpAgentRouter({ authenticate, sessionFactory, env }),
    ...(githubBootstrapRouter ? { githubBootstrapRouter } : {}),
  };
}

/**
 * Browser-facing owner session routes are enabled under the same explicit MCP gate.
 * If MCP is enabled but Auth/session configuration is incomplete, startup fails closed
 * rather than exposing a partially configured login or refresh surface.
 */
export function createMcpProductionSessionRouterFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env.ORIGIN_MCP_ENABLED !== ENABLED) return undefined;
  if (env.FREE_ONLY !== ENABLED) return invalid();
  const router = createSupabaseMcpOwnerSessionRouterFromEnv(env);
  if (!router) return invalid();
  return router;
}