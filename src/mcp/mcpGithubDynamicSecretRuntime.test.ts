// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMcpProductionRuntimeFromEnv } from './mcpProductionRuntime.js';

const owner = '11111111-1111-4111-8111-111111111111';
const fixtureCa = Buffer.from([
  '-----BEGIN CERTIFICATE-----',
  'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
  '-----END CERTIFICATE-----',
].join('\n')).toString('base64');

function githubDynamicSecretEnv(): NodeJS.ProcessEnv {
  const appOrigin = 'https://origin.example.com';
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
    ORIGIN_MCP_PKCE_KEY_BASE64: randomBytes(32).toString('base64'),
    ORIGIN_MCP_TOKEN_KEYRING_JSON: JSON.stringify({
      activeKeyId: 'k1',
      keys: { k1: randomBytes(32).toString('base64') },
    }),
    ORIGIN_MCP_GITHUB_APP_KEYRING_JSON: JSON.stringify({
      activeKeyId: 'g1',
      keys: { g1: randomBytes(32).toString('base64') },
    }),
    ORIGIN_MCP_REVIEWED_SERVERS_JSON: JSON.stringify([{
      id: 'github-files',
      label: 'GitHub files',
      endpoint: 'https://api.githubcopilot.com/mcp/x/repos/readonly',
      zeroCostApproved: true,
      executionMode: 'read-only',
      transportProfile: 'github-file-readonly',
      zeroCostEvidence: {
        evidenceId: 'github-mcp-free-fixture',
        verifiedAt,
        expiresAt,
        termsUrl: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/use-the-github-mcp-server',
        billingPlan: 'free',
        paidFallback: false,
      },
      oauth: {
        issuer: 'https://github.com/login/oauth',
        authorizationEndpoint: 'https://github.com/login/oauth/authorize',
        tokenEndpoint: 'https://github.com/login/oauth/access_token',
        clientIdSource: 'github-app-registration',
        redirectUri: `${appOrigin}/api/mcp/oauth/github-files/callback`,
        scopes: [],
        permissionModel: 'github-app',
        refreshScope: 'omit',
        revocationMethod: 'github-delete-grant',
        tokenEndpointAuthMethod: 'client_secret_post',
        pkceS256: true,
        responseIssuer: false,
        zeroCostApproved: true,
      },
    }]),
  };
}

describe('GitHub App dynamic OAuth registration runtime bridge', () => {
  it('accepts the reviewed read-only GitHub profile without plaintext client metadata', () => {
    const env = githubDynamicSecretEnv();
    expect(env.ORIGIN_MCP_GITHUB_CLIENT_SECRET).toBeUndefined();
    expect(env.ORIGIN_MCP_REVIEWED_SERVERS_JSON).not.toContain('clientId"');

    const runtime = createMcpProductionRuntimeFromEnv(env);
    expect(runtime).toBeDefined();
    expect(runtime?.oauth?.supports('github-files')).toBe(true);
    expect(runtime?.agentRouter).toBeDefined();
    expect(runtime?.githubBootstrapRouter).toBeUndefined();
  });

  it('fails closed when dynamic GitHub registration metadata lacks the server-only keyring', () => {
    const env = githubDynamicSecretEnv();
    delete env.ORIGIN_MCP_GITHUB_APP_KEYRING_JSON;
    expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
  });

  it('still requires an explicit static secret for non-GitHub confidential OAuth clients', () => {
    const env = githubDynamicSecretEnv();
    const config = JSON.parse(env.ORIGIN_MCP_REVIEWED_SERVERS_JSON!) as Array<Record<string, unknown>>;
    const oauth = config[0].oauth as Record<string, unknown>;
    config[0].endpoint = 'https://mcp.example.com/mcp';
    delete config[0].executionMode;
    delete config[0].transportProfile;
    delete oauth.clientIdSource;
    oauth.clientId = 'origin-confidential-fixture';
    oauth.issuer = 'https://auth.example.com/';
    oauth.authorizationEndpoint = 'https://auth.example.com/authorize';
    oauth.tokenEndpoint = 'https://auth.example.com/token';
    oauth.redirectUri = 'https://origin.example.com/api/mcp/oauth/github-files/callback';
    oauth.scopes = ['read'];
    oauth.permissionModel = 'oauth-scopes';
    oauth.refreshScope = 'include';
    oauth.revocationEndpoint = 'https://auth.example.com/revoke';
    oauth.revocationMethod = 'rfc7009-post';
    oauth.responseIssuer = true;
    env.ORIGIN_MCP_REVIEWED_SERVERS_JSON = JSON.stringify(config);

    expect(() => createMcpProductionRuntimeFromEnv(env)).toThrow('MCP_RUNTIME_CONFIG_INVALID');
  });
});