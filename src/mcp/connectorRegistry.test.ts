// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  connectorAutoExecutableActions,
  connectorDeclarationAllows,
  isConnectorUsable,
  parseConnectorDeclarations,
  reviewedServerToConnectorDeclaration,
  type ConnectorActionDeclaration,
  type ConnectorDeclaration,
} from './connectorRegistry.js';
import type { McpServerChoice } from './mcpConnections.js';

// Type-level pin: a write action cannot even be expressed as auto-executable.
// If the declaration types ever loosen, tsc reports this directive as unused.
// @ts-expect-error write actions are never auto-executable
const illegalWriteAction: ConnectorActionDeclaration = {
  name: 'create-thing',
  kind: 'write',
  inputSchema: {},
  autoExecutable: true,
};
void illegalWriteAction;

const NOW = Date.parse('2026-11-12T00:00:00.000Z');

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceId: 'fixture-free-plan',
    verifiedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 7 * 86400_000).toISOString(),
    termsUrl: 'https://mcp.example.com/pricing',
    billingPlan: 'free',
    paidFallback: false,
    ...overrides,
  };
}

function mcpDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'docs',
    displayName: 'Documents',
    provider: 'example',
    authMethod: 'oauth',
    transport: { kind: 'mcp', endpoint: 'https://mcp.example.com/mcp' },
    actions: [{ name: 'search', kind: 'read', inputSchema: { type: 'object' } }],
    zeroCostEvidence: evidence(),
    ...overrides,
  };
}

function restDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'notes-api',
    displayName: 'Notes API',
    provider: 'notes',
    authMethod: 'api-key',
    transport: { kind: 'rest', baseUrl: 'https://api.notes.example.com/v1' },
    actions: [
      { name: 'list-notes', kind: 'read', inputSchema: { type: 'object' }, autoExecutable: true, rateLimitPerMinute: 60, maxResultBytes: 65536 },
      { name: 'create-note', kind: 'write', inputSchema: { type: 'object', required: ['title'] } },
    ],
    zeroCostEvidence: evidence({ evidenceId: 'notes-free-plan' }),
    enabled: true,
    ...overrides,
  };
}

const parse = (value: unknown) => parseConnectorDeclarations(JSON.stringify(value), NOW);

