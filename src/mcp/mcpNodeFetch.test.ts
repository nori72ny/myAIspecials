// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import dns from 'node:dns';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { createNodeMcpFetch, createNodeMcpTransport, isPublicMcpAddress } from './mcpNodeFetch.js';
import { OriginMcpSession, toolAlias, toolFingerprint } from './mcpClient.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const endpoint = 'https://mcp.example.com/mcp';
const origins = ['https://mcp.example.com'];
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

interface MockReply { status?: number; headers?: Record<string, string>; chunks?: string[]; hold?: boolean; truncated?: boolean }
function network(reply: MockReply | ((body: string, method: string) => MockReply) = {}, addresses = [{ address: '93.184.216.34', family: 4 }]) {
  const responses: Array<PassThrough & { complete: boolean }> = [];
  const requests: Array<EventEmitter & { destroy: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> = [];
  const lookup = vi.spyOn(dns, 'lookup').mockImplementation(((host, options, cb) => { queueMicrotask(() => cb(null, addresses)); }) as typeof dns.lookup);
  const request = vi.spyOn(https, 'request').mockImplementation(((url, options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    const req = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
    requests.push(req);
    req.end.mockImplementation((body: string) => {
      const agent = options.agent as https.Agent;
      const secureLookup = agent.options.lookup!;
      secureLookup(new URL(url).hostname, { all: true }, ((failure: Error | null) => {
        if (failure) { req.emit('error', failure); return; }
        if (req.destroy.mock.calls.length) return;
        const plan = typeof reply === 'function' ? reply(body ?? '', options.method ?? 'GET') : reply;
        const res = Object.assign(new PassThrough(), { statusCode: plan.status ?? 200, headers: plan.headers ?? { 'content-type': 'application/json' }, complete: false });
        responses.push(res);
        onResponse(res as unknown as IncomingMessage);
        if (res.destroyed) return;
        for (const chunk of plan.chunks ?? ['{"ok":true}']) res.write(Buffer.from(chunk));
        if (plan.truncated) res.emit('aborted');
        else if (!plan.hold) { res.complete = true; res.end(); }
      }) as Parameters<NonNullable<https.AgentOptions['lookup']>>[2]);
    });
    return req;
  }) as unknown as typeof https.request);
  return { lookup, request, requests, responses };
}
function fetcher(options: { timeoutMs?: number; maxResponseBytes?: number; allowDeleteBody?: boolean; fixedHeaders?: Readonly<Record<string, string>> } = {}) {
  return createNodeMcpFetch({ endpoint, allowedOrigins: origins, ...options });
}

describe('MCP public-address boundary', () => {
  it.each(['127.0.0.1', '10.2.3.4', '100.64.1.2', '169.254.169.254', '172.31.2.3', '192.168.1.2', '0.0.0.0', '192.0.0.8', '192.0.2.1', '192.88.99.1', '198.19.1.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', '2001::1', '2002:7f00:1::', '3fff::1', 'garbage'])('denies private/reserved/transition address %s', address => {
    expect(isPublicMcpAddress(address)).toBe(false);
  });
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])('allows public unicast %s', address => {
    expect(isPublicMcpAddress(address)).toBe(true);
  });
});

