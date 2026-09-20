import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_TOOLS = 200;
const MAX_PAGES = 10;

export class McpBoundaryError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new McpBoundaryError(code); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function toolFingerprint(tool: Tool): string {
  return createHash('sha256').update(canonical(tool)).digest('hex');
}
export function toolAlias(serverId: string, toolName: string): string {
  return `mcp_${createHash('sha256').update(JSON.stringify([serverId, toolName])).digest('hex').slice(0, 48)}`;
}
export interface ToolGrant { name: string; fingerprint: string }
export interface McpSessionOptions {
  /** Obtained from the authenticated session, never the model request. */
  subjectId: string;
  serverId: string;
  /** Trusted server-side grants pin the reviewed tool definition. */
  grants: readonly ToolGrant[];
  /** Must enforce resource ownership, cost policy and any required send/publish approval. */
  authorize: (input: { subjectId: string; serverId: string; toolName: string; arguments: Record<string, unknown>; signal: AbortSignal }) => Promise<boolean>;
  transport: () => Transport;
}

/** One authenticated user's connection to one server. Never use a process-global singleton. */
export class OriginMcpSession {
  private client?: Client;
  private pending?: Promise<void>;
  private closed = false;
  private tools = new Map<string, { tool: Tool; fingerprint: string }>();
  private readonly options: McpSessionOptions;

