import { OriginMcpSession } from './mcpClient.js';
import { McpConnectionService, type McpConnectionStore, type McpServerChoice } from './mcpConnections.js';
import type { McpManagementDependencies } from './mcpManagementRouter.js';
import type { McpToolGrantStore } from './mcpToolGrantStore.js';
import { McpManagementError } from './mcpConnections.js';
import { createNodeMcpTransport } from './mcpNodeFetch.js';
import type { McpAgentSession } from './mcpAgentExecution.js';

/** Explicit Node composition. No automatic owner identity, in-memory store or credential fallback. */
export function createNodeMcpManagement(options: {
  appOrigin: string;
  authenticate: McpManagementDependencies['authenticate'];
  store: McpConnectionStore;
  toolGrants?: McpToolGrantStore;
  servers: readonly McpServerChoice[];
  resolveCredential: (ownerId: string, serverId: string) => Promise<string | undefined>;
  disconnectCredential?: (ownerId: string, serverId: string) => Promise<void>;
  oauth?: McpManagementDependencies['oauth'];
}): McpManagementDependencies {
  const origin = new URL(options.appOrigin);
  if (origin.origin !== options.appOrigin || origin.protocol !== 'https:') throw new Error('MCP_APP_ORIGIN_INVALID');
  return {
    appOrigin: options.appOrigin,
    authenticate: options.authenticate,
    oauth: options.oauth,
    service: new McpConnectionService({
      servers: options.servers,
      store: options.store,
      toolGrants: options.toolGrants,
      resolveCredential: options.resolveCredential,
      disconnectCredential: options.disconnectCredential,
      createProbe: (ownerId, server, token) => new OriginMcpSession({
        subjectId: ownerId, serverId: server.id, grants: [], authorize: async () => false,
        transport: () => createNodeMcpTransport({ endpoint: server.endpoint, allowedOrigins: [new URL(server.endpoint).origin], bearerToken: token }),
      }),
    }),
  };
}


export interface McpAgentSessionFactory {
  open(input: { ownerId: string; connectionId: string; version: number }): Promise<McpAgentSession>;
}

/**
 * Server-only factory for owner-bound agent execution sessions.
 * It re-reads connection metadata, reviewed grants and the current broker credential
 * immediately before remote use. No browser/model supplied server ID or endpoint is trusted.
 */
export function createNodeMcpAgentSessionFactory(options: {
  store: McpConnectionStore;
  toolGrants: McpToolGrantStore;
  servers: readonly McpServerChoice[];
  resolveCredential: (ownerId: string, serverId: string) => Promise<string | undefined>;
  authorize: (input: {
    subjectId: string;
    connectionId: string;
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<boolean>;
  now?: () => number;
}): McpAgentSessionFactory {
  const servers = structuredClone(options.servers);
  if (servers.length < 1 || servers.length > 20 || new Set(servers.map(server => server.id)).size !== servers.length) {
    throw new Error('MCP_AGENT_CONFIG_INVALID');
  }

  return {
    async open(input) {
      if (!input || typeof input.ownerId !== 'string' || !input.ownerId
        || typeof input.connectionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.connectionId)
        || !Number.isSafeInteger(input.version) || input.version < 1) {
        throw new McpManagementError('MCP_AGENT_REQUEST_INVALID', 400);
      }

      const record = await options.store.get(input.ownerId, input.connectionId);
      if (!record || record.ownerId !== input.ownerId || record.id !== input.connectionId) {
        throw new McpManagementError('MCP_CONNECTION_NOT_FOUND', 404);
      }
      if (record.version !== input.version) throw new McpManagementError('MCP_CONNECTION_CHANGED', 409);
      if (record.status !== 'verified') throw new McpManagementError('MCP_CONNECTION_NOT_VERIFIED', 409);

      const server = servers.find(candidate => candidate.id === record.serverId && candidate.endpoint === record.endpoint);
      if (!server) throw new McpManagementError('MCP_SERVER_NOT_ALLOWED', 409);
      const current = options.now?.() ?? Date.now();
      if (!Number.isFinite(current) || Date.parse(server.zeroCostEvidence.expiresAt) <= current) {
        throw new McpManagementError('MCP_ZERO_COST_EVIDENCE_EXPIRED', 409);
      }

      const grants = await options.toolGrants.list(input.ownerId, record.id);
      if (grants.length === 0) throw new McpManagementError('MCP_AGENT_NO_APPROVED_TOOLS', 409);

      const token = await options.resolveCredential(input.ownerId, record.serverId);
      if (typeof token !== 'string' || token.length === 0 || Buffer.byteLength(token) > 8192 || /[\r\n]/.test(token)) {
        throw new McpManagementError('MCP_CREDENTIAL_NOT_LINKED', 409);
      }

      return new OriginMcpSession({
        subjectId: input.ownerId,
        serverId: record.serverId,
        grants,
        authorize: ({ subjectId, serverId, toolName, arguments: args, signal }) => options.authorize({
          subjectId,
          connectionId: record.id,
          serverId,
          toolName,
          arguments: args,
          signal,
        }),
        transport: () => createNodeMcpTransport({
          endpoint: server.endpoint,
          allowedOrigins: [new URL(server.endpoint).origin],
          bearerToken: token,
        }),
      });
    },
  };
}
