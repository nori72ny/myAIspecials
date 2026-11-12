import type { McpServerChoice, McpZeroCostEvidence } from './mcpConnections.js';

/**
 * Connector registry declarations (CONNECTOR_FRAMEWORK_DESIGN §3.1, PR-1b).
 *
 * This module generalizes today's reviewed-server definitions
 * (`ORIGIN_MCP_REVIEWED_SERVERS_JSON`, parsed in mcpProductionRuntime.ts) into
 * the registry declaration format that future connector phases build on:
 * one vocabulary for MCP servers and native REST connectors alike, with the
 * free/no-retention evidence gate and fail-closed validation carried over.
 *
 * Declarations are inert data. Nothing here is consulted by the production
 * runtime yet, and a declaration by itself enables nothing: effective
 * execution remains gated by the existing machinery — the ORIGIN_MCP_ENABLED
 * kill switch, the reviewed executionMode/transportProfile restriction
 * (automatic execution only for the github-file-readonly profile), and
 * fingerprint-pinned per-tool owner grants. In particular, a read action
 * declaring `autoExecutable: true` states an eligibility ceiling only; it
 * does not widen what may actually run automatically today.
 */

export type ConnectorAuthMethod = 'oauth' | 'api-key' | 'env-token';

export type ConnectorTransport =
  | { kind: 'mcp'; endpoint: string }
  | { kind: 'rest'; baseUrl: string };

interface ConnectorActionDeclarationBase {
  name: string;
  /** JSON Schema object for the action input. Opaque declaration data at this layer. */
  inputSchema: Readonly<Record<string, unknown>>;
  /** Maximum invocations per minute, when declared at this layer. */
  rateLimitPerMinute?: number;
  /** Maximum size in bytes of a single action result, when declared at this layer. */
  maxResultBytes?: number;
}

export interface ConnectorReadActionDeclaration extends ConnectorActionDeclarationBase {
  kind: 'read';
  /** Reads may be declared auto-executable (still subject to grants and the runtime gates above). */
  autoExecutable: boolean;
}

export interface ConnectorWriteActionDeclaration extends ConnectorActionDeclarationBase {
  kind: 'write';
  /**
   * Writes always require per-call approval (design §3.4). The literal type
   * pins this to false: a write action cannot even be expressed as
   * auto-executable, and the parser below rejects declarations that try.
   */
  autoExecutable: false;
}

export type ConnectorActionDeclaration = ConnectorReadActionDeclaration | ConnectorWriteActionDeclaration;

export interface ConnectorDeclaration {
  id: string;
  displayName: string;
  provider: string;
  authMethod: ConnectorAuthMethod;
  /** Connection target is fixed here (host-pinned); action paths/schemas live in the action list. */
  transport: ConnectorTransport;
  actions: readonly ConnectorActionDeclaration[];
  /** Free / no-retention evidence. Expiry closes the connector (fail closed), as with reviewed servers. */
  zeroCostEvidence: McpZeroCostEvidence;
  /** The registry's per-connector switch. Defaults to false when a declaration omits it. */
  enabled: boolean;
}

const CONNECTOR_ID = /^[A-Za-z0-9-]{1,64}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ACTION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EVIDENCE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_DECLARATIONS = 20;
const MAX_ACTIONS = 64;
const MAX_INPUT_SCHEMA_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_RATE_LIMIT_PER_MINUTE = 100_000;
const EVIDENCE_MAX_WINDOW_MS = 31 * 86400_000;
const EVIDENCE_FUTURE_TOLERANCE_MS = 5 * 60_000;

const invalid = (): never => { throw new Error('CONNECTOR_DECLARATION_INVALID'); };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}

/** Same endpoint discipline as the reviewed-server parser: HTTPS, no credentials, no explicit port, no query/fragment. */
function exactHttps(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) return invalid();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !url.hostname.includes('.')) return invalid();
    return url.href;
  } catch { return invalid(); }
}

