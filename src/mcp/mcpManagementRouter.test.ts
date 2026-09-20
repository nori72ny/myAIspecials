// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { McpConnectionService, type McpConnectionRecord, type McpConnectionStore } from './mcpConnections.js';
import { createMcpManagementRouter } from './mcpManagementRouter.js';

const origin = 'https://origin.example.com';
const server = { id: 'docs', label: 'Documents', endpoint: 'https://mcp.example.com/mcp', zeroCostApproved: true as const };
/** Test-only store. Production must provide the durable atomic implementation. */
function fixture(failProbe = false) {
  const records = new Map<string, McpConnectionRecord>();
  const store: McpConnectionStore = {
    async list(owner) { return [...records.values()].filter(r => r.ownerId === owner); },
    async get(owner, id) { const r = records.get(id); return r?.ownerId === owner ? structuredClone(r) : undefined; },
    async insert(record, limit) { const own = [...records.values()].filter(r => r.ownerId === record.ownerId); if (own.length >= limit || own.some(r => r.serverId === record.serverId)) return false; records.set(record.id, structuredClone(record)); return true; },
    async replace(record, version) { const old = records.get(record.id); if (!old || old.ownerId !== record.ownerId || old.version !== version) return false; records.set(record.id, structuredClone(record)); return true; },
    async remove(owner, id, version) { const old = records.get(id); return old?.ownerId === owner && old.version === version ? records.delete(id) : false; },
  };
  const token = 'secret-service-token';
  const close = vi.fn(async () => {}); const connect = vi.fn(async () => { if (failProbe) throw new Error(token); });
  const createProbe = vi.fn(() => ({ connect, close, catalog: () => [] }));
  const resolveCredential = vi.fn(async () => token as string | undefined);
  const disconnectCredential = vi.fn(async () => {});
  const service = new McpConnectionService({ servers: [server], store, resolveCredential, disconnectCredential, createProbe });
  const app = express(); app.use(express.json());
  // Header identity is ONLY a test adapter; never use this in production.
  app.use(createMcpManagementRouter({ appOrigin: origin, service, authenticate: async req => req.get('test-user') ? { subjectId: req.get('test-user')! } : null }));
  const headers = { origin, 'x-origin-mcp-intent': 'manage', 'test-user': 'alice' };
  async function register() { return (await request(app).post('/api/mcp/connections').set(headers).send({ serverId: 'docs' }).expect(201)).body.connection as McpConnectionRecord; }
  return { app, records, store, token, service, close, connect, createProbe, resolveCredential, disconnectCredential, headers, register };
}