  constructor(options: McpSessionOptions) {
    if (!options.subjectId || !/^[a-zA-Z0-9-]{1,64}$/.test(options.serverId) || typeof options.authorize !== 'function') fail('MCP_SESSION_INVALID');
    const grants = options.grants.map(grant => ({ ...grant }));
    if (new Set(grants.map(grant => grant.name)).size !== grants.length || grants.some(grant => !/^[a-f0-9]{64}$/.test(grant.fingerprint))) fail('MCP_GRANTS_INVALID');
    this.options = { ...options, grants };
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new McpBoundaryError('MCP_SESSION_CLOSED'));
    if (this.pending) return this.pending;
    if (this.client) return Promise.resolve();
    this.pending = this.initialize().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async initialize(): Promise<void> {
    const client = new Client({ name: 'origin-mcp-client', version: '0.1.0' }, { capabilities: {} });
    client.onclose = () => { if (this.client === client) { this.client = undefined; this.tools.clear(); } };
    let catalogChanged = false;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { catalogChanged = true; this.tools.clear(); });
    try {
      await client.connect(this.options.transport(), { timeout: REQUEST_TIMEOUT_MS });
      const tools = new Map<string, { tool: Tool; fingerprint: string }>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await client.listTools(cursor ? { cursor } : {}, { timeout: REQUEST_TIMEOUT_MS });
        for (const tool of result.tools) {
          if (Buffer.byteLength(JSON.stringify(tool)) > MAX_ARGUMENT_BYTES) fail('MCP_TOOL_SCHEMA_TOO_LARGE');
          const alias = toolAlias(this.options.serverId, tool.name);
          if (tools.has(alias)) fail('MCP_DUPLICATE_TOOL');
          tools.set(alias, { tool, fingerprint: toolFingerprint(tool) });
          if (tools.size > MAX_TOOLS) fail('MCP_TOOL_LIMIT');
        }
        cursor = result.nextCursor;
        if (!cursor) break;
        if (cursors.has(cursor) || page === MAX_PAGES - 1) fail('MCP_PAGINATION_LIMIT');
        cursors.add(cursor);
      }
      if (this.closed) fail('MCP_SESSION_CLOSED');
      if (catalogChanged) fail('MCP_TOOL_CATALOG_CHANGED');
      this.tools = tools;
      this.client = client;
    } catch (error) {
      await client.close().catch(() => undefined);
      this.tools.clear();
      if (error instanceof McpBoundaryError) throw error;
      fail('MCP_CONNECT_FAILED');
    }
  }

  /** Admin review metadata only: remote descriptions are untrusted data, not instructions. */
  catalog() {
    return [...this.tools.entries()].map(([alias, entry]) => ({ alias, fingerprint: entry.fingerprint, tool: structuredClone(entry.tool) }));
  }

  functions() {
    return this.catalog().filter(entry => this.isGranted(entry.tool.name, entry.fingerprint)).map(entry => ({
      type: 'function' as const,
      function: { name: entry.alias, description: entry.tool.description ?? '', parameters: entry.tool.inputSchema },
    }));
  }

  private isGranted(name: string, fingerprint: string): boolean {
    return this.options.grants.some(grant => grant.name === name && grant.fingerprint === fingerprint);
  }

  async dispatch(call: { function: { name: string; arguments: string } }, options: { signal?: AbortSignal } = {}): Promise<string> {
    // Bound the entire operation, including asynchronous authorization. Aborting
    // locally never proves a remote mutation was rolled back; do not replay it.
    const operation = new AbortController();
    // The SDK transmits signal.reason in notifications/cancelled. Never forward
    // an arbitrary caller reason, which may contain document text or credentials.
    const onCallerAbort = () => operation.abort(new McpBoundaryError('MCP_REQUEST_ABORTED'));
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (options.signal?.aborted) onCallerAbort();
    const signal = operation.signal;
    const timeout = setTimeout(() => operation.abort(new McpBoundaryError('MCP_TOOL_TIMEOUT')), REQUEST_TIMEOUT_MS);
    const abortCode = () => (signal.reason as McpBoundaryError).code;
    let onAbort: (() => void) | undefined;
    try {
      if (signal.aborted) fail(abortCode());
      if (!this.client || this.closed) fail('MCP_NOT_CONNECTED');
      const entry = this.tools.get(call?.function?.name);
      if (!entry || !this.isGranted(entry.tool.name, entry.fingerprint)) fail('MCP_TOOL_NOT_AUTHORIZED');
      const raw = call.function.arguments;
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_ARGUMENT_BYTES) fail('MCP_ARGUMENTS_INVALID');
      let args: unknown;
      try { args = JSON.parse(raw); } catch { fail('MCP_ARGUMENTS_INVALID'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) fail('MCP_ARGUMENTS_INVALID');
      // Separate validator instance avoids cross-server schema-$id cache collisions.
      const validator = new AjvJsonSchemaValidator().getValidator(entry.tool.inputSchema);
      if (!validator(args).valid) fail('MCP_ARGUMENTS_INVALID');
      const argumentsObject = args as Record<string, unknown>;
      const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new McpBoundaryError(abortCode()));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      const allowed = await Promise.race([
        this.options.authorize({ subjectId: this.options.subjectId, serverId: this.options.serverId, toolName: entry.tool.name, arguments: structuredClone(argumentsObject), signal }),
        interrupted,
      ]);
      if (signal.aborted) fail(abortCode());
      if (allowed !== true) fail('MCP_TOOL_NOT_AUTHORIZED');
      if (this.closed || !this.client) fail('MCP_NOT_CONNECTED');
      if (this.tools.get(call.function.name) !== entry) fail('MCP_TOOL_CATALOG_CHANGED');
      // No mutation retries: an interrupted response does not prove the tool was not executed.
      const result = await Promise.race([
        this.client.callTool({ name: entry.tool.name, arguments: argumentsObject }, undefined, { timeout: REQUEST_TIMEOUT_MS, signal }),
        interrupted,
      ]);
      if (signal.aborted) fail(abortCode());
      if (result.isError) fail('MCP_REMOTE_TOOL_FAILED');
      const output = JSON.stringify(result);
      if (Buffer.byteLength(output) > MAX_RESULT_BYTES) fail('MCP_RESULT_TOO_LARGE');
      return output;
    } catch (error) {
      // SDK/upstream errors may contain tokens, headers or response bodies.
      return JSON.stringify({ isError: true, code: signal.aborted ? abortCode() : error instanceof McpBoundaryError ? error.code : 'MCP_TOOL_FAILED' });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onCallerAbort);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pending?.catch(() => undefined);
    const client = this.client;
    this.client = undefined;
    this.tools.clear();
    await client?.close().catch(() => undefined);
  }
}

/**
 * Production wiring must provide a reviewed outbound adapter with DNS/IP checks at
 * connection time, redirect rejection, response-byte limits and abort handling.
 * There is intentionally NO native-fetch fallback. This module is not yet routed.
 */
export function httpMcpTransport(endpoint: string, options: {
  allowedOrigins: readonly string[];
  guardedFetch: NonNullable<ConstructorParameters<typeof StreamableHTTPClientTransport>[1]>['fetch'];
  bearerToken?: string;
}): Transport {
  let url: URL;
  try { url = new URL(endpoint); } catch { return fail('MCP_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || !options.allowedOrigins.includes(url.origin)) fail('MCP_ENDPOINT_INVALID');
  if (typeof options.guardedFetch !== 'function') fail('MCP_GUARDED_FETCH_REQUIRED');
  const guardedFetch = options.guardedFetch;
  const fetch: typeof guardedFetch = async (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (new URL(target).href !== url.href) fail('MCP_ENDPOINT_INVALID');
    return guardedFetch(input, { ...init, redirect: 'error' });
  };
  return new StreamableHTTPClientTransport(url, {
    fetch,
    requestInit: options.bearerToken ? { headers: { Authorization: `Bearer ${options.bearerToken}` } } : undefined,
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
}
