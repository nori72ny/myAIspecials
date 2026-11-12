import { Router, type Request, type Response } from 'express';
import { createOriginChatRateLimiter } from '../server/originSecurity.js';
import type { ConnectorAuditEntry, ConnectorAuditRecorder } from './connectorAuditLog.js';
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
  /** Optional connector audit recorder (PR-1a). Absent = operations are not recorded. */
  audit?: ConnectorAuditRecorder;
}
export function createMcpManagementRouter(deps?: McpManagementDependencies) {
  const router = Router();
  router.use('/api/mcp', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use('/api/mcp', createOriginChatRateLimiter(Date.now, ['GET', 'POST', 'DELETE']));
  const failure = (res: Response, error: unknown) => res.status(error instanceof McpManagementError ? error.status : 503).json({ ok: false, code: error instanceof McpManagementError ? error.code : 'MCP_MANAGEMENT_UNAVAILABLE' });
  const auditErrorCode = (error: unknown): string => (error instanceof McpManagementError ? error.code : 'MCP_MANAGEMENT_UNAVAILABLE');
  /**
   * Connector audit (PR-1a): management operations are recorded with
   * identifiers and a short summary only — never request bodies or
   * credentials. The recorder contract is never-throw; a violation is
   * ignored here as well, so auditing can never break management.
   * Unvalidated caller input (a requested server id) is echoed into an
   * entry only when it matches the server-id format; anything else is
   * recorded as the management plane itself, with no echo.
   */
  async function recordAudit(entry: ConnectorAuditEntry): Promise<void> {
    if (!deps?.audit) return;
    try { await deps.audit.record(entry); } catch { /* auditing must never break management */ }
  }
  const auditedServerId = (value: string): string => (/^[A-Za-z0-9-]{1,64}$/.test(value) ? value : 'mcp');
  const serverSummary = (value: string): string => (/^[A-Za-z0-9-]{1,64}$/.test(value) ? `server=${value}` : '');
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
  function readReference(req: Request): { id: string; version: number } {
    const id = req.params.id;
    const keys = Object.keys(req.query);
    const raw = req.query.version;
    const version = typeof raw === 'string' && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
    if (keys.length !== 1 || keys[0] !== 'version' || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)
      || !Number.isSafeInteger(version) || version < 1) throw new McpManagementError('MCP_REQUEST_INVALID', 400);
    return { id, version };
  }
  router.get('/api/mcp/status', async (req, res) => {
    if (!deps) return res.json({ configured: false, authenticated: false });
    let ownerId: string | undefined;
    const started = Date.now();
    try {
      ownerId = await principal(req);
      const overview = await deps.service.overview(ownerId);
      await recordAudit({ ownerId, connectorId: 'mcp', action: 'mcp.status.read', kind: 'read', outcome: 'succeeded', durationMs: Date.now() - started, summary: `connections=${overview.connections.length} servers=${overview.servers.length}` });
      return res.json({ configured: true, authenticated: true, ...overview,
        servers: overview.servers.map(server => ({ ...server, authMode: deps.oauth?.supports(server.id) ? 'oauth' : 'broker' })) });
    } catch (error) {
      if (error instanceof McpManagementError && error.status === 401) return res.json({ configured: true, authenticated: false });
      if (ownerId) await recordAudit({ ownerId, connectorId: 'mcp', action: 'mcp.status.read', kind: 'read', outcome: 'failed', errorCode: auditErrorCode(error), durationMs: Date.now() - started, summary: '' });
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
    const started = Date.now();
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
        const connection = await deps.service.register(who.ownerId, requestedServerId);
        await recordAudit({ ownerId: who.ownerId, connectorId: requestedServerId, action: 'mcp.connection.register', kind: 'manage', outcome: 'succeeded', durationMs: Date.now() - started, summary: `connection=${connection.id} server=${requestedServerId} via=oauth-callback` });
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
      const started = Date.now();
      try {
        const connection = await deps!.service.register(owner, requestedServerId);
        await recordAudit({ ownerId: owner, connectorId: connection.serverId, action: 'mcp.connection.register', kind: 'manage', outcome: 'succeeded', durationMs: Date.now() - started, summary: `connection=${connection.id} server=${connection.serverId}` });
        return res.status(201).json({ ok: true, connection });
      } catch (error) {
        await recordAudit({ ownerId: owner, connectorId: auditedServerId(requestedServerId), action: 'mcp.connection.register', kind: 'manage', outcome: 'failed', errorCode: auditErrorCode(error), durationMs: Date.now() - started, summary: serverSummary(requestedServerId) });
        throw error;
      }
    } catch (error) { return failure(res, error); }
  });
  router.post('/api/mcp/connections/:id/check', async (req, res) => {
    try {
      const owner = await principal(req); mutation(req); const { id, version } = reference(req);
      const started = Date.now();
      try {
        const result = await deps!.service.probe(owner, id, version);
        await recordAudit({ ownerId: owner, connectorId: result.connection.serverId, action: 'mcp.connection.probe', kind: 'manage', outcome: 'succeeded', durationMs: Date.now() - started, summary: `connection=${id} verified=${result.verified} tools=${result.toolCount}` });
        return res.json({ ok: true, ...result });
      } catch (error) {
        await recordAudit({ ownerId: owner, connectorId: 'mcp', action: 'mcp.connection.probe', kind: 'manage', outcome: 'failed', errorCode: auditErrorCode(error), durationMs: Date.now() - started, summary: `connection=${id}` });
        throw error;
      }
    } catch (error) { return failure(res, error); }
  });
  router.get('/api/mcp/connections/:id/tools', async (req, res) => {
    try {
      const owner = await principal(req); const { id, version } = readReference(req);
      return res.json({ ok: true, tools: await deps!.service.catalog(owner, id, version) });
    } catch (error) { return failure(res, error); }
  });
  router.get('/api/mcp/connections/:id/grants', async (req, res) => {
    try {
      const owner = await principal(req); const { id, version } = readReference(req);
      return res.json({ ok: true, grants: await deps!.service.grants(owner, id, version) });
    } catch (error) { return failure(res, error); }
  });
  router.post('/api/mcp/connections/:id/grants', async (req, res) => {
    try {
      const owner = await principal(req); mutation(req);
      const input = body(req, ['version', 'grants']); const id = req.params.id;
      const version = input.version; const grants = input.grants;
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(version) || Number(version) < 1
        || !Array.isArray(grants) || grants.length > 200
        || grants.some(grant => !grant || typeof grant !== 'object' || Array.isArray(grant)
          || Object.keys(grant as Record<string, unknown>).some(key => !['alias', 'fingerprint'].includes(key)))) {
        throw new McpManagementError('MCP_REQUEST_INVALID', 400);
      }
      // This route is itself the owner's approval act, so approved stays
      // true for both outcomes of the grants update.
      const started = Date.now();
      try {
        const result = await deps!.service.approveGrants(owner, id, Number(version), grants as Array<{ alias: string; fingerprint: string }>);
        await recordAudit({ ownerId: owner, connectorId: 'mcp', action: 'mcp.grants.update', kind: 'manage', approved: true, outcome: 'succeeded', durationMs: Date.now() - started, summary: `connection=${id} approved=${result.approved}` });
        return res.json({ ok: true, ...result });
      } catch (error) {
        await recordAudit({ ownerId: owner, connectorId: 'mcp', action: 'mcp.grants.update', kind: 'manage', approved: true, outcome: 'failed', errorCode: auditErrorCode(error), durationMs: Date.now() - started, summary: `connection=${id}` });
        throw error;
      }
    } catch (error) { return failure(res, error); }
  });
  router.delete('/api/mcp/connections/:id', async (req, res) => {
    try {
      const owner = await principal(req); mutation(req); const { id, version } = reference(req);
      const started = Date.now();
      try {
        await deps!.service.remove(owner, id, version);
        await recordAudit({ ownerId: owner, connectorId: 'mcp', action: 'mcp.connection.remove', kind: 'manage', outcome: 'succeeded', durationMs: Date.now() - started, summary: `connection=${id}` });
        return res.json({ ok: true, removed: true });
      } catch (error) {
        await recordAudit({ ownerId: owner, connectorId: 'mcp', action: 'mcp.connection.remove', kind: 'manage', outcome: 'failed', errorCode: auditErrorCode(error), durationMs: Date.now() - started, summary: `connection=${id}` });
        throw error;
      }
    } catch (error) { return failure(res, error); }
  });
  return router;
}