describe('guarded Node MCP fetch', () => {
  it('checks all DNS results at socket lookup and sends only to the pinned HTTPS endpoint', async () => {
    const n = network();
    const response = await fetcher()(endpoint, { method: 'POST', body: '{}', headers: { authorization: 'Bearer test' } });
    expect(await response.json()).toEqual({ ok: true });
    expect(n.lookup).toHaveBeenCalledTimes(1);
    expect(n.request.mock.calls[0][1]).toMatchObject({ rejectUnauthorized: true, maxHeaderSize: 16384, headers: { authorization: 'Bearer test', 'accept-encoding': 'identity' } });
  });
  it('injects reviewed GitHub MCP headers and rejects caller attempts to relax them', async () => {
    const n = network();
    const send = fetcher({ fixedHeaders: { 'X-MCP-Readonly': 'true', 'X-MCP-Tools': 'get_file_contents' } });
    const response = await send(endpoint, { method: 'GET' });
    await response.text();
    expect(n.request.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({
        'x-mcp-readonly': 'true',
        'x-mcp-tools': 'get_file_contents',
      }),
    });
    await expect(send(endpoint, { headers: { 'X-MCP-Readonly': 'false' } })).rejects.toThrow('MCP_HEADERS_INVALID');
    expect(n.request).toHaveBeenCalledTimes(1);
  });

  it('keeps DELETE bodies disabled by default and enables them only for an explicit reviewed endpoint client', async () => {
    network();
    await expect(fetcher()(endpoint, { method: 'DELETE', body: '{"access_token":"fixture"}', headers: { 'content-type': 'application/json' } }))
      .rejects.toThrow('MCP_REQUEST_BODY_INVALID');
    vi.restoreAllMocks();
    const n = network();
    const response = await fetcher({ allowDeleteBody: true })(endpoint, { method: 'DELETE', body: '{"access_token":"fixture"}', headers: { 'content-type': 'application/json' } });
    expect(response.status).toBe(200);
    expect(n.request.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    expect(n.requests[0].end).toHaveBeenCalledWith('{"access_token":"fixture"}');
  });
  it('rejects mixed public/private DNS without sending any body', async () => {
    const n = network({}, [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    await expect(fetcher()(endpoint)).rejects.toThrow('MCP_DNS_BLOCKED');
    expect(n.responses).toHaveLength(0); expect(n.requests[0].destroy).toHaveBeenCalled();
  });
  it('checks DNS again for each new request, blocking a rebinding on the next request', async () => {
    const addresses = [{ address: '8.8.8.8', family: 4 }]; const n = network({}, addresses);
    const send = fetcher(); await (await send(endpoint)).text();
    addresses[0].address = '127.0.0.1';
    await expect(send(endpoint)).rejects.toThrow('MCP_DNS_BLOCKED'); expect(n.lookup).toHaveBeenCalledTimes(2);
  });
  it('rejects redirects without contacting the redirected host', async () => {
    const n = network({ status: 302, headers: { location: 'https://internal.example.com/' } });
    await expect(fetcher()(endpoint)).rejects.toThrow('MCP_REDIRECT_BLOCKED'); expect(n.request).toHaveBeenCalledTimes(1);
  });
  it('enforces declared and streamed byte limits including UTF-8 bytes', async () => {
    network({ headers: { 'content-length': '100' } });
    await expect(fetcher({ maxResponseBytes: 10 })(endpoint)).rejects.toThrow('MCP_RESPONSE_TOO_LARGE');
    vi.restoreAllMocks(); network({ chunks: ['ああああ'] });
    const response = await fetcher({ maxResponseBytes: 10 })(endpoint);
    await expect(response.text()).rejects.toThrow('MCP_RESPONSE_TOO_LARGE');
  });
  it('rejects compressed responses instead of allowing decompression expansion', async () => {
    network({ headers: { 'content-encoding': 'gzip' } });
    await expect(fetcher()(endpoint)).rejects.toThrow('MCP_ENCODING_BLOCKED');
  });
  it('streams SSE incrementally and aborts the underlying request on cancellation', async () => {
    const n = network({ headers: { 'content-type': 'text/event-stream' }, chunks: ['data: {"ok":true}\n\n'], hold: true });
    const response = await fetcher()(endpoint); const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data:');
    await reader.cancel(); expect(n.requests[0].destroy).toHaveBeenCalled(); expect(n.responses[0].destroyed).toBe(true);
  });
  it('keeps the total deadline active after response headers arrive', async () => {
    const n = network({ chunks: [], hold: true });
    const response = await fetcher({ timeoutMs: 10 })(endpoint);
    await expect(response.text()).rejects.toThrow('MCP_NETWORK_TIMEOUT'); expect(n.requests[0].destroy).toHaveBeenCalled();
  });
  it('bounds a stalled DNS lookup too', async () => {
    const n = network(); n.lookup.mockImplementation((() => undefined) as unknown as typeof dns.lookup);
    await expect(fetcher({ timeoutMs: 10 })(endpoint)).rejects.toThrow('MCP_NETWORK_TIMEOUT');
    expect(n.responses).toHaveLength(0);
  });
  it('sanitizes TLS and socket error messages before returning them', async () => {
    const n = network(); n.lookup.mockImplementation((() => undefined) as unknown as typeof dns.lookup);
    const pending = fetcher()(endpoint);
    n.requests[0].emit('error', new Error('certificate failure with secret-token'));
    await expect(pending).rejects.toThrow(/^MCP_NETWORK_FAILED$/);
  });
  it('honors caller cancellation before and during a response', async () => {
    const n = network({ chunks: [], hold: true }); const abort = new AbortController();
    const response = await fetcher()(endpoint, { signal: abort.signal }); abort.abort();
    await expect(response.text()).rejects.toThrow('MCP_REQUEST_ABORTED');
    await expect(fetcher()(endpoint, { signal: abort.signal })).rejects.toThrow('MCP_REQUEST_ABORTED');
    expect(n.request).toHaveBeenCalledTimes(1);
  });
  it('rejects truncated responses and strips unapproved response headers', async () => {
    network({ truncated: true }); const response = await fetcher()(endpoint);
    await expect(response.text()).rejects.toThrow('MCP_RESPONSE_TRUNCATED');
    vi.restoreAllMocks(); network({ headers: { 'set-cookie': 'credential=value', 'mcp-session-id': 'session' } });
    const next = await fetcher()(endpoint); await next.text();
    expect(next.headers.get('set-cookie')).toBeNull(); expect(next.headers.get('mcp-session-id')).toBe('session');
  });
  it.each([
    { method: 'PUT' }, { method: 'GET', body: '{}' }, { method: 'POST', body: 'x'.repeat(65537) },
    { headers: { host: 'internal' } }, { headers: { cookie: 'private' } }, { headers: { authorization: 'x'.repeat(8193) } },
  ])('rejects invalid request shapes before network access (%#)', async init => {
    const n = network(); await expect(fetcher()(endpoint, init)).rejects.toThrow(); expect(n.request).not.toHaveBeenCalled();
  });
  it('rejects endpoint changes, IP literals and invalid limits', async () => {
    const n = network(); await expect(fetcher()('https://evil.example.com/mcp')).rejects.toThrow('MCP_ENDPOINT_INVALID');
    expect(() => createNodeMcpFetch({ endpoint: 'https://127.0.0.1/mcp', allowedOrigins: ['https://127.0.0.1'] })).toThrow('MCP_ENDPOINT_INVALID');
    expect(() => fetcher({ timeoutMs: 15001 })).toThrow('MCP_NETWORK_LIMIT_INVALID');
    expect(() => fetcher({ maxResponseBytes: 1048577 })).toThrow('MCP_NETWORK_LIMIT_INVALID'); expect(n.request).not.toHaveBeenCalled();
  });
  it('accepts empty notification responses and preserves ordinary HTTP status codes', async () => {
    network({ status: 202, chunks: [] }); const response = await fetcher()(endpoint); expect(response.status).toBe(202); expect(await response.text()).toBe('');
    vi.restoreAllMocks(); network({ status: 405, chunks: [] }); const next = await fetcher()(endpoint); expect(next.status).toBe(405); await next.text();
  });
});

describe('real MCP SDK over the guarded adapter with simulated HTTPS responses', () => {
  it('initializes, discovers and invokes a granted tool over JSON and SSE', async () => {
    const tool: Tool = { name: 'read_document', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } };
    const methods: string[] = [];
    network((body, method) => {
      if (method === 'GET') return { status: 405, chunks: [] };
      const message = JSON.parse(body); methods.push(message.method);
      if (message.id === undefined) return { status: 202, chunks: [] };
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : message.method === 'tools/list' ? { tools: [tool] } : { content: [{ type: 'text', text: 'document content' }] };
      const json = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
      return message.method === 'tools/call'
        ? { headers: { 'content-type': 'text/event-stream' }, chunks: [`data: ${json}\n\n`] }
        : { chunks: [json] };
    });
    const session = new OriginMcpSession({ subjectId: 'owner', serverId: 'docs', grants: [{ name: tool.name, fingerprint: toolFingerprint(tool) }], authorize: async () => true,
      transport: () => createNodeMcpTransport({ endpoint, allowedOrigins: origins, bearerToken: 'test' }) });
    try {
      await session.connect(); expect(session.functions()).toHaveLength(1);
      const result = await session.dispatch({ function: { name: toolAlias('docs', tool.name), arguments: '{"id":"owned"}' } });
      expect(JSON.parse(result).content[0].text).toBe('document content');
      expect(methods.filter(method => method === 'tools/call')).toHaveLength(1);
    } finally { await session.close(); }
  });
});
