import dns from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpBoundaryError, httpMcpTransport } from './mcpClient.js';

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) denied.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) denied.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

/** Conservative public-unicast policy. IPv4-mapped/transition IPv6 is deliberately denied. */
export function isPublicMcpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, 'ipv4');
  return family === 6 && !address.includes('%') && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}

const requestHeaders = new Set(['accept', 'content-type', 'authorization', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']);
const responseHeaders = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'retry-after', 'www-authenticate'];
function error(code: string): McpBoundaryError { return new McpBoundaryError(code); }
function endpointUrl(endpoint: string, origins: readonly string[]): URL {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw error('MCP_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.port || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !origins.includes(url.origin)) throw error('MCP_ENDPOINT_INVALID');
  return url;
}

export interface McpNodeFetchOptions {
  endpoint: string;
  allowedOrigins: readonly string[];
  /** May reduce, never increase the reviewed limits. */
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** OAuth-only escape hatch for a reviewed DELETE endpoint with a small JSON body. MCP transport leaves this false. */
  allowDeleteBody?: boolean;
}

/** Node-only HTTP/SSE adapter. TLS verification remains on; no environment proxy or native-fetch fallback. */
export function createNodeMcpFetch(options: McpNodeFetchOptions): FetchLike {
  const endpoint = endpointUrl(options.endpoint, options.allowedOrigins);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxResponseBytes ?? 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) throw error('MCP_NETWORK_LIMIT_INVALID');

  return async (input, init = {}) => {
    if (String(input) !== endpoint.href) throw error('MCP_ENDPOINT_INVALID');
    const method = init.method ?? 'GET';
    if (!['GET', 'POST', 'DELETE'].includes(method)) throw error('MCP_METHOD_INVALID');
    const bodyMethodAllowed = method === 'POST' || (method === 'DELETE' && options.allowDeleteBody === true);
    if (init.body != null && (!bodyMethodAllowed || typeof init.body !== 'string' || Buffer.byteLength(init.body) > 64 * 1024)) throw error('MCP_REQUEST_BODY_INVALID');
    if (init.signal?.aborted) throw error('MCP_REQUEST_ABORTED');
    let headers: Headers;
    try { headers = new Headers(init.headers); } catch { throw error('MCP_HEADERS_INVALID'); }
    for (const [name, value] of headers) {
      if (!requestHeaders.has(name) || Buffer.byteLength(value) > 8192) throw error('MCP_HEADERS_INVALID');
    }
    if (Buffer.byteLength(JSON.stringify([...headers])) > 16 * 1024) throw error('MCP_HEADERS_INVALID');
    headers.set('accept-encoding', 'identity');

    return new Promise<Response>((resolve, reject) => {
      let req: ClientRequest | undefined;
      let incoming: IncomingMessage | undefined;
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let done = false;
      const cleanup = () => { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); agent.destroy(); };
      const stop = (code: string) => {
        if (done) return;
        done = true;
        const failure = error(code);
        controller?.error(failure);
        reject(failure);
        req?.destroy(); incoming?.destroy(); cleanup();
      };
      const abort = () => stop('MCP_REQUEST_ABORTED');
      // A fresh agent prevents a previous connection bypassing this lookup. The
      // checked DNS results are returned directly to the socket: no second lookup.
      const agent = new https.Agent({
        keepAlive: false, maxSockets: 1,
        lookup: ((hostname: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (done || hostname !== endpoint.hostname) { callback(error('MCP_DNS_BLOCKED')); return; }
          dns.lookup(hostname, { all: true, verbatim: true }, (failure, addresses) => {
            if (done) { callback(error('MCP_REQUEST_ABORTED')); return; }
            if (failure || !addresses.length || addresses.some(entry => !isPublicMcpAddress(entry.address) || isIP(entry.address) !== entry.family)) {
              callback(error('MCP_DNS_BLOCKED')); return;
            }
            if (lookupOptions?.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        }) as NonNullable<https.AgentOptions['lookup']>,
      });
      const timer = setTimeout(() => stop('MCP_NETWORK_TIMEOUT'), timeoutMs);
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) { abort(); return; }
      try {
        req = https.request(endpoint, { method, headers: Object.fromEntries(headers), agent, maxHeaderSize: 16 * 1024, rejectUnauthorized: true }, response => {
          incoming = response;
          if (done) { response.destroy(); return; }
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) { stop('MCP_REDIRECT_BLOCKED'); return; }
          if (status < 200 || status > 599) { stop('MCP_RESPONSE_INVALID'); return; }
          const encoding = response.headers['content-encoding'];
          if (encoding && encoding !== 'identity') { stop('MCP_ENCODING_BLOCKED'); return; }
          const length = response.headers['content-length'];
          if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { stop('MCP_RESPONSE_TOO_LARGE'); return; }
          const safeHeaders = new Headers();
          for (const name of responseHeaders) {
            const value = response.headers[name];
            if (typeof value === 'string') safeHeaders.set(name, value);
          }
          let bytes = 0;
          const bodyless = status === 204 || status === 205;
          const body = bodyless ? null : new ReadableStream<Uint8Array>({
            start(value) { controller = value; },
            pull() { response.resume(); },
            cancel() {
              if (done) return;
              done = true; req?.destroy(); response.destroy(); cleanup();
            },
          });
          response.on('data', (chunk: Buffer) => {
            if (done) return;
            bytes += chunk.byteLength;
            if (bytes > maxBytes || (bodyless && bytes > 0)) { stop('MCP_RESPONSE_TOO_LARGE'); return; }
            controller?.enqueue(new Uint8Array(chunk));
            if (controller && controller.desiredSize !== null && controller.desiredSize <= 0) response.pause();
          });
          response.on('end', () => {
            if (done) return;
            if (!response.complete) { stop('MCP_RESPONSE_TRUNCATED'); return; }
            done = true; controller?.close(); cleanup();
          });
          response.on('aborted', () => stop('MCP_RESPONSE_TRUNCATED'));
          response.on('error', () => stop('MCP_NETWORK_FAILED'));
          response.on('close', () => { if (!response.complete) stop('MCP_RESPONSE_TRUNCATED'); });
          try { resolve(new Response(body, { status, headers: safeHeaders })); }
          catch { stop('MCP_RESPONSE_INVALID'); }
        });
        req.on('error', failure => stop(failure instanceof McpBoundaryError ? failure.code : 'MCP_NETWORK_FAILED'));
        req.end(init.body ?? undefined);
      } catch { stop('MCP_NETWORK_FAILED'); }
    });
  };
}

/** The Node integration factory always installs the guarded adapter. OAuth remains a separate phase. */
export function createNodeMcpTransport(options: McpNodeFetchOptions & { bearerToken?: string }) {
  return httpMcpTransport(options.endpoint, {
    allowedOrigins: options.allowedOrigins,
    bearerToken: options.bearerToken,
    guardedFetch: createNodeMcpFetch(options),
  });
}