describe('connector registry declarations (PR-1b)', () => {
  it('parses an MCP OAuth declaration, defaulting enabled and autoExecutable to false', () => {
    const [declaration] = parse([mcpDeclaration()]);
    expect(declaration.id).toBe('docs');
    expect(declaration.displayName).toBe('Documents');
    expect(declaration.authMethod).toBe('oauth');
    expect(declaration.transport).toEqual({ kind: 'mcp', endpoint: 'https://mcp.example.com/mcp' });
    expect(declaration.enabled).toBe(false);
    expect(declaration.actions).toEqual([{ name: 'search', kind: 'read', inputSchema: { type: 'object' }, autoExecutable: false }]);
    expect(declaration.zeroCostEvidence.billingPlan).toBe('free');
    expect(declaration.zeroCostEvidence.paidFallback).toBe(false);
  });

  it('parses REST declarations across the auth vocabulary, with write actions approval-only', () => {
    const [declaration] = parse([restDeclaration()]);
    expect(declaration.enabled).toBe(true);
    expect(declaration.transport).toEqual({ kind: 'rest', baseUrl: 'https://api.notes.example.com/v1' });
    const write = declaration.actions.find(action => action.kind === 'write');
    expect(write?.autoExecutable).toBe(false);
    expect(connectorAutoExecutableActions(declaration).map(action => action.name)).toEqual(['list-notes']);

    const [envToken] = parse([restDeclaration({ id: 'dispatch', authMethod: 'env-token' })]);
    expect(envToken.authMethod).toBe('env-token');
  });

  it('rejects a write action that claims automatic execution', () => {
    const value = restDeclaration({
      actions: [{ name: 'create-note', kind: 'write', inputSchema: { type: 'object' }, autoExecutable: true }],
    });
    expect(() => parse([value])).toThrow('CONNECTOR_DECLARATION_INVALID');
  });

  it.each([
    ['an unknown declaration key', (v: Record<string, unknown>) => { v.futureField = true; }],
    ['an unknown action key', (v: Record<string, unknown>) => { (v.actions as Record<string, unknown>[])[0].url = 'https://evil.example.com'; }],
    ['an unknown transport key', (v: Record<string, unknown>) => { (v.transport as Record<string, unknown>).headers = {}; }],
    ['an mcp transport carrying a REST baseUrl', (v: Record<string, unknown>) => { v.transport = { kind: 'mcp', baseUrl: 'https://mcp.example.com' }; }],
    ['a rest transport missing its baseUrl', (v: Record<string, unknown>) => { v.transport = { kind: 'rest' }; }],
    ['a non-HTTPS endpoint', (v: Record<string, unknown>) => { v.transport = { kind: 'mcp', endpoint: 'http://mcp.example.com/mcp' }; }],
    ['an endpoint with credentials', (v: Record<string, unknown>) => { v.transport = { kind: 'mcp', endpoint: 'https://user:pass@mcp.example.com/mcp' }; }],
    ['an endpoint with an explicit port', (v: Record<string, unknown>) => { v.transport = { kind: 'mcp', endpoint: 'https://mcp.example.com:8443/mcp' }; }],
    ['an unknown auth method', (v: Record<string, unknown>) => { v.authMethod = 'password'; }],
    ['an id with illegal characters', (v: Record<string, unknown>) => { v.id = 'docs server'; }],
    ['an empty display name', (v: Record<string, unknown>) => { v.displayName = '  '; }],
    ['a provider with spaces', (v: Record<string, unknown>) => { v.provider = 'my provider'; }],
    ['a non-boolean enabled flag', (v: Record<string, unknown>) => { v.enabled = 'yes'; }],
    ['duplicate action names', (v: Record<string, unknown>) => {
      v.actions = [
        { name: 'search', kind: 'read', inputSchema: {} },
        { name: 'search', kind: 'write', inputSchema: {} },
      ];
    }],
    ['a non-object input schema', (v: Record<string, unknown>) => { (v.actions as Record<string, unknown>[])[0].inputSchema = ['not', 'an', 'object']; }],
    ['a missing input schema', (v: Record<string, unknown>) => { delete (v.actions as Record<string, unknown>[])[0].inputSchema; }],
    ['a zero rate limit', (v: Record<string, unknown>) => { (v.actions as Record<string, unknown>[])[0].rateLimitPerMinute = 0; }],
    ['a fractional rate limit', (v: Record<string, unknown>) => { (v.actions as Record<string, unknown>[])[0].rateLimitPerMinute = 1.5; }],
    ['a zero result size cap', (v: Record<string, unknown>) => { (v.actions as Record<string, unknown>[])[0].maxResultBytes = 0; }],
    ['paid fallback evidence', (v: Record<string, unknown>) => { v.zeroCostEvidence = evidence({ paidFallback: true }); }],
    ['non-free billing evidence', (v: Record<string, unknown>) => { v.zeroCostEvidence = evidence({ billingPlan: 'trial' }); }],
    ['expired evidence', (v: Record<string, unknown>) => { v.zeroCostEvidence = evidence({ expiresAt: new Date(NOW - 1_000).toISOString() }); }],
    ['an evidence window beyond 31 days', (v: Record<string, unknown>) => { v.zeroCostEvidence = evidence({ expiresAt: new Date(NOW + 40 * 86400_000).toISOString() }); }],
    ['evidence verified too far in the future', (v: Record<string, unknown>) => { v.zeroCostEvidence = evidence({ verifiedAt: new Date(NOW + 10 * 60_000).toISOString() }); }],
    ['a non-HTTPS terms URL', (v: Record<string, unknown>) => { v.zeroCostEvidence = evidence({ termsUrl: 'http://mcp.example.com/pricing' }); }],
  ])('rejects a declaration with %s', (_name, mutate) => {
    const value = mcpDeclaration();
    mutate(value);
    expect(() => parse([value])).toThrow('CONNECTOR_DECLARATION_INVALID');
  });

  it('rejects duplicate connector ids and malformed registries', () => {
    expect(() => parse([mcpDeclaration(), mcpDeclaration()])).toThrow('CONNECTOR_DECLARATION_INVALID');
    expect(() => parseConnectorDeclarations('not json', NOW)).toThrow('CONNECTOR_DECLARATION_INVALID');
    expect(() => parseConnectorDeclarations('{}', NOW)).toThrow('CONNECTOR_DECLARATION_INVALID');
    expect(() => parseConnectorDeclarations('[]', NOW)).toThrow('CONNECTOR_DECLARATION_INVALID');
    expect(() => parse(Array.from({ length: 21 }, (_, i) => mcpDeclaration({ id: `srv-${i}` })))).toThrow('CONNECTOR_DECLARATION_INVALID');
  });
});

