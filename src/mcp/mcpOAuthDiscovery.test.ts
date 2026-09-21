// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpOAuthProvider } from './mcpOAuthAuthorization.js';
import type { McpServerChoice } from './mcpConnections.js';
import { verifyMcpOAuthDiscovery } from './mcpOAuthDiscovery.js';

const server: McpServerChoice = {
  id: 'github',
  label: 'GitHub',
  endpoint: 'https://api.githubcopilot.com/mcp',
  zeroCostApproved: true,
  executionMode: 'read-only',
  transportProfile: 'github-repos-readonly',
  zeroCostEvidence: {
    evidenceId: 'github-remote-mcp',
    verifiedAt: '2026-09-21T00:00:00.000Z',
    expiresAt: '2026-10-01T00:00:00.000Z',
    termsUrl: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/use-the-github-mcp-server',
    billingPlan: 'free',
    paidFallback: false,
  },
};

const provider: McpOAuthProvider = {
  serverId: 'github',
  issuer: 'https://github.com/login/oauth',
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  tokenEndpoint: 'https://github.com/login/oauth/access_token',
  clientId: 'origin-client',
  redirectUri: 'https://origin.example.com/api/mcp/oauth/github/callback',
  scopes: [],
  permissionModel: 'github-app',
  refreshScope: 'omit',
  revocationEndpoint: 'https://api.github.com/applications/origin-client/grant',
  revocationMethod: 'github-delete-grant',
  tokenEndpointAuthMethod: 'client_secret_post',
  pkceS256: true,
  responseIssuer: false,
  zeroCostApproved: true,
};

function responseJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fixture(overrides: {
  resource?: Record<string, unknown>;
  authorization?: Record<string, unknown>;
  challengeHeader?: string;
} = {}) {
  const resourceMetadataUrl = 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp';
  const authorizationMetadataUrl = 'https://github.com/.well-known/oauth-authorization-server/login/oauth';
  const calls: Array<{ endpoint: string; fixed?: Readonly<Record<string, string>>; init?: RequestInit }> = [];
  const factory = vi.fn((endpoint: string, fixed?: Readonly<Record<string, string>>): FetchLike => async (_input, init) => {
    calls.push({ endpoint, fixed, init });
    if (endpoint === server.endpoint) {
      return new Response('missing token', {
        status: 401,
        headers: {
          'www-authenticate': overrides.challengeHeader
            ?? `Bearer error="invalid_request", resource_metadata="${resourceMetadataUrl}"`,
        },
      });
    }
    if (endpoint === resourceMetadataUrl) {
      return responseJson(overrides.resource ?? {
        resource: server.endpoint,
        authorization_servers: [provider.issuer],
      });
    }
    if (endpoint === authorizationMetadataUrl) {
      return responseJson(overrides.authorization ?? {
        issuer: provider.issuer,
        authorization_endpoint: provider.authorizationEndpoint,
        token_endpoint: provider.tokenEndpoint,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    return new Response('not found', { status: 404 });
  });
  return { factory, calls };
}

describe('MCP OAuth discovery verification', () => {
  it('follows the protected-resource challenge and pins discovered endpoints to reviewed configuration', async () => {
    const f = fixture();
    await expect(verifyMcpOAuthDiscovery({
      server,
      provider,
      guardedFetchFactory: f.factory,
    })).resolves.toBeUndefined();

    expect(f.calls[0].endpoint).toBe(server.endpoint);
    expect(f.calls[0].fixed).toEqual({
      'X-MCP-Readonly': 'true',
      'X-MCP-Toolsets': 'repos',
    });
    expect(f.calls.map(call => call.endpoint)).toContain(
      'https://github.com/.well-known/oauth-authorization-server/login/oauth',
    );
  });

  it.each([
    {
      resource: {
        resource: 'https://api.githubcopilot.com/mcp/other',
        authorization_servers: [provider.issuer],
      },
    },
    {
      resource: {
        resource: server.endpoint,
        authorization_servers: ['https://attacker.example.com/oauth'],
      },
    },
    {
      authorization: {
        issuer: provider.issuer,
        authorization_endpoint: 'https://attacker.example.com/authorize',
        token_endpoint: provider.tokenEndpoint,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      },
    },
    {
      authorization: {
        issuer: provider.issuer,
        authorization_endpoint: provider.authorizationEndpoint,
        token_endpoint: provider.tokenEndpoint,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['plain'],
      },
    },
  ])('fails closed when discovered metadata differs from reviewed configuration %#', async override => {
    const f = fixture(override);
    await expect(verifyMcpOAuthDiscovery({
      server,
      provider,
      guardedFetchFactory: f.factory,
    })).rejects.toThrow('MCP_OAUTH_DISCOVERY_FAILED');
  });

  it('requires exactly one protected-resource reference from the challenge', async () => {
    const url = 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp';
    const f = fixture({
      challengeHeader: `Bearer resource_metadata="${url}", resource_metadata="${url}"`,
    });
    await expect(verifyMcpOAuthDiscovery({
      server,
      provider,
      guardedFetchFactory: f.factory,
    })).rejects.toThrow('MCP_OAUTH_DISCOVERY_FAILED');
  });
});
