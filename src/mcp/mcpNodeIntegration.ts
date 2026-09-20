import { OriginMcpSession } from './mcpClient.js';
import { McpConnectionService, type McpConnectionStore, type McpServerChoice } from './mcpConnections.js';
import type { McpManagementDependencies } from './mcpManagementRouter.js';
import { createNodeMcpTransport } from './mcpNodeFetch.js';

/** Explicit Node composition. No automatic owner identity, in-memory store or credential fallback. */
export function createNodeMcpManagement(options: {
  appOrigin: string;
  authenticate: McpManagementDependencies['authenticate'];
  store: McpConnectionStore;
  encryptionKey: Buffer;
  servers: readonly McpServerChoice[];
  resolveCredential: (ownerId: string, serverId: string) => Promise<string | undefined>;
}): McpManagementDependencies {
  const origin = new URL(options.appOrigin);
  if (origin.origin !== options.appOrigin || origin.protocol !== 'https:') throw new Error('MCP_APP_ORIGIN_INVALID');
  return {
    appOrigin: options.appOrigin,
    authenticate: options.authenticate,
    service: new McpConnectionService({
      servers: options.servers, store: options.store, key: options.encryptionKey, resolveCredential: options.resolveCredential,
      createProbe: (ownerId, server, token) => new OriginMcpSession({
        subjectId: ownerId, serverId: server.id, grants: [], authorize: async () => false,
        transport: () => createNodeMcpTransport({ endpoint: server.endpoint, allowedOrigins: [new URL(server.endpoint).origin], bearerToken: token }),
      }),
    }),
  };
}
