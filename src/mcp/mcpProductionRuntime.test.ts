// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMcpProductionRuntimeFromEnv, createMcpProductionSessionRouterFromEnv } from './mcpProductionRuntime.js';

const owner = '11111111-1111-4111-8111-111111111111';
const fixtureCa = Buffer.from([
  '-----BEGIN CERTIFICATE-----',
  'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
  '-----END CERTIFICATE-----',
].join('\n')).toString('base64');

function enabledEnv(): NodeJS.ProcessEnv {
  const appOrigin = 'https://origin.example.com';
  const pkceKey = randomBytes(32).toString('base64');
  const tokenKey = randomBytes(32).toString('base64');
  const verifiedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  return {
    ORIGIN_MCP_ENABLED: 'true',
    FREE_ONLY: 'true',
    APP_URL: appOrigin,
    SUPABASE_URL: 'https://project.supabase.co/',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-fixture',
    ORIGIN_OWNER_SUPABASE_USER_IDS: owner,
    ORIGIN_MCP_DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:5432/origin_mcp_fixture',
    ORIGIN_MCP_DATABASE_CA_BASE64: fixtureCa,
    ORIGIN_MCP_PKCE_KEY_BASE64: pkceKey,
    ORIGIN_MCP_TOKEN_KEYRING_JSON: JSON.stringify({ activeKeyId: 'k1', keys: { k1: tokenKey } }),
    ORIGIN_MCP_REVIEWED_SERVERS_JSON: JSON.stringify([{
      id: 'docs',
      label: 'Documents',
      endpoint: 'https://mcp.example.com/mcp',
      zeroCostApproved: true,
      zeroCostEvidence: {
        evidenceId: 'fixture-current-free-plan', verifiedAt, expiresAt,
        termsUrl: 'https://mcp.example.com/pricing', billingPlan: 'free', paidFallback: false,
      },
      oauth: {
        issuer: 'https://auth.example.com/',
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'origin-fixture-client',
        redirectUri: `${appOrigin}/api/mcp/oauth/docs/callback`,
        resource: 'https://mcp.example.com/mcp',
        scopes: ['mcp.read'],
        revocationEndpoint: 'https://auth.example.com/revoke',
        tokenEndpointAuthMethod: 'none',
        pkceS256: true,
        responseIssuer: true,
        zeroCostApproved: true,
      },
    }]),
  };
}

