// @vitest-environment node
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ORIGIN_OPENROUTER_FREE_MODEL } from "../lib/orchestration/OriginExecutionPolicy.js";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog.js";
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from "../legacy/originProviderClient.js";
import type { McpAgentSession } from "./mcpAgentExecution.js";
import { createMcpAgentRouter } from "./mcpAgentRouter.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";
const ALIAS = "mcp_1234567890abcdef1234567890abcdef1234567890abcdef";
const TEST_NOW = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].verifiedAt) + 1;

function providerResult(text: string): OriginProviderExecutionResult {
  return {
    text,
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

function session(): McpAgentSession {
  return {
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
  };
}

function app(options: {
  authenticated?: boolean;
  executeProvider?: (request: OriginProviderExecutionRequest) => Promise<OriginProviderExecutionResult>;
} = {}) {
  const target = session();
  const open = vi.fn(async (_input: { ownerId: string; connectionId: string; version: number }) => target);
  const executeProvider = options.executeProvider ?? vi.fn()
    .mockResolvedValueOnce(providerResult(JSON.stringify({ alias: ALIAS, arguments: { path: "README.md" } })))
    .mockResolvedValueOnce(providerResult("README.md was read successfully."));
  const instance = express();
  instance.use(express.json({ limit: "64kb" }));
  instance.use(createMcpAgentRouter({
    authenticate: async () => options.authenticated === false ? null : { subjectId: OWNER, sessionBinding: "session" },
    sessionFactory: { open },
    env: {
      APP_URL: "https://origin.example.com",
      OPENROUTER_API_KEY: "fixture",
    },
    executeProvider,
    now: () => TEST_NOW,
  }));
  return { instance, target, open, executeProvider };
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

  it("blocks detected credentials before connector or model egress", async () => {
    const fixture = app();
    const response = await request(fixture.instance)
      .post("/api/mcp/chat")
      .set("Origin", "https://origin.example.com")
      .send({
        connectionId: CONNECTION,
        version: 3,
        messages: [{ role: "user", content: "Use token ghp_abcdefghijklmnopqrstuvwxyz1234567890 to inspect the repo." }],
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED");
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.executeProvider).not.toHaveBeenCalled();
  });
});