function parseEvidence(raw: unknown, now: number): McpZeroCostEvidence {
  if (!isRecord(raw)) return invalid();
  rejectUnknownKeys(raw, ['evidenceId', 'verifiedAt', 'expiresAt', 'termsUrl', 'billingPlan', 'paidFallback']);
  if (typeof raw.evidenceId !== 'string' || !EVIDENCE_ID.test(raw.evidenceId)
    || typeof raw.verifiedAt !== 'string' || typeof raw.expiresAt !== 'string' || typeof raw.termsUrl !== 'string'
    || raw.billingPlan !== 'free' || raw.paidFallback !== false) return invalid();
  const verifiedAt = Date.parse(raw.verifiedAt);
  const expiresAt = Date.parse(raw.expiresAt);
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt) || verifiedAt > now + EVIDENCE_FUTURE_TOLERANCE_MS
    || expiresAt <= now || expiresAt <= verifiedAt || expiresAt - verifiedAt > EVIDENCE_MAX_WINDOW_MS) return invalid();
  return {
    evidenceId: raw.evidenceId,
    verifiedAt: raw.verifiedAt,
    expiresAt: raw.expiresAt,
    termsUrl: exactHttps(raw.termsUrl),
    billingPlan: 'free',
    paidFallback: false,
  };
}

function parseTransport(raw: unknown): ConnectorTransport {
  if (!isRecord(raw)) return invalid();
  if (raw.kind === 'mcp') {
    rejectUnknownKeys(raw, ['kind', 'endpoint']);
    return { kind: 'mcp', endpoint: exactHttps(raw.endpoint) };
  }
  if (raw.kind === 'rest') {
    rejectUnknownKeys(raw, ['kind', 'baseUrl']);
    return { kind: 'rest', baseUrl: exactHttps(raw.baseUrl) };
  }
  return invalid();
}

function parseAction(raw: unknown): ConnectorActionDeclaration {
  if (!isRecord(raw)) return invalid();
  rejectUnknownKeys(raw, ['name', 'kind', 'inputSchema', 'rateLimitPerMinute', 'maxResultBytes', 'autoExecutable']);
  if (typeof raw.name !== 'string' || !ACTION_NAME.test(raw.name)) return invalid();
  if (raw.kind !== 'read' && raw.kind !== 'write') return invalid();
  if (!isRecord(raw.inputSchema) || Buffer.byteLength(JSON.stringify(raw.inputSchema)) > MAX_INPUT_SCHEMA_BYTES) return invalid();
  if (raw.rateLimitPerMinute !== undefined
    && (!Number.isInteger(raw.rateLimitPerMinute) || (raw.rateLimitPerMinute as number) < 1 || (raw.rateLimitPerMinute as number) > MAX_RATE_LIMIT_PER_MINUTE)) return invalid();
  if (raw.maxResultBytes !== undefined
    && (!Number.isInteger(raw.maxResultBytes) || (raw.maxResultBytes as number) < 1 || (raw.maxResultBytes as number) > MAX_RESULT_BYTES)) return invalid();
  if (raw.autoExecutable !== undefined && typeof raw.autoExecutable !== 'boolean') return invalid();
  // A write action claiming automatic execution is a forbidden declaration,
  // not a request to honor: reject the whole registry (fail closed).
  if (raw.kind === 'write' && raw.autoExecutable === true) return invalid();
  const base: ConnectorActionDeclarationBase = {
    name: raw.name,
    inputSchema: raw.inputSchema as Record<string, unknown>,
    ...(raw.rateLimitPerMinute === undefined ? {} : { rateLimitPerMinute: raw.rateLimitPerMinute as number }),
    ...(raw.maxResultBytes === undefined ? {} : { maxResultBytes: raw.maxResultBytes as number }),
  };
  return raw.kind === 'write'
    ? { ...base, kind: 'write', autoExecutable: false }
    : { ...base, kind: 'read', autoExecutable: raw.autoExecutable === true };
}

function parseDeclaration(raw: unknown, now: number): ConnectorDeclaration {
  if (!isRecord(raw)) return invalid();
  rejectUnknownKeys(raw, ['id', 'displayName', 'provider', 'authMethod', 'transport', 'actions', 'zeroCostEvidence', 'enabled']);
  if (typeof raw.id !== 'string' || !CONNECTOR_ID.test(raw.id)) return invalid();
  if (typeof raw.displayName !== 'string' || !raw.displayName.trim() || raw.displayName.length > 80) return invalid();
  if (typeof raw.provider !== 'string' || !PROVIDER_ID.test(raw.provider)) return invalid();
  if (raw.authMethod !== 'oauth' && raw.authMethod !== 'api-key' && raw.authMethod !== 'env-token') return invalid();
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return invalid();
  if (!Array.isArray(raw.actions) || raw.actions.length > MAX_ACTIONS) return invalid();
  const actions = raw.actions.map(parseAction);
  if (new Set(actions.map(action => action.name)).size !== actions.length) return invalid();
  return {
    id: raw.id,
    displayName: raw.displayName.trim(),
    provider: raw.provider,
    authMethod: raw.authMethod,
    transport: parseTransport(raw.transport),
    actions,
    zeroCostEvidence: parseEvidence(raw.zeroCostEvidence, now),
    // Default false: a declaration is inert until explicitly enabled.
    enabled: raw.enabled === true,
  };
}