describe('MCP production runtime composition', () => {
  it('remains disabled without an explicit enable flag, including the owner-session surface', () => {
    expect(createMcpProductionRuntimeFromEnv({})).toBeUndefined();
    expect(createMcpProductionSessionRouterFromEnv({})).toBeUndefined();
    expect(createMcpProductionRuntimeFromEnv({ ...enabledEnv(), ORIGIN_MCP_ENABLED: 'false' })).toBeUndefined();
    expect(createMcpProductionSessionRouterFromEnv({ ...enabledEnv(), ORIGIN_MCP_ENABLED: 'false' })).toBeUndefined();
  });

  it('constructs the reviewed OAuth runtime and owner-session router only when prerequisites are present', () => {
    const env = enabledEnv();
    const runtime = createMcpProductionRuntimeFromEnv(env);
    expect(runtime).toBeDefined();
    expect(runtime?.appOrigin).toBe('https://origin.example.com');
    expect(runtime?.oauth?.supports('docs')).toBe(true);
    expect(runtime?.oauth?.supports('unknown')).toBe(false);
    expect(runtime?.agentRouter).toBeUndefined();
    expect(createMcpProductionSessionRouterFromEnv(env)).toBeDefined();
  });

  it('accepts an explicitly reviewed GitHub-style OAuth profile without resource/issuer response requirements', () => {
    const env = enabledEnv();
    const config = JSON.parse(env.ORIGIN_MCP_REVIEWED_SERVERS_JSON!) as Array<Record<string, unknown>>;
    config[0].endpoint = 'https://api.githubcopilot.com/mcp/x/repos/readonly';
    config[0].executionMode = 'read-only';
    config[0].zeroCostEvidence = {
      evidenceId: 'github-mcp-all-users',
      verifiedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      termsUrl: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/use-the-github-mcp-server',
      billingPlan: 'free',
      paidFallback: false,
    };
    config[0].oauth = {
      issuer: 'https://github.com/login/oauth',
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      clientId: 'origin-github-fixture',
      clientSecretEnv: 'ORIGIN_MCP_GITHUB_CLIENT_SECRET',
      redirectUri: 'https://origin.example.com/api/mcp/oauth/docs/callback',
      scopes: ['repo', 'offline_access'],
      untrackedScopes: ['offline_access'],
      refreshScope: 'omit',
      revocationEndpoint: 'https://api.github.com/applications/origin-github-fixture/grant',
      revocationMethod: 'github-delete-grant',
      tokenEndpointAuthMethod: 'client_secret_post',
      pkceS256: true,
      responseIssuer: false,
      zeroCostApproved: true,
    };
    env.ORIGIN_MCP_GITHUB_CLIENT_SECRET = 'fixture-secret';
    env.ORIGIN_MCP_REVIEWED_SERVERS_JSON = JSON.stringify(config);
    const runtime = createMcpProductionRuntimeFromEnv(env);
    expect(runtime?.oauth?.supports('docs')).toBe(true);
    expect(runtime?.agentRouter).toBeDefined();
  });

  it.each([
    ['FREE_ONLY', 'false'],
    ['SUPABASE_PUBLISHABLE_KEY', ''],
    ['ORIGIN_MCP_DATABASE_URL', 'https://not-postgres.example.com'],
    ['ORIGIN_MCP_DATABASE_CA_BASE64', 'invalid'],
    ['ORIGIN_MCP_PKCE_KEY_BASE64', 'invalid'],
    ['ORIGIN_MCP_TOKEN_KEYRING_JSON', '{}'],
  ] as const)('fails closed when enabled configuration %s is invalid', (name, value) => {
    const env = { ...enabledEnv(), [name]: value };
    expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
    if (name === 'FREE_ONLY' || name === 'SUPABASE_PUBLISHABLE_KEY') {
      expect(() => createMcpProductionSessionRouterFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
    }
  });

  it('rejects database URL SSL parameters so they cannot override the verified CA policy', () => {
    for (const suffix of ['?sslmode=disable', '?sslmode=require', '?sslrootcert=/tmp/other.pem']) {
      const env = { ...enabledEnv(), ORIGIN_MCP_DATABASE_URL: `postgres://fixture:fixture@db.example.com:5432/origin${suffix}` };
      expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
    }
  });

  it('requires an exact HTTPS application origin for owner-session cookies and OAuth callbacks', () => {
    for (const appUrl of ['http://origin.example.com', 'https://origin.example.com/path', 'https://origin.example.com?x=1']) {
      const env = { ...enabledEnv(), APP_URL: appUrl };
      expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
      expect(() => createMcpProductionSessionRouterFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
    }
  });

  it('requires the reviewed redirect URI to be the exact owner application callback', () => {
    const env = enabledEnv();
    const config = JSON.parse(env.ORIGIN_MCP_REVIEWED_SERVERS_JSON!) as Array<Record<string, unknown>>;
    (config[0].oauth as Record<string, unknown>).redirectUri = 'https://evil.example.com/callback';
    env.ORIGIN_MCP_REVIEWED_SERVERS_JSON = JSON.stringify(config);
    expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
  });

  it('requires an explicit server-side secret reference for reviewed confidential clients', () => {
    const env = enabledEnv();
    const config = JSON.parse(env.ORIGIN_MCP_REVIEWED_SERVERS_JSON!) as Array<Record<string, unknown>>;
    const oauth = config[0].oauth as Record<string, unknown>;
    oauth.tokenEndpointAuthMethod = 'client_secret_basic';
    oauth.clientSecretEnv = 'ORIGIN_MCP_DOCS_CLIENT_SECRET';
    env.ORIGIN_MCP_REVIEWED_SERVERS_JSON = JSON.stringify(config);
    expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
    env.ORIGIN_MCP_DOCS_CLIENT_SECRET = 'fixture-secret';
    expect(createMcpProductionRuntimeFromEnv(env)?.oauth?.supports('docs')).toBe(true);
  });

  it.each([
    { expiresAt: new Date(Date.now() - 1_000).toISOString() },
    { expiresAt: new Date(Date.now() + 40 * 86400_000).toISOString() },
    { verifiedAt: new Date(Date.now() + 10 * 60_000).toISOString() },
    { termsUrl: 'http://mcp.example.com/pricing' },
    { billingPlan: 'trial' },
    { paidFallback: true },
  ])('rejects stale or non-free connector evidence (%#)', change => {
    const env = enabledEnv();
    const config = JSON.parse(env.ORIGIN_MCP_REVIEWED_SERVERS_JSON!) as Array<Record<string, unknown>>;
    Object.assign(config[0].zeroCostEvidence as Record<string, unknown>, change);
    env.ORIGIN_MCP_REVIEWED_SERVERS_JSON = JSON.stringify(config);
    expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
  });
});
