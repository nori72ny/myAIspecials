// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { McpConnectionRecord, McpConnectionStore, McpServerChoice } from "./mcpConnections.js";
import type { McpToolGrantStore } from "./mcpToolGrantStore.js";
import { createNodeMcpAgentSessionFactory } from "./mcpNodeIntegration.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<McpConnectionRecord> = {}): McpConnectionRecord {
  return {
    id: CONNECTION,
    ownerId: OWNER,
    serverId: "github",
    endpoint: "https://mcp.example.com/",
    version: 3,
    status: "verified",
    checkedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

function store(value: McpConnectionRecord | undefined): McpConnectionStore {
  return {
    list: async () => value ? [value] : [],
    get: async () => value,
    insert: async () => true,
    replace: async () => true,
    remove: async () => true,
  };
}

function grants(items = [{ name: "read_repository", fingerprint: "a".repeat(64) }]): McpToolGrantStore {
  return {
    list: async () => items,
    replace: async () => undefined,
  };
}

function server(expiresAt = "2026-10-01T00:00:00.000Z"): McpServerChoice {
  return {
    id: "github",
    label: "GitHub",
    endpoint: "https://mcp.example.com/",
    zeroCostApproved: true,
    zeroCostEvidence: {
      evidenceId: "github-free-20260921",
      verifiedAt: "2026-09-21T00:00:00.000Z",
      expiresAt,
      termsUrl: "https://example.com/terms",
      billingPlan: "free",
      paidFallback: false,
    },
  };
}

describe("Node MCP agent session factory", () => {
  it("constructs a session only from owner-scoped durable state and a fresh broker credential", async () => {
    const resolveCredential = vi.fn(async () => "fresh-access-token");
    const factory = createNodeMcpAgentSessionFactory({
      store: store(record()),
      toolGrants: grants(),
      servers: [server()],
      resolveCredential,
      authorize: async () => true,
      now: () => Date.parse("2026-09-21T01:00:00.000Z"),
    });

    const session = await factory.open({ ownerId: OWNER, connectionId: CONNECTION, version: 3 });

    expect(session).toBeDefined();
    expect(resolveCredential).toHaveBeenCalledWith(OWNER, "github");
    await session.close();
  });

  it("fails before credential resolution when the connection version changed", async () => {
    const resolveCredential = vi.fn(async () => "must-not-be-read");
    const factory = createNodeMcpAgentSessionFactory({
      store: store(record({ version: 4 })),
      toolGrants: grants(),
      servers: [server()],
      resolveCredential,
      authorize: async () => true,
      now: () => Date.parse("2026-09-21T01:00:00.000Z"),
    });

    await expect(factory.open({ ownerId: OWNER, connectionId: CONNECTION, version: 3 }))
      .rejects.toMatchObject({ code: "MCP_CONNECTION_CHANGED", status: 409 });
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  it("fails closed when zero-cost evidence expired", async () => {
    const resolveCredential = vi.fn(async () => "must-not-be-read");
    const factory = createNodeMcpAgentSessionFactory({
      store: store(record()),
      toolGrants: grants(),
      servers: [server("2026-09-21T00:30:00.000Z")],
      resolveCredential,
      authorize: async () => true,
      now: () => Date.parse("2026-09-21T01:00:00.000Z"),
    });

    await expect(factory.open({ ownerId: OWNER, connectionId: CONNECTION, version: 3 }))
      .rejects.toMatchObject({ code: "MCP_ZERO_COST_EVIDENCE_EXPIRED", status: 409 });
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  it("requires at least one durable exact-tool grant before reading credentials", async () => {
    const resolveCredential = vi.fn(async () => "must-not-be-read");
    const factory = createNodeMcpAgentSessionFactory({
      store: store(record()),
      toolGrants: grants([]),
      servers: [server()],
      resolveCredential,
      authorize: async () => true,
      now: () => Date.parse("2026-09-21T01:00:00.000Z"),
    });

    await expect(factory.open({ ownerId: OWNER, connectionId: CONNECTION, version: 3 }))
      .rejects.toMatchObject({ code: "MCP_AGENT_NO_APPROVED_TOOLS", status: 409 });
    expect(resolveCredential).not.toHaveBeenCalled();
  });
});
