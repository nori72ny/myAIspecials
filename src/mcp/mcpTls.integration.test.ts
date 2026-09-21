// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import dns from 'node:dns';
import https from 'node:https';
import tls from 'node:tls';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createNodeMcpFetch, createNodeMcpTransport } from './mcpNodeFetch.js';
import { OriginMcpSession, toolAlias, toolFingerprint } from './mcpClient.js';
import { McpOAuthTokenClient } from './mcpOAuthTokenClient.js';

const endpoint = 'https://mcp.origin-test.invalid/mcp';
const allowedOrigins = ['https://mcp.origin-test.invalid'];
let certificate: Buffer;
let key: Buffer;
const cleanup: Array<() => Promise<void>> = [];

// Minimal test-only DER encoding for an ephemeral self-signed certificate.
// Signing and key generation use Node crypto. No production certificate handling,
// external executable, committed private key or sandbox permission is required.
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length = body.length < 128 ? Buffer.from([body.length])
    : body.length < 256 ? Buffer.from([0x81, body.length])
    : Buffer.from([0x82, body.length >> 8, body.length & 255]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}
function testCertificate() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algorithm = der(0x30, Buffer.from('06092a864886f70d01010b0500', 'hex'));
  const name = der(0x30, der(0x31, der(0x30, Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('mcp.origin-test.invalid')))));
  const date = (offset: number) => der(0x18, Buffer.from(new Date(Date.now() + offset).toISOString().replace(/[-:]/g, '').replace('T', '').replace(/\.\d{3}Z$/, 'Z')));
  const extensions = der(0xa3, der(0x30,
    der(0x30, Buffer.from('0603551d130101ff', 'hex'), der(0x04, der(0x30, Buffer.from('0101ff', 'hex')))),
    der(0x30, Buffer.from('0603551d11', 'hex'), der(0x04, der(0x30, der(0x82, Buffer.from('mcp.origin-test.invalid'))))),
  ));
  const body = der(0x30, der(0xa0, Buffer.from('020102', 'hex')), Buffer.from('020101', 'hex'),
    algorithm, name, der(0x30, date(-86_400_000), date(86_400_000)), name,
    pair.publicKey.export({ type: 'spki', format: 'der' }), extensions);
  const signed = der(0x30, body, algorithm, der(0x03, Buffer.from([0]), sign('sha256', body, pair.privateKey)));
  const pem = `-----BEGIN CERTIFICATE-----\n${signed.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  return { certificate: Buffer.from(pem), key: Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })) };
}

beforeAll(() => {
  ({ certificate, key } = testCertificate());
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

/**
 * Controlled TLS peer, NOT a live vendor or public-DNS test. Only DNS and socket
 * destination routing are substituted. The production lookup guard must succeed
 * before a real loopback TLS socket is created; Node performs the handshake,
 * certificate/hostname verification, HTTP parsing and body streaming unchanged.
 * Test CA trust exists only inside this fixture. Production gets no test bypass.
 */
async function peer(handler: (req: IncomingMessage, res: ServerResponse) => void, options: {
  trust?: boolean; hostname?: string; addresses?: Array<{ address: string; family: number }>;
} = {}) {
  const sockets = new Set<Duplex>();
  const server = https.createServer({ key, cert: certificate }, handler);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  });
  const port = (server.address() as { port: number }).port;
  const addresses = options.addresses ?? [{ address: '93.184.216.34', family: 4 }];
  const lookup = vi.spyOn(dns, 'lookup').mockImplementation(((_host, _options, callback) => {
    queueMicrotask(() => callback(null, addresses));
  }) as typeof dns.lookup);
  let connections = 0;
  const connectionOptions: tls.ConnectionOptions[] = [];
  vi.spyOn(https.Agent.prototype, 'createConnection').mockImplementation((function (
    this: https.Agent, supplied: tls.ConnectionOptions & { host: string },
    callback: (err: Error | null, socket?: tls.TLSSocket) => void,
  ) {
    this.options.lookup!(supplied.host, { all: true }, ((failure: Error | null) => {
      if (failure) { callback(failure); return; }
      connections += 1;
      connectionOptions.push(supplied);
      callback(null, tls.connect({ host: '127.0.0.1', port,
        servername: options.hostname ?? supplied.servername,
        rejectUnauthorized: supplied.rejectUnauthorized,
        ...(options.trust === false ? {} : { ca: certificate }),
      }));
    }) as Parameters<NonNullable<https.AgentOptions['lookup']>>[2]);
    return undefined;
  }) as unknown as https.Agent['createConnection']);
  return { lookup, addresses, connections: () => connections, connectionOptions };
}

const fetcher = (options: { timeoutMs?: number; maxResponseBytes?: number } = {}) =>
  createNodeMcpFetch({ endpoint, allowedOrigins, ...options });

describe('MCP guarded adapter over actual TLS sockets', () => {
  it('exchanges, rotates and revokes OAuth tokens over guarded real TLS sockets', async () => {
    const calls: { path: string; form: URLSearchParams }[] = [];
    const first = randomBytes(32).toString('base64url'); const second = randomBytes(32).toString('base64url');
    await peer((req, res) => {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const form = new URLSearchParams(body); calls.push({ path: req.url!, form });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(req.url === '/revoke' ? '' : JSON.stringify({ access_token: randomBytes(32).toString('base64url'),
          refresh_token: form.get('grant_type') === 'refresh_token' ? second : first, token_type: 'Bearer', expires_in: 3600, scope: 'read' }));
      });
    });
    const origin = allowedOrigins[0];
    const client = new McpOAuthTokenClient({ serverId: 'fixture', issuer: origin, authorizationEndpoint: `${origin}/authorize`, tokenEndpoint: `${origin}/token`,
      revocationEndpoint: `${origin}/revoke`, clientId: 'origin', redirectUri: 'https://origin.example.test/callback', resource: endpoint,
      scopes: ['read'], pkceS256: true, responseIssuer: true, zeroCostApproved: true });
    const tokens = await client.exchange(new URLSearchParams({ grant_type: 'authorization_code', code: randomBytes(32).toString('hex'),
      code_verifier: randomBytes(32).toString('base64url'), client_id: 'origin', redirect_uri: 'https://origin.example.test/callback', resource: endpoint }));
    const fresh = await client.refresh(tokens); expect(fresh.refreshToken).toBe(second); expect(await client.revoke(fresh)).toBe(true);
    expect(calls.map(call => call.path)).toEqual(['/token', '/token', '/revoke', '/revoke']);
    expect(calls[1].form.get('refresh_token')).toBe(first);
    expect(calls[1].form.get('resource')).toBe(endpoint);
    expect(calls[2].form.get('token')).toBe(second);
  });
  it.each(['json', 'sse'] as const)('runs initialize/discovery/authorized call over %s and TLS', async format => {
    const tool: Tool = { name: 'read_doc', description: 'Read an owned document', inputSchema: {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
    } };
    const methods: string[] = [];
    const authorization: Array<string | undefined> = [];
    const n = await peer((req, res) => {
      authorization.push(req.headers.authorization);
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const message = JSON.parse(body);
        methods.push(message.method);
        if (message.id === undefined) { res.writeHead(202); res.end(); return; }
        const result = message.method === 'initialize'
          ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-tls-peer', version: '1' } }
          : message.method === 'tools/list' ? { tools: [tool] }
          : { content: [{ type: 'text', text: 'owned document' }] };
        const response = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
        const sse = format === 'sse' && message.method === 'tools/call';
        res.writeHead(200, { 'content-type': sse ? 'text/event-stream' : 'application/json' });
        res.end(sse ? `event: message\ndata: ${response}\n\n` : response);
      });
    });
    const session = new OriginMcpSession({ subjectId: 'owner', serverId: 'fixture',
      grants: [{ name: tool.name, fingerprint: toolFingerprint(tool) }],
      authorize: async input => input.subjectId === 'owner' && input.arguments.id === 'owned',
      transport: () => createNodeMcpTransport({ endpoint, allowedOrigins, bearerToken: 'fixture-credential' }),
    });
    cleanup.push(() => session.close());
    await session.connect();
    const dispatch = (id: string) => session.dispatch({ function: { name: toolAlias('fixture', tool.name), arguments: JSON.stringify({ id }) } });
    expect(JSON.parse(await dispatch('other')).code).toBe('MCP_TOOL_NOT_AUTHORIZED');
    expect(JSON.parse(await dispatch('owned')).content[0].text).toBe('owned document');
    expect(methods.filter(method => method === 'tools/call')).toHaveLength(1);
    expect(methods).toContain('initialize'); expect(methods).toContain('tools/list');
    expect(authorization.every(value => value === 'Bearer fixture-credential')).toBe(true);
    expect(n.lookup.mock.calls.length).toBe(n.connections());
    expect(n.connectionOptions.every(value => value.rejectUnauthorized === true && value.servername === 'mcp.origin-test.invalid')).toBe(true);
  });

  it.each([{ trust: false }, { hostname: 'wrong.origin-test.invalid' }])('rejects invalid certificate trust/hostname before transmitting credentials (%#)', async options => {
    let requests = 0;
    await peer((_req, res) => { requests += 1; res.end('should never arrive'); }, options);
    await expect(fetcher()(endpoint, { method: 'POST', body: '{}', headers: { authorization: 'Bearer fixture-credential' } })).rejects.toThrow(/^MCP_NETWORK_FAILED$/);
    expect(requests).toBe(0);
  });

  it('blocks a DNS change to private space before the second TLS connection', async () => {
    let requests = 0;
    const n = await peer((_req, res) => { requests += 1; res.end('{}'); });
    const send = fetcher(); await (await send(endpoint)).text();
    n.addresses[0].address = '127.0.0.1';
    await expect(send(endpoint)).rejects.toThrow('MCP_DNS_BLOCKED');
    expect(n.connections()).toBe(1); expect(requests).toBe(1);
  });

  it('never follows an HTTP redirect or forwards its credential', async () => {
    let requests = 0;
    await peer((_req, res) => { requests += 1; res.writeHead(302, { location: 'https://127.0.0.1/admin' }); res.end(); });
    await expect(fetcher()(endpoint, { headers: { authorization: 'Bearer fixture-credential' } })).rejects.toThrow('MCP_REDIRECT_BLOCKED');
    expect(requests).toBe(1);
  });

  it('enforces the response byte cap on a real chunked TLS response', async () => {
    await peer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); res.end('あ'.repeat(100)); });
    const response = await fetcher({ maxResponseBytes: 100 })(endpoint);
    await expect(response.text()).rejects.toThrow('MCP_RESPONSE_TOO_LARGE');
  });

  it('times out a real SSE response that never completes after headers', async () => {
    await peer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); res.write(': ready\n\n'); });
    const response = await fetcher({ timeoutMs: 500 })(endpoint);
    await expect(response.text()).rejects.toThrow('MCP_NETWORK_TIMEOUT');
  });

  it('propagates caller cancellation into a live TLS stream', async () => {
    await peer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); res.write(': ready\n\n'); });
    const abort = new AbortController();
    const response = await fetcher()(endpoint, { signal: abort.signal });
    abort.abort();
    await expect(response.text()).rejects.toThrow('MCP_REQUEST_ABORTED');
  });
});
