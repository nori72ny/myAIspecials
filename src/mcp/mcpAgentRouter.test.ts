// @vitest-environment node
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ORIGIN_OPENROUTER_FREE_MODEL } from "../lib/orchestration/OriginExecutionPolicy.js";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog.js";
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from "../legacy/originProviderClient.js";
import type { ConnectorAuditEntry, ConnectorAuditRecorder } from "./connectorAuditLog.js";
import type { McpAgentSession } from "./mcpAgentExecution.js";
import { createMcpAgentRouter } from "./mcpAgentRouter.js";
import { McpBoundaryError } from "./mcpClient.js";
import { McpManagementError } from "./mcpConnections.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";
const ALIAS = "mcp_1234567890abcdef1234567890abcdef1234567890abcdef";
const TEST_NOW = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].verifiedAt) + 1;

function providerResult(text: string): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: {
      allowProviderFallbacks: false,
      dataCollection: "deny",
      requireZeroDataRetention: true,
    },
    routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      strategy: "adaptive-primary",
      provider: "openrouter",
      attempt: 1,
      fallbackUsed: false,
    },
    usage: { costUsd: 0 },
  };
}

function session(overrides: Partial<McpAgentSession> = {}): McpAgentSession {
  return {
    serverId: "github-fixture",
    connect: vi.fn(async () => undefined),
    catalog: vi.fn(() => [{
      alias: ALIAS,
      fingerprint: "a".repeat(64),
      tool: {
        name: "get_file_contents",
        inputSchema: {
          type: "object" as const,
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
    }]),
    functions: vi.fn(() => [{
      type: "function" as const,
      function: {
        name: ALIAS,
        description: "",
        parameters: {
          type: "object" as const,
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
    }]),
    dispatch: vi.fn(async () => JSON.stringify({ ok: true, file: "README.md" })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

function app(options: {
  authenticated?: boolean;
  enabled?: boolean;
  executeProvider?: (request: OriginProviderExecutionRequest) => Promise<OriginProviderExecutionResult>;
  audit?: ConnectorAuditRecorder;
  openFailure?: unknown;
  sessionOverrides?: Partial<McpAgentSession>;
} = {}) {
  const target = session(options.sessionOverrides);
  const open = options.openFailure
    ? vi.fn(async (_input: { ownerId: string; connectionId: string; version: number }) => { throw options.openFailure; })
    : vi.fn(async (_input: { ownerId: string; connectionId: string; version: number }) => target);
  const authenticate = vi.fn(async () => options.authenticated === false ? null : { subjectId: OWNER, sessionBinding: "session" });
  const executeProvider = options.executeProvider ?? vi.fn()
    .mockResolvedValueOnce(providerResult(JSON.stringify({ alias: ALIAS, arguments: { path: "README.md" } })))
    .mockResolvedValueOnce(providerResult("README.md was read successfully."));
  const instance = express();
  instance.use(express.json({ limit: "64kb" }));
  instance.use(createMcpAgentRouter({
    authenticate,
    sessionFactory: { open },
    env: {
      APP_URL: "https://origin.example.com",
      OPENROUTER_API_KEY: "fixture",
      ...(options.enabled === false ? {} : { ORIGIN_MCP_ENABLED: "true" }),
    },
    executeProvider,
    now: () => TEST_NOW,
    ...(options.audit ? { audit: options.audit } : {}),
  }));
  return { instance, target, open, authenticate, executeProvider };
}

function auditRecorder() {
  const entries: ConnectorAuditEntry[] = [];
  const recorder: ConnectorAuditRecorder = {
    record: vi.fn(async (entry: ConnectorAuditEntry) => { entries.push(entry); }),
  };
  return { entries, recorder };
}

describe("MCP owner tool-chat router", () => {
  it("runs one owner-approved tool round without exposing the raw tool result", async () => {
    const fixture = app();
    const response = await request(fixture.instance)
      .post("/api/mcp/chat")
      .set("Origin", "https://origin.example.com")
      .send({
        connectionId: CONNECTION,
        version: 3,
        messages: [{ role: "user", content: "Read README.md and summarize it." }],
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.content).toBe("README.md was read successfully.");
    expect(response.body.routing.costEvidenceStatus).toBe("NOT_MEASURED");
    expect(response.body.routing.actualCostUsd).toBe(0); // Deprecated compatibility field; not a billing receipt.
    expect(response.body.mcp).toEqual({
      connectionId: CONNECTION,
      connectionVersion: 3,
      selectedAlias: ALIAS,
      toolRounds: 1,
    });
    expect(JSON.stringify(response.body)).not.toContain('"file":"README.md"');
    expect(fixture.open).toHaveBeenCalledWith({ ownerId: OWNER, connectionId: CONNECTION, version: 3 });
    expect(fixture.target.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.executeProvider).toHaveBeenCalledTimes(2);
  });

  it("requires the verified owner session before opening any connector", async () => {
    const fixture = app({ authenticated: false });
    const response = await request(fixture.instance)
      .post("/api/mcp/chat")
      .set("Origin", "https://origin.example.com")
      .send({
        connectionId: CONNECTION,
        version: 3,
        messages: [{ role: "user", content: "Read README.md." }],
      });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("MCP_AUTH_REQUIRED");
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.executeProvider).not.toHaveBeenCalled();
  });

  it("fails closed at the kill switch before authentication or session creation when MCP is not enabled", async () => {
    const fixture = app({ enabled: false });
    const response = await request(fixture.instance)
      .post("/api/mcp/chat")
      .set("Origin", "https://origin.example.com")
      .send({
        connectionId: CONNECTION,
        version: 3,
        messages: [{ role: "user", content: "Read README.md." }],
      });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("MCP_AGENT_UNAVAILABLE");
    expect(response.body.retryable).toBe(false);
    expect(fixture.authenticate).not.toHaveBeenCalled();
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.executeProvider).not.toHaveBeenCalled();
  });

  it("blocks cross-origin submission before authentication or provider execution", async () => {
    const fixture = app();
    const response = await request(fixture.instance)
      .post("/api/mcp/chat")
      .set("Origin", "https://attacker.example")
      .send({
        connectionId: CONNECTION,
        version: 3,
        messages: [{ role: "user", content: "Read README.md." }],
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CROSS_ORIGIN_REQUEST_BLOCKED");
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.executeProvider).not.toHaveBeenCalled();
  });

  // The credential below is an intentionally obvious fake fixture (repeated
  // "FAKE", shorter than a real token suffix). Never use a realistic-format
  // token string here: this repository is public.
  it("blocks detected credentials before connector or model egress", async () => {
    const fixture = app();
    const response = await request(fixture.instance)
      .post("/api/mcp/chat")
      .set("Origin", "https://origin.example.com")
      .send({
        connectionId: CONNECTION,
        version: 3,
        messages: [{ role: "user", content: "Use token ghp_FAKEFAKEFAKEFAKEFAKEFAKE to inspect the repo." }],
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED");
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.executeProvider).not.toHaveBeenCalled();
  });
});

describe("connector audit for MCP tool execution (system A)", () => {
  const post = (instance: express.Express) => request(instance)
    .post("/api/mcp/chat")
    .set("Origin", "https://origin.example.com")
    .send({
      connectionId: CONNECTION,
      version: 3,
      messages: [{ role: "user", content: "Read README.md and summarize it." }],
    });

  it("records one entry for a completed tool round, with identifiers and measurements only", async () => {
    const { entries, recorder } = auditRecorder();
    const fixture = app({ audit: recorder });
    const response = await post(fixture.instance);

    expect(response.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      ownerId: OWNER,
      connectorId: "github-fixture",
      action: "mcp.tool.execute",
      kind: "read",
      approved: true,
      outcome: "succeeded",
      durationMs: 0,
      resultSizeBytes: Buffer.byteLength(JSON.stringify({ ok: true, file: "README.md" }), "utf8"),
      summary: `connection=${CONNECTION} alias=${ALIAS}`,
    });
    // Neither the tool result body nor the message text may reach the entry.
    expect(JSON.stringify(entries[0])).not.toContain("README.md was read");
    expect(entries[0]?.summary).not.toContain("README");
  });

  it("records a failed entry with the precise boundary code when dispatch fails", async () => {
    const { entries, recorder } = auditRecorder();
    const fixture = app({
      audit: recorder,
      sessionOverrides: {
        dispatch: vi.fn(async () => { throw new McpBoundaryError("MCP_TOOL_TIMEOUT"); }),
      },
    });
    const response = await post(fixture.instance);

    // The client still sees the collapsed unavailable shape; the audit
    // entry keeps the precise code for triage.
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("MCP_AGENT_UNAVAILABLE");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      ownerId: OWNER,
      connectorId: "github-fixture",
      action: "mcp.tool.execute",
      outcome: "failed",
      errorCode: "MCP_TOOL_TIMEOUT",
      summary: `connection=${CONNECTION}`,
    });
    expect(entries[0]?.approved ?? false).toBe(false);
  });

  it("records a failed entry against the management plane when the session cannot open", async () => {
    const { entries, recorder } = auditRecorder();
    const fixture = app({
      audit: recorder,
      openFailure: new McpManagementError("MCP_CONNECTION_NOT_VERIFIED", 409),
    });
    const response = await post(fixture.instance);

    expect(response.status).toBe(409);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      ownerId: OWNER,
      connectorId: "mcp",
      action: "mcp.tool.execute",
      outcome: "failed",
      errorCode: "MCP_CONNECTION_NOT_VERIFIED",
      summary: `connection=${CONNECTION}`,
    });
  });

  it("records nothing for requests rejected before execution (authentication, kill switch)", async () => {
    const unauthenticated = auditRecorder();
    const fixtureA = app({ audit: unauthenticated.recorder, authenticated: false });
    const responseA = await post(fixtureA.instance);
    expect(responseA.status).toBe(401);
    expect(unauthenticated.entries).toHaveLength(0);

    const disabled = auditRecorder();
    const fixtureB = app({ audit: disabled.recorder, enabled: false });
    const responseB = await post(fixtureB.instance);
    expect(responseB.status).toBe(503);
    expect(disabled.entries).toHaveLength(0);
  });

  it("still completes the round when the audit recorder throws", async () => {
    const recorder: ConnectorAuditRecorder = {
      record: vi.fn(async () => { throw new Error("audit store unavailable"); }),
    };
    const fixture = app({ audit: recorder });
    const response = await post(fixture.instance);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(recorder.record).toHaveBeenCalledTimes(1);
  });
});