/**
 * Strictly parses registry declarations (the §3.1 format). Any malformed,
 * unknown-keyed, expired-evidence, or write-auto-execution entry invalidates
 * the whole registry — partial acceptance would silently change the reviewed
 * surface, so parsing fails closed exactly like the reviewed-server parser.
 */
export function parseConnectorDeclarations(raw: string, now: number = Date.now()): ConnectorDeclaration[] {
  if (Buffer.byteLength(raw) > 64 * 1024) return invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return invalid(); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_DECLARATIONS) return invalid();
  const declarations = parsed.map(item => parseDeclaration(item, now));
  if (new Set(declarations.map(declaration => declaration.id)).size !== declarations.length) return invalid();
  return declarations;
}

/**
 * Projects a reviewed server (today's format, as produced for
 * McpConnectionService) into a registry declaration without changing any
 * behavior: the projection exists so the registry vocabulary can describe
 * the servers the MCP adapter already reads as-is.
 *
 * Derivation notes:
 * - The reviewed format is OAuth-only by construction (an oauth block is
 *   mandatory), hence authMethod 'oauth'.
 * - A server present in the operator-reviewed JSON is an active reviewed
 *   entry under today's semantics — there is no per-server off switch — so
 *   the projection is enabled: true. The ORIGIN_MCP_ENABLED kill switch and
 *   evidence expiry still gate it exactly as before.
 * - MCP tools are discovered at runtime and pinned by owner grants, so a
 *   static action list cannot enumerate them. The single exception is the
 *   github-file-readonly profile, whose capability ceiling is fixed in code;
 *   it projects to one read capability named by the profile. Every other
 *   reviewed server is management-only today and projects to no actions.
 * - Provider is 'github' for that profile; other servers have no provider
 *   field in today's format, so the endpoint hostname is used as the
 *   deterministic fallback.
 */
export function reviewedServerToConnectorDeclaration(server: McpServerChoice): ConnectorDeclaration {
  const readOnlyProfile = server.executionMode === 'read-only' && server.transportProfile === 'github-file-readonly';
  return {
    id: server.id,
    displayName: server.label,
    provider: readOnlyProfile ? 'github' : new URL(server.endpoint).hostname,
    authMethod: 'oauth',
    transport: { kind: 'mcp', endpoint: server.endpoint },
    actions: readOnlyProfile
      ? [{ name: 'github-file-readonly', kind: 'read', inputSchema: {}, autoExecutable: true }]
      : [],
    zeroCostEvidence: { ...server.zeroCostEvidence },
    enabled: true,
  };
}

/** Evidence liveness with the same boundary semantics as McpConnectionService.allows(): expiry closes the connector. */
export function connectorDeclarationAllows(declaration: ConnectorDeclaration, now: number = Date.now()): boolean {
  return Date.parse(declaration.zeroCostEvidence.expiresAt) > now;
}

/** A declaration is usable only when explicitly enabled AND its free/no-retention evidence is live. */
export function isConnectorUsable(declaration: ConnectorDeclaration, now: number = Date.now()): boolean {
  return declaration.enabled && connectorDeclarationAllows(declaration, now);
}

/**
 * The actions a declaration marks as auto-executable. By construction this
 * can only contain read actions; write actions are approval-only (design
 * §3.4). This is the declared ceiling only — actual automatic execution
 * additionally requires the runtime gates described in the module header.
 */
export function connectorAutoExecutableActions(declaration: ConnectorDeclaration): readonly ConnectorReadActionDeclaration[] {
  return declaration.actions.filter(
    (action): action is ConnectorReadActionDeclaration => action.kind === 'read' && action.autoExecutable,
  );
}
