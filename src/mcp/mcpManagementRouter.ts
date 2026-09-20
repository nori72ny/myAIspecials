import { Router, type Request, type Response } from 'express';
import { createOriginChatRateLimiter } from '../server/originSecurity.js';
import { McpConnectionService, McpManagementError } from './mcpConnections.js';
import type { McpOAuthBroker } from './mcpOAuthBroker.js';

export interface McpAuthenticatedPrincipal {
  subjectId: string;
  /** Stable, server-verified login-session binding. Required only for OAuth state. */
  sessionBinding?: string;
}
export interface McpManagementDependencies {
  appOrigin: string;
  service: McpConnectionService;
  /** Resolve a verified server-side session; never trust request body/query/unsigned identity headers. */
  authenticate: (req: Request) => Promise<McpAuthenticatedPrincipal | null>;
  /** Disabled unless explicitly provided by the server composition. */
  oauth?: Pick<McpOAuthBroker, 'begin' | 'complete' | 'supports'>;
}
export function createMcpManagementRouter(deps?: McpManagementDependencies) {
  const router = Router();
  router.use('/api/mcp', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use('/api/mcp', createOriginChatRateLimiter(Date.now, ['GET', 'POST', 'DELETE']));
  const failure = (res: Response, error: unknown) => res.status(error instanceof McpManagementError ? error.status : 503).json({ ok: false, code: error instanceof McpManagementError ? error.code : 'MCP_MANAGEMENT_UNAVAILABLE' });
  async function authenticated(req: Request): Promise<McpAuthenticatedPrincipal> {
    if (!deps) throw new McpManagementError('MCP_NOT_CONFIGURED', 503);
    const user = await deps.authenticate(req);
    if (!user || !/^[A-Za-z0-9:_-]{1,192}$/.test(user.subjectId)) throw new McpManagementError('MCP_AUTHENTICATION_REQUIRED', 401);
    return user;
  }
  async function principal(req: Request): Promise<string> { return (await authenticated(req)).subjectId; }
  async function oauthIdentity(req: Request) {
    const user = await authenticated(req);
    if (!user.sessionBinding || user.sessionBinding.length < 32 || user.sessionBinding.length > 8192) throw new McpManagementError('MCP_AUTHENTICATION_REQUIRED', 401);
    return { ownerId: user.subjectId, sessionBinding: user.sessionBinding };
  }
  function mutation(req: Request) {
    if (!deps || req.get('origin') !== deps.appOrigin || req.get('x-origin-mcp-intent') !== 'manage') throw new McpManagementError('MCP_CROSS_ORIGIN_BLOCKED', 403);
    if (!req.is('application/json')) throw new McpManagementError('MCP_JSON_REQUIRED', 415);
  }
  function body(req: Request, keys: string[]) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !keys.includes(key))) throw new McpManagementError('MCP_REQUEST_INVALID', 400);
    return req.body as Record<string, unknown>;
  }
  function serverId(req: Request): string {
    const value = req.params.serverId;
    if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(value)) throw new McpManagementError('MCP_REQUEST_INVALID', 400);
    return value;
  }
  function reference(req: Request): { id: string; version: number } {
    const { version } = body(req, ['version']); const id = req.params.id;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(version) || Number(version) < 1) throw new McpManagementError('MCP_REQUEST_INVALID', 400);
    return { id, version: Number(version) };
  }
  router.get('/api/mcp/status', async (req, res) => {
    if (!deps) return res.json({ configured: false, authenticated: false });
    try {
      const ownerId = await principal(req);
      const overview = await deps.service.overview(ownerId);
      return res.json({ configured: true, authenticated: true, ...overview,
        servers: overview.servers.map(server => ({ ...server, authMode: deps.oauth?.supports(server.id) ? 'oauth' : 'broker' })) });
    } catch (error) {
      if (error instanceof McpManagementError && error.status === 401) return res.json({ configured: true, authenticated: false });
      return failure(res, error);
    }
  });
  router.post('/api/mcp/oauth/:serverId/start', async (req, res) => {
    try {
      if (!deps?.oauth) throw new McpManagementError('MCP_OAUTH_NOT_CONFIGURED', 503);
      const requestedServerId = serverId(req);
      if (!deps.oauth.supports(requestedServerId)) throw new McpManagementError('MCP_OAUTH_NOT_CONFIGURED', 409);
      if (!deps.service.allows(requestedServerId)) throw new McpManagementError('MCP_ZERO_COST_EVIDENCE_EXPIRED', 409);
      const who = await oauthIdentity(req); mutation(req); body(req, []);
      const result = await deps.oauth.begin(who, requestedServerId);
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:' || result.authorizationUrl.length > 8192) throw new Error('MCP_OAUTH_AUTHORIZATION_URL_INVALID');
      return res.json({ ok: true, authorizationUrl: authorizationUrl.href });
    } catch (error) { return failure(res, error); }
  });
  router.get('/api/mcp/oauth/:serverId/callback', async (req, res) => {
    try {
      if (!deps?.oauth) throw new McpManagementError('MCP_OAUTH_NOT_CONFIGURED', 503);
      const requestedServerId = serverId(req);
      if (!deps.oauth.supports(requestedServerId)) throw new McpManagementError('MCP_OAUTH_NOT_CONFIGURED', 409);
      if (!deps.service.allows(requestedServerId)) throw new McpManagementError('MCP_ZERO_COST_EVIDENCE_EXPIRED', 409);
      const who = await oauthIdentity(req);
      const query = new URL(req.originalUrl, deps.appOrigin).searchParams;
      await deps.oauth.complete(who, requestedServerId, query);
      // OAuth is the credential authority. Once exchange is durable, create only the
      // metadata row needed by management/probe. Reauthorization of an existing row
      // must not fail merely because that row already exists.
      const overview = await deps.service.overview(who.ownerId);
      if (!overview.connections.some(connection => connection.serverId === requestedServerId)) {
        await deps.service.register(who.ownerId, requestedServerId);
      }
      const destination = new URL('/', deps.appOrigin); destination.searchParams.set('mcp', 'linked');
      return res.redirect(303, destination.href);
    } catch (error) {
      if (error instanceof McpManagementError) return failure(res, error);
      return res.status(400).json({ ok: false, code: 'MCP_OAUTH_CALLBACK_FAILED' });
    }
  });
  router.post('/api/mcp/connections', async (req, res) => {
    try {
      const owner = await principal(req); mutation(req);
      const { serverId: requestedServerId } = body(req, ['serverId']);
      if (typeof requestedServerId !== 'string') throw new McpManagementError('MCP_REQUEST_INVALID', 400);
      return res.status(201).json({ ok: true, connection: await deps!.service.register(owner, requestedServerId) });
    } catch (error) { return failure(res, error); }
  });
  router.post('/api/mcp/connections/:id/check', async (req, res) => {
    try {
      const owner = await principal(req); mutation(req); const { id, version } = reference(req);
      return res.json({ ok: true, ...await deps!.service.probe(owner, id, version) });
    } catch (error) { return failure(res, error); }
  });
  router.delete('/api/mcp/connections/:id', async (req, res) => {
    try {
      const owner = await principal(req); mutation(req); const { id, version } = reference(req);
      await deps!.service.remove(owner, id, version); return res.json({ ok: true, removed: true });
    } catch (error) { return failure(res, error); }
  });
  return router;
}
