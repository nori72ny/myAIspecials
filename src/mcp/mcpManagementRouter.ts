import { Router, type Request, type Response } from 'express';
import { createOriginChatRateLimiter } from '../server/originSecurity.js';
import { McpConnectionService, McpManagementError } from './mcpConnections.js';

export interface McpManagementDependencies {
  appOrigin: string;
  service: McpConnectionService;
  /** Resolve a verified server-side session; never trust request body/query/unsigned identity headers. */
  authenticate: (req: Request) => Promise<{ subjectId: string } | null>;
}
export function createMcpManagementRouter(deps?: McpManagementDependencies) {
  const router = Router();
  router.use('/api/mcp', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use('/api/mcp', createOriginChatRateLimiter(Date.now, ['GET', 'POST', 'DELETE']));
  const failure = (res: Response, error: unknown) => res.status(error instanceof McpManagementError ? error.status : 503).json({ ok: false, code: error instanceof McpManagementError ? error.code : 'MCP_MANAGEMENT_UNAVAILABLE' });
  async function principal(req: Request): Promise<string> {
    if (!deps) throw new McpManagementError('MCP_NOT_CONFIGURED', 503);
    const user = await deps.authenticate(req);
    if (!user || !/^[A-Za-z0-9:_-]{1,192}$/.test(user.subjectId)) throw new McpManagementError('MCP_AUTHENTICATION_REQUIRED', 401);
    return user.subjectId;
  }
  function mutation(req: Request) {
    if (!deps || req.get('origin') !== deps.appOrigin || req.get('x-origin-mcp-intent') !== 'manage') throw new McpManagementError('MCP_CROSS_ORIGIN_BLOCKED', 403);
    if (!req.is('application/json')) throw new McpManagementError('MCP_JSON_REQUIRED', 415);
  }
  function body(req: Request, keys: string[]) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !keys.includes(key))) throw new McpManagementError('MCP_REQUEST_INVALID', 400);
    return req.body as Record<string, unknown>;
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
      return res.json({ configured: true, authenticated: true, ...await deps.service.overview(ownerId) });
    } catch (error) {
      if (error instanceof McpManagementError && error.status === 401) return res.json({ configured: true, authenticated: false });
      return failure(res, error);
    }
  });
  router.post('/api/mcp/connections', async (req, res) => {
    try {
      const owner = await principal(req); mutation(req);
      const { serverId } = body(req, ['serverId']);
      if (typeof serverId !== 'string') throw new McpManagementError('MCP_REQUEST_INVALID', 400);
      return res.status(201).json({ ok: true, connection: await deps!.service.register(owner, serverId) });
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
