// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool, type CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { OriginMcpSession, httpMcpTransport, toolAlias, toolFingerprint, type McpSessionOptions } from './mcpClient.js';
import { parseMcpConnections } from './mcpConfig.js';

const tool: Tool = { name: 'read__document.v1', description: 'Read a document', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });
async function fixture(options: { grant?: boolean; allowed?: boolean; tools?: Tool[]; fingerprint?: string; subjectId?: string; resultError?: boolean; paginated?: boolean } = {}) {
  const server = new Server({ name: 'test', version: '1' }, { capabilities: { tools: { listChanged: true } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const calls = vi.fn(async (_request: CallToolRequest) => options.resultError ? { isError: true, content: [{ type: 'text', text: 'secret upstream token' }] } : { content: [{ type: 'text', text: 'document' }] });
  const list = vi.fn(async (request) => ({ tools: options.paginated && !request.params?.cursor ? [] : options.tools ?? [tool], ...(options.paginated && !request.params?.cursor ? { nextCursor: 'page2' } : {}) }));
  server.setRequestHandler(ListToolsRequestSchema, list);
  server.setRequestHandler(CallToolRequestSchema, calls);
  await server.connect(serverTransport);
  const authorize = vi.fn(async (_input: Parameters<McpSessionOptions['authorize']>[0]) => options.allowed !== false);
  const transport = vi.fn(() => clientTransport);
  const session = new OriginMcpSession({ subjectId: options.subjectId ?? 'alice', serverId: 'docs', grants: options.grant === false ? [] : [{ name: tool.name, fingerprint: options.fingerprint ?? toolFingerprint(tool) }], authorize, transport });
  cleanup.push(async () => { await session.close(); await server.close(); });
  return { session, server, calls, list, authorize, transport };
}
function call(name = toolAlias('docs', tool.name), args = '{"id":"mine"}') { return { function: { name, arguments: args } }; }

describe('MCP client boundary with the real SDK and in-memory MCP server', () => {
  it('initializes once under concurrent requests and follows discovery pagination', async () => {
    const f = await fixture({ paginated: true });
    await Promise.all([f.session.connect(), f.session.connect(), f.session.connect()]);
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.list).toHaveBeenCalledTimes(2);
    expect(f.session.functions()).toHaveLength(1);
    expect(JSON.parse(await f.session.dispatch(call())).content[0].text).toBe('document');
    expect(f.calls.mock.calls[0][0].params.name).toBe(tool.name);
  });
  it('does not expose or invoke discovered tools without a pinned grant', async () => {
    const f = await fixture({ grant: false }); await f.session.connect();
    expect(f.session.catalog()).toHaveLength(1); expect(f.session.functions()).toEqual([]);
    expect(await f.session.dispatch(call())).toContain('MCP_TOOL_NOT_AUTHORIZED'); expect(f.calls).not.toHaveBeenCalled();
  });
  it('blocks definitions changed since review', async () => {
    const f = await fixture({ tools: [{ ...tool, description: 'new instructions' }] }); await f.session.connect();
    expect(f.session.functions()).toEqual([]); expect(await f.session.dispatch(call())).toContain('MCP_TOOL_NOT_AUTHORIZED');
  });
  it('invalidates the catalog on server list-changed notification', async () => {
    const f = await fixture(); await f.session.connect();
    await f.server.notification({ method: 'notifications/tools/list_changed' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.session.functions()).toEqual([]); expect(await f.session.dispatch(call())).toContain('MCP_TOOL_NOT_AUTHORIZED');
  });
  it.each(['{', 'null', '[]', '{"id":4}', '{}', '{"id":"a","extra":true}', ' '.repeat(65537)])('rejects malformed or schema-invalid arguments without execution (%#)', async raw => {
    const f = await fixture(); await f.session.connect();
    expect(await f.session.dispatch(call(undefined, raw))).toContain('MCP_ARGUMENTS_INVALID');
    expect(f.calls).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled();
  });
  it('requires server-side authorization on each call and isolates users', async () => {
    const alice = await fixture(); const bob = await fixture({ subjectId: 'bob', allowed: false });
    await Promise.all([alice.session.connect(), bob.session.connect()]);
    await alice.session.dispatch(call()); await alice.session.dispatch(call());
    expect(alice.authorize).toHaveBeenCalledTimes(2);
    expect(alice.authorize.mock.calls[0][0]).toMatchObject({ subjectId: 'alice', toolName: tool.name });
    expect(await bob.session.dispatch(call())).toContain('MCP_TOOL_NOT_AUTHORIZED'); expect(bob.calls).not.toHaveBeenCalled();
  });
  it('redacts remote error text and never retries tool execution', async () => {
    const f = await fixture({ resultError: true }); await f.session.connect();
    const result = await f.session.dispatch(call());
    expect(result).toContain('MCP_REMOTE_TOOL_FAILED'); expect(result).not.toContain('secret'); expect(f.calls).toHaveBeenCalledTimes(1);
  });
  it('blocks a catalog invalidated while authorization is pending', async () => {
    const f = await fixture(); await f.session.connect();
    f.authorize.mockImplementationOnce(async () => {
      await f.server.notification({ method: 'notifications/tools/list_changed' });
      await new Promise(resolve => setTimeout(resolve, 0));
      return true;
    });
    expect(await f.session.dispatch(call())).toContain('MCP_TOOL_CATALOG_CHANGED');
    expect(f.calls).not.toHaveBeenCalled();
  });
  it('clears all tools and refuses reconnection after closing', async () => {
    const f = await fixture(); await f.session.connect(); await f.session.close();
    expect(f.session.catalog()).toEqual([]); await expect(f.session.connect()).rejects.toThrow('MCP_SESSION_CLOSED');
    expect(await f.session.dispatch(call())).toContain('MCP_NOT_CONNECTED');
  });
  it('does not authorize or invoke a pre-cancelled dispatch', async () => {
    const f = await fixture(); await f.session.connect();
    const controller = new AbortController(); controller.abort();
    expect(await f.session.dispatch(call(), { signal: controller.signal })).toContain('MCP_REQUEST_ABORTED');
    expect(f.authorize).not.toHaveBeenCalled(); expect(f.calls).not.toHaveBeenCalled();
  });
  it('cancels pending authorization and cannot execute after a late approval', async () => {
    const f = await fixture(); await f.session.connect();
    let allow!: (value: boolean) => void;
    f.authorize.mockImplementationOnce(() => new Promise<boolean>(resolve => { allow = resolve; }));
    const controller = new AbortController();
    const pending = f.session.dispatch(call(), { signal: controller.signal });
    controller.abort();
    expect(await pending).toContain('MCP_REQUEST_ABORTED');
    expect(f.authorize.mock.calls[0][0].signal.aborted).toBe(true);
    allow(true); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls).not.toHaveBeenCalled();
  });
  it('bounds stalled authorization within the same operation deadline', async () => {
    const f = await fixture(); await f.session.connect();
    f.authorize.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    vi.useFakeTimers();
    try {
      const pending = f.session.dispatch(call());
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await pending).toContain('MCP_TOOL_TIMEOUT');
      expect(f.calls).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('cancels an in-flight remote call without replay or a success claim', async () => {
    const f = await fixture(); await f.session.connect();
    const sent = vi.spyOn(f.transport.mock.results[0].value, 'send');
    let started!: () => void;
    const reached = new Promise<void>(resolve => { started = resolve; });
    f.calls.mockImplementationOnce(async () => { started(); return new Promise(() => {}); });
    const controller = new AbortController();
    const pending = f.session.dispatch(call(), { signal: controller.signal });
    await reached; controller.abort('private-document-and-credential-must-not-leave');
    expect(await pending).toContain('MCP_REQUEST_ABORTED');
    expect(f.calls).toHaveBeenCalledTimes(1);
    const messages = sent.mock.calls.map(args => args[0]);
    expect(JSON.stringify(messages)).not.toContain('private-document-and-credential');
    expect(messages).toContainEqual(expect.objectContaining({ method: 'notifications/cancelled', params: expect.objectContaining({ reason: 'Error: MCP_REQUEST_ABORTED' }) }));
  });
  it('rejects duplicate definitions atomically', async () => {
    const f = await fixture({ tools: [tool, tool] });
    await expect(f.session.connect()).rejects.toThrow('MCP_DUPLICATE_TOOL'); expect(f.session.catalog()).toEqual([]);
  });
  it('does not allow callers to mutate trusted grants or discovered metadata', async () => {
    const f = await fixture(); await f.session.connect();
    f.session.catalog()[0].tool.name = 'delete';
    expect(f.session.functions()[0].function.name).toBe(toolAlias('docs', tool.name));
  });
});

describe('MCP configuration and transport', () => {
  it('uses collision-resistant legal function names instead of reversible separators', () => {
    expect(toolAlias('a', 'b.c')).not.toBe(toolAlias('a', 'b__c'));
    expect(toolAlias('a-b', 'c')).not.toBe(toolAlias('a', 'b-c'));
    expect(toolAlias('a', '長い名前'.repeat(100))).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
  it('canonicalizes schema property order when pinning a tool', () => {
    expect(toolFingerprint(tool)).toBe(toolFingerprint({ inputSchema: tool.inputSchema, description: tool.description, name: tool.name }));
  });
  it('resolves credentials after parsing JSON and fails closed when missing', () => {
    const raw = JSON.stringify([{ id: 'docs', url: 'https://example.com/mcp', enabled: true, tokenEnv: 'ORIGIN_MCP_DOCS_TOKEN' }]);
    expect(parseMcpConnections(raw, { ORIGIN_MCP_DOCS_TOKEN: 'contains"quote\\slash' })[0].token).toBe('contains"quote\\slash');
    expect(() => parseMcpConnections(raw, {})).toThrow('MCP_CREDENTIAL_MISSING_OR_INVALID');
    expect(() => parseMcpConnections(raw, { ORIGIN_MCP_DOCS_TOKEN: 'a\r\nb' })).toThrow('MCP_CREDENTIAL_MISSING_OR_INVALID');
  });
  it('rejects duplicated IDs, literal credential fields and ambiguous enabled flags', () => {
    const entry = { id: 'docs', url: 'https://example.com/mcp', enabled: true };
    for (const value of [[entry, entry], [{ ...entry, token: 'secret' }], [{ ...entry, enabled: 'true' }]]) {
      expect(() => parseMcpConnections(JSON.stringify(value), {})).toThrow('MCP_CONFIG_INVALID');
    }
  });
  it.each(['http://example.com/mcp', 'https://u:p@example.com/mcp', 'https://example.com/mcp?token=secret', 'https://example.com:444/mcp', 'https://evil.com/mcp'])('rejects unsafe/unapproved endpoints (%s)', endpoint => {
    expect(() => httpMcpTransport(endpoint, { allowedOrigins: ['https://example.com'], guardedFetch: vi.fn() })).toThrow('MCP_ENDPOINT_INVALID');
  });
  it('has no unguarded fetch fallback', () => {
    expect(() => httpMcpTransport('https://example.com/mcp', { allowedOrigins: ['https://example.com'], guardedFetch: undefined })).toThrow('MCP_GUARDED_FETCH_REQUIRED');
  });
});
