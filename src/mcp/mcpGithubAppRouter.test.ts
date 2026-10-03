// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMcpGithubAppRouter } from './mcpGithubAppRouter.js';
import type { McpGithubAppBootstrap } from './mcpGithubAppBootstrap.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SESSION = 's'.repeat(64);
const ORIGIN = 'https://origin.example.com';

function fixture(options: { authenticated?: boolean } = {}) {
  const bootstrap = {
    begin: vi.fn(async () => ({
      actionUrl: 'https://github.com/settings/apps/new?state=' + 'a'.repeat(43),
      manifest: '{"name":"ORIGIN Personal Read Only"}',
    })),
    complete: vi.fn(async () => ({
      registered: true,
      appId: 123,
      appSlug: 'origin-personal-read-only',
      clientId: 'Iv1.fixture',
      registrationFingerprint: 'a'.repeat(64),
    })),
  } as unknown as McpGithubAppBootstrap;
  const app = express();
  app.use(express.json());
  app.use(createMcpGithubAppRouter({
    appOrigin: ORIGIN,
    bootstrap,
    authenticate: async () => options.authenticated === false
      ? null
      : { subjectId: OWNER, sessionBinding: SESSION },
  }));
  return { app, bootstrap: bootstrap as unknown as { begin: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> } };
}

describe('GitHub App bootstrap router', () => {
  it('fails closed when the bootstrap is not configured', async () => {
    const app = express();
    app.use(express.json());
    app.use(createMcpGithubAppRouter());
    const response = await request(app)
      .post('/api/mcp/github/app/manifest/start')
      .set('Origin', ORIGIN)
      .set('X-Origin-MCP-Intent', 'manage')
      .send({});
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('MCP_GITHUB_NOT_CONFIGURED');
  });

  it('requires same-origin management intent before starting approval', async () => {
    const f = fixture();
    const response = await request(f.app)
      .post('/api/mcp/github/app/manifest/start')
      .set('Origin', 'https://attacker.example')
      .set('X-Origin-MCP-Intent', 'manage')
      .send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MCP_GITHUB_CROSS_ORIGIN_BLOCKED');
    expect(f.bootstrap.begin).not.toHaveBeenCalled();
  });

  it('requires a verified owner session', async () => {
    const f = fixture({ authenticated: false });
    const response = await request(f.app)
      .post('/api/mcp/github/app/manifest/start')
      .set('Origin', ORIGIN)
      .set('X-Origin-MCP-Intent', 'manage')
      .send({});
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('MCP_GITHUB_AUTH_INVALID');
    expect(f.bootstrap.begin).not.toHaveBeenCalled();
  });

  it('returns only the GitHub action URL and reviewed manifest on start', async () => {
    const f = fixture();
    const response = await request(f.app)
      .post('/api/mcp/github/app/manifest/start')
      .set('Origin', ORIGIN)
      .set('X-Origin-MCP-Intent', 'manage')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.actionUrl).toMatch(/^https:\/\/github\.com\/settings\/apps\/new/);
    expect(response.body.manifest).toContain('ORIGIN Personal Read Only');
    expect(JSON.stringify(response.body)).not.toContain('client_secret');
    expect(f.bootstrap.begin).toHaveBeenCalledWith({ ownerId: OWNER, sessionBinding: SESSION });
  });

  it('consumes callback under the same owner session and redirects without secret material', async () => {
    const f = fixture();
    const response = await request(f.app)
      .get('/api/mcp/github/app/manifest/callback')
      .query({ code: 'a'.repeat(40), state: 'b'.repeat(43) });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('https://origin.example.com/?mcp=github-app-created');
    expect(f.bootstrap.complete).toHaveBeenCalledTimes(1);
    const args = f.bootstrap.complete.mock.calls[0];
    expect(args[0]).toEqual({ ownerId: OWNER, sessionBinding: SESSION });
    expect(args[1]).toBeInstanceOf(URLSearchParams);
  });

  it('keeps the manifest webhook endpoint disabled', async () => {
    const f = fixture();
    const response = await request(f.app).post('/api/mcp/github/webhook-disabled').send({});
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('MCP_GITHUB_WEBHOOK_DISABLED');
  });
});