describe('reviewed-server compatibility projection', () => {
  const serverEvidence = {
    evidenceId: 'fixture-current-free-plan',
    verifiedAt: '2026-11-11T00:00:00.000Z',
    expiresAt: '2026-11-18T00:00:00.000Z',
    termsUrl: 'https://mcp.example.com/pricing',
    billingPlan: 'free' as const,
    paidFallback: false as const,
  };

  it('projects a management-only reviewed server with no executable actions', () => {
    const server: McpServerChoice = {
      id: 'docs', label: 'Documents', endpoint: 'https://mcp.example.com/mcp',
      zeroCostApproved: true, zeroCostEvidence: serverEvidence,
    };
    const declaration = reviewedServerToConnectorDeclaration(server);
    expect(declaration).toMatchObject({
      id: 'docs', displayName: 'Documents', provider: 'mcp.example.com',
      authMethod: 'oauth', enabled: true,
      transport: { kind: 'mcp', endpoint: 'https://mcp.example.com/mcp' },
    });
    expect(declaration.actions).toEqual([]);
    expect(connectorAutoExecutableActions(declaration)).toEqual([]);
    expect(declaration.zeroCostEvidence).toEqual(serverEvidence);
  });

  it('projects the GitHub read-only profile with exactly one auto-executable read capability', () => {
    const server: McpServerChoice = {
      id: 'github', label: 'GitHub', endpoint: 'https://api.githubcopilot.com/mcp/x/repos/readonly',
      zeroCostApproved: true, zeroCostEvidence: serverEvidence,
      executionMode: 'read-only', transportProfile: 'github-file-readonly',
    };
    const declaration = reviewedServerToConnectorDeclaration(server);
    expect(declaration.provider).toBe('github');
    expect(declaration.actions).toEqual([
      { name: 'github-file-readonly', kind: 'read', inputSchema: {}, autoExecutable: true },
    ]);
    expect(connectorAutoExecutableActions(declaration)).toHaveLength(1);
    expect(declaration.actions.every(action => action.kind === 'read')).toBe(true);
  });

  it('mirrors allows() expiry semantics: evidence expiry closes the connector', () => {
    const server: McpServerChoice = {
      id: 'docs', label: 'Documents', endpoint: 'https://mcp.example.com/mcp',
      zeroCostApproved: true, zeroCostEvidence: serverEvidence,
    };
    const declaration = reviewedServerToConnectorDeclaration(server);
    const expiresAt = Date.parse(serverEvidence.expiresAt);
    expect(connectorDeclarationAllows(declaration, expiresAt - 1)).toBe(true);
    expect(connectorDeclarationAllows(declaration, expiresAt)).toBe(false);
    expect(connectorDeclarationAllows(declaration, expiresAt + 1)).toBe(false);
  });
});

describe('registry usability gates', () => {
  it('requires both the enabled switch and live evidence', () => {
    const [disabled] = parse([mcpDeclaration()]);
    expect(isConnectorUsable(disabled, NOW)).toBe(false);
    const enabled: ConnectorDeclaration = { ...disabled, enabled: true };
    expect(isConnectorUsable(enabled, NOW)).toBe(true);
    const afterExpiry = Date.parse(enabled.zeroCostEvidence.expiresAt) + 1;
    expect(isConnectorUsable(enabled, afterExpiry)).toBe(false);
  });

  it('never surfaces write actions as auto-executable', () => {
    const declaration: ConnectorDeclaration = {
      id: 'mixed', displayName: 'Mixed', provider: 'example', authMethod: 'api-key',
      transport: { kind: 'rest', baseUrl: 'https://api.example.com/v1' },
      actions: [
        { name: 'read-auto', kind: 'read', inputSchema: {}, autoExecutable: true },
        { name: 'read-manual', kind: 'read', inputSchema: {}, autoExecutable: false },
        { name: 'write-it', kind: 'write', inputSchema: {}, autoExecutable: false },
      ],
      zeroCostEvidence: {
        evidenceId: 'fixture', verifiedAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-18T00:00:00.000Z',
        termsUrl: 'https://example.com/pricing', billingPlan: 'free', paidFallback: false,
      },
      enabled: true,
    };
    expect(connectorAutoExecutableActions(declaration).map(action => action.name)).toEqual(['read-auto']);
  });
});
