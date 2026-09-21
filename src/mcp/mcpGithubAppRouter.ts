import { Router, type Request, type Response } from 'express';
import { createOriginChatRateLimiter } from '../server/originSecurity.js';
import type { McpAuthenticatedPrincipal } from './mcpManagementRouter.js';
import type { McpGithubAppBootstrap } from './mcpGithubAppBootstrap.js';

export interface McpGithubAppRouterDependencies {
  appOrigin: string;
  bootstrap: McpGithubAppBootstrap;
  authenticate: (req: Request) => Promise<McpAuthenticatedPrincipal | null>;
}

export function createMcpGithubAppRouter(deps?: McpGithubAppRouterDependencies) {
  const router = Router();
  router.use('/api/mcp/github', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use('/api/mcp/github', createOriginChatRateLimiter(Date.now, ['GET', 'POST']));

  const fail = (res: Response, error: unknown) => {
    const code = error instanceof Error ? error.message : 'MCP_GITHUB_BOOTSTRAP_UNAVAILABLE';
    const status = code === 'MCP_GITHUB_AUTH_INVALID' ? 401
      : code === 'MCP_GITHUB_APP_ALREADY_REGISTERED' ? 409
        : code === 'MCP_GITHUB_CALLBACK_INVALID' || code === 'MCP_GITHUB_CALLBACK_REJECTED' ? 400
          : code === 'MCP_GITHUB_PERMISSION_MISMATCH' ? 409
            : 503;
    return res.status(status).json({ ok: false, code });
  };

  async function identity(req: Request) {
    if (!deps) throw new Error('MCP_GITHUB_NOT_CONFIGURED');
    const user = await deps.authenticate(req);
    if (!user?.subjectId || !user.sessionBinding) throw new Error('MCP_GITHUB_AUTH_INVALID');
    return { ownerId: user.subjectId, sessionBinding: user.sessionBinding };
  }

  function mutation(req: Request) {
    if (!deps || req.get('origin') !== deps.appOrigin || req.get('x-origin-mcp-intent') !== 'manage') {
      throw new Error('MCP_GITHUB_CROSS_ORIGIN_BLOCKED');
    }
    if (!req.is('application/json')) throw new Error('MCP_GITHUB_JSON_REQUIRED');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 0) {
      throw new Error('MCP_GITHUB_REQUEST_INVALID');
    }
  }

  router.post('/api/mcp/github/app/manifest/start', async (req, res) => {
    try {
      mutation(req);
      const who = await identity(req);
      const result = await deps!.bootstrap.begin(who);
      return res.json({ ok: true, ...result });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/api/mcp/github/app/manifest/callback', async (req, res) => {
    try {
      if (!deps) throw new Error('MCP_GITHUB_NOT_CONFIGURED');
      const who = await identity(req);
      const query = new URL(req.originalUrl, deps.appOrigin).searchParams;
      await deps.bootstrap.complete(who, query);
      const destination = new URL('/', deps.appOrigin);
      destination.searchParams.set('mcp', 'github-app-created');
      return res.redirect(303, destination.href);
    } catch (error) {
      return fail(res, error);
    }
  });

  router.all('/api/mcp/github/webhook-disabled', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ ok: false, code: 'MCP_GITHUB_WEBHOOK_DISABLED' });
  });

  return router;
}