describe('MCP management ownership, credentials and concurrency', () => {
  it('stores connection metadata only and returns no broker credential', async () => {
    const f = fixture(); const record = await f.register();
    const stored = f.records.get(record.id)!;
    expect(stored).not.toHaveProperty('credential'); expect(record).not.toHaveProperty('credential'); expect(record).not.toHaveProperty('ownerId');
    expect(f.resolveCredential).toHaveBeenCalledWith('alice', 'docs');
    const status = await request(f.app).get('/api/mcp/status').set('test-user', 'alice').expect(200);
    expect(status.body.connections).toHaveLength(1); expect(status.body.servers).toEqual([{ id: 'docs', label: 'Documents', authMode: 'broker' }]);
    expect(status.text).not.toContain(f.token); expect(status.headers['cache-control']).toBe('no-store');
  });
  it('requires authentication before reads and all writes', async () => {
    const f = fixture(); expect((await request(f.app).get('/api/mcp/status')).body).toEqual({ configured: true, authenticated: false });
    await request(f.app).post('/api/mcp/connections').set('origin', origin).send({ serverId: 'docs' }).expect(401);
    expect(f.resolveCredential).not.toHaveBeenCalled();
  });
  it('hides another owner’s connections and blocks probing/deleting them', async () => {
    const f = fixture(); const record = await f.register();
    expect((await request(f.app).get('/api/mcp/status').set('test-user', 'bob')).body.connections).toEqual([]);
    const headers = { ...f.headers, 'test-user': 'bob' };
    await request(f.app).post(`/api/mcp/connections/${record.id}/check`).set(headers).send({ version: 1 }).expect(404);
    await request(f.app).delete(`/api/mcp/connections/${record.id}`).set(headers).send({ version: 1 }).expect(404);
    expect(f.createProbe).not.toHaveBeenCalled(); expect(f.disconnectCredential).not.toHaveBeenCalled(); expect(f.records.size).toBe(1);
  });
  it.each(['https://evil.example.com', 'null', 'https://origin.example.com.evil.com'])('blocks cross-origin registration from %s', async unsafeOrigin => {
    const f = fixture(); await request(f.app).post('/api/mcp/connections').set({ ...f.headers, origin: unsafeOrigin }).send({ serverId: 'docs' }).expect(403);
  });
  it('requires mutation intent for deletes and rejects spoofed identity/secret fields', async () => {
    const f = fixture(); const record = await f.register();
    await request(f.app).delete(`/api/mcp/connections/${record.id}`).set({ origin, 'test-user': 'alice' }).send({ version: 1 }).expect(403);
    await request(f.app).post('/api/mcp/connections').set(f.headers).send({ serverId: 'docs', ownerId: 'bob', token: 'secret' }).expect(400);
  });
  it('fails closed for an unknown server, missing broker credentials or duplicate registration', async () => {
    const f = fixture(); await request(f.app).post('/api/mcp/connections').set(f.headers).send({ serverId: 'evil' }).expect(400);
    f.resolveCredential.mockResolvedValueOnce(undefined); await request(f.app).post('/api/mcp/connections').set(f.headers).send({ serverId: 'docs' }).expect(409);
    await f.register(); await request(f.app).post('/api/mcp/connections').set(f.headers).send({ serverId: 'docs' }).expect(409);
  });
  it('re-resolves the current broker credential before every probe and revokes before deletion', async () => {
    const f = fixture(); const record = await f.register();
    f.resolveCredential.mockResolvedValueOnce('fresh-service-token');
    const checked = await request(f.app).post(`/api/mcp/connections/${record.id}/check`).set(f.headers).send({ version: 1 }).expect(200);
    expect(checked.body.verified).toBe(true); expect(checked.body.connection.version).toBe(2); expect(f.close).toHaveBeenCalledOnce();
    expect(f.createProbe).toHaveBeenCalledWith('alice', server, 'fresh-service-token');
    await request(f.app).delete(`/api/mcp/connections/${record.id}`).set(f.headers).send({ version: 1 }).expect(409);
    expect(f.disconnectCredential).not.toHaveBeenCalled();
    await request(f.app).delete(`/api/mcp/connections/${record.id}`).set(f.headers).send({ version: 2 }).expect(200);
    expect(f.disconnectCredential).toHaveBeenCalledWith('alice', 'docs'); expect(f.records.size).toBe(0);
  });
  it('never falls back to a persisted token when broker resolution fails', async () => {
    const f = fixture(); const record = await f.register();
    f.resolveCredential.mockResolvedValueOnce(undefined);
    await request(f.app).post(`/api/mcp/connections/${record.id}/check`).set(f.headers).send({ version: 1 }).expect(409);
    expect(f.createProbe).not.toHaveBeenCalled(); expect(f.records.get(record.id)?.version).toBe(1);
  });
  it('reports probe failure without leaking upstream messages', async () => {
    const f = fixture(true); const record = await f.register();
    const result = await request(f.app).post(`/api/mcp/connections/${record.id}/check`).set(f.headers).send({ version: 1 }).expect(200);
    expect(result.body.verified).toBe(false); expect(result.body.connection.status).toBe('failed'); expect(result.text).not.toContain(f.token); expect(f.close).toHaveBeenCalledOnce();
  });
  it('never resurrects a connection removed while a probe is pending', async () => {
    const f = fixture(); const record = await f.register();
    let finish!: () => void; f.connect.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const probe = f.service.probe('alice', record.id, 1);
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalled());
    await f.service.remove('alice', record.id, 1); finish();
    await expect(probe).rejects.toThrow('MCP_CONNECTION_CHANGED'); expect(f.records.size).toBe(0);
  });
  it('does not delete metadata when broker disconnect fails', async () => {
    const f = fixture(); const record = await f.register();
    f.disconnectCredential.mockRejectedValueOnce(new Error('remote unknown'));
    await request(f.app).delete(`/api/mcp/connections/${record.id}`).set(f.headers).send({ version: 1 }).expect(503);
    expect(f.records.has(record.id)).toBe(true);
  });
  it('exposes OAuth capability, binds start/callback to the session and auto-registers metadata', async () => {
    const f = fixture();
    const supports = vi.fn((serverId: string) => serverId === 'docs');
    const begin = vi.fn(async (_identity: { ownerId: string; sessionBinding: string }, _serverId: string) => ({ authorizationUrl: 'https://auth.example.com/authorize?state=public-state&code_challenge=challenge' }));
    const complete = vi.fn(async (_identity: { ownerId: string; sessionBinding: string }, _serverId: string, _query: URLSearchParams) => ({ linked: true as const, serverId: 'docs' }));
    const app = express(); app.use(express.json());
    app.use(createMcpManagementRouter({
      appOrigin: origin,
      service: f.service,
      oauth: { begin, complete, supports },
      authenticate: async req => req.get('test-user') ? { subjectId: req.get('test-user')!, sessionBinding: req.get('test-session') ?? undefined } : null,
    }));
    const headers = { origin, 'x-origin-mcp-intent': 'manage', 'test-user': 'alice', 'test-session': '33333333-3333-4333-8333-333333333333' };
    const status = await request(app).get('/api/mcp/status').set({ 'test-user': 'alice', 'test-session': headers['test-session'] }).expect(200);
    expect(status.body.servers).toEqual([{ id: 'docs', label: 'Documents', authMode: 'oauth' }]);

    const started = await request(app).post('/api/mcp/oauth/docs/start').set(headers).send({}).expect(200);
    expect(started.body).toEqual({ ok: true, authorizationUrl: 'https://auth.example.com/authorize?state=public-state&code_challenge=challenge' });
    expect(begin).toHaveBeenCalledWith({ ownerId: 'alice', sessionBinding: headers['test-session'] }, 'docs');
    expect(started.text).not.toContain('refresh_token');

    const callback = await request(app).get('/api/mcp/oauth/docs/callback?iss=https%3A%2F%2Fauth.example.com%2F&state=state&code=code')
      .set({ 'test-user': 'alice', 'test-session': headers['test-session'] }).expect(303);
    expect(callback.headers.location).toBe('https://origin.example.com/?mcp=linked');
    expect(complete).toHaveBeenCalledOnce();
    const [identity, callbackServer, query] = complete.mock.calls[0];
    expect(identity).toEqual({ ownerId: 'alice', sessionBinding: headers['test-session'] });
    expect(callbackServer).toBe('docs'); expect(query).toBeInstanceOf(URLSearchParams); expect(query.get('code')).toBe('code');
    expect([...f.records.values()]).toEqual([expect.objectContaining({ ownerId: 'alice', serverId: 'docs', status: 'registered' })]);

    // A fresh callback cannot duplicate metadata; real broker state consumption blocks
    // replay earlier, while this route-level mock verifies idempotent registration logic.
    await request(app).get('/api/mcp/oauth/docs/callback?iss=https%3A%2F%2Fauth.example.com%2F&state=next&code=next')
      .set({ 'test-user': 'alice', 'test-session': headers['test-session'] }).expect(303);
    expect(f.records.size).toBe(1);

    await request(app).post('/api/mcp/oauth/docs/start').set({ ...headers, 'test-session': '' }).send({}).expect(401);
  });
  it('rejects OAuth start for a server not reviewed by the broker', async () => {
    const f = fixture();
    const app = express(); app.use(express.json());
    app.use(createMcpManagementRouter({ appOrigin: origin, service: f.service,
      oauth: { supports: () => false, begin: vi.fn(), complete: vi.fn() },
      authenticate: async () => ({ subjectId: 'alice', sessionBinding: '33333333-3333-4333-8333-333333333333' }) }));
    await request(app).post('/api/mcp/oauth/docs/start').set({ origin, 'x-origin-mcp-intent': 'manage' }).send({}).expect(409);
  });
  it('keeps OAuth disabled when no server broker is configured', async () => {
    const f = fixture();
    await request(f.app).post('/api/mcp/oauth/docs/start').set({ ...f.headers, 'test-session': '33333333-3333-4333-8333-333333333333' }).send({}).expect(503);
  });
  it('is disabled by default, without pretending the user is authenticated', async () => {
    const app = express(); app.use(express.json()); app.use(createMcpManagementRouter());
    expect((await request(app).get('/api/mcp/status')).body).toEqual({ configured: false, authenticated: false });
    await request(app).post('/api/mcp/connections').send({ serverId: 'docs' }).expect(503);
  });
});
