// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient.js";
import {
  executeOriginMcpToolRound,
  McpAgentExecutionError,
  type McpAgentSession,
} from "./mcpAgentExecution.js";

function request(): OriginProviderExecutionRequest {
  return {
    plan: {
      providerId: "openrouter-free",
      providerLabel: "ORIGIN free",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      taskType: "general",
      freeOnly: true,
      estimatedCostUsd: 0,
      timeoutMs: 20_000,
      requiresOwnerApproval: false,
      reason: "test",
      providerDataPolicy: {
        allowProviderFallbacks: false,
        dataCollection: "deny",
        requireZeroDataRetention: true,
      },
      modelEvidence: {
        providerId: "openrouter-free",
        verifiedAt: "2026-09-20T00:00:00.000Z",
        reviewAfter: "2026-09-22T00:00:00.000Z",
        sourceUrl: "https://example.com/free",
      },
    } as OriginExecutionPlan,
    messages: [{ role: "user", content: "Check the repository status." }],
    systemInstruction: "Answer safely.",
  };
}

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

function session(overrides: Partial<McpAgentSession> = {}): McpAgentSession {
  return {
    connect: vi.fn(async () => undefined),
    catalog: vi.fn(() => [{
      alias: "mcp_1234567890abcdef1234567890abcdef1234567890abcdef",
      fingerprint: "a".repeat(64),
      tool: {
        name: "read_repository_file",
        description: "untrusted remote description",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
    }]),
    functions: vi.fn(() => [{
      type: "function" as const,
      function: {
        name: "mcp_1234567890abcdef1234567890abcdef1234567890abcdef",
        description: "untrusted remote description",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
    }]),
    dispatch: vi.fn(async () => JSON.stringify({ ok: true, value: "clean result" })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ORIGIN MCP agent execution boundary", () => {
  it("executes exactly one approved tool and finalizes without another tool round", async () => {
    const target = session();
    const executeProvider = vi.fn()
      .mockResolvedValueOnce(providerResult(JSON.stringify({
        alias: "mcp_1234567890abcdef1234567890abcdef1234567890abcdef",
        arguments: { path: "README.md" },
      })))
      .mockResolvedValueOnce(providerResult("Repository status checked."));

    const result = await executeOriginMcpToolRound({
      session: target,
      request: request(),
      executeProvider,
    });

    expect(result.text).toBe("Repository status checked.");
    expect(target.connect).toHaveBeenCalledTimes(1);
    expect(target.dispatch).toHaveBeenCalledTimes(1);
    expect(target.dispatch).toHaveBeenCalledWith({
      function: {
        name: "mcp_1234567890abcdef1234567890abcdef1234567890abcdef",
        arguments: JSON.stringify({ path: "README.md" }),
      },
    });
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(executeProvider).toHaveBeenCalledTimes(2);

    const first = executeProvider.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    const second = executeProvider.mock.calls[1]?.[0] as OriginProviderExecutionRequest;
    expect(first.requiredTool?.name).toBe("origin_mcp_select_tool");
    expect(JSON.stringify(first.requiredTool?.parameters)).toContain("mcp_1234567890abcdef");
    expect(first.systemInstruction).toContain("read_repository_file");
    expect(first.systemInstruction).not.toContain("untrusted remote description");
    expect(second.requiredTool).toBeUndefined();
    expect(second.systemInstruction).toContain("untrusted external data");
    expect(second.messages.at(-1)?.content).toContain("clean result");
  });

  it("rejects a model-selected alias outside the approved catalog before dispatch", async () => {
    const target = session();
    const executeProvider = vi.fn().mockResolvedValue(providerResult(JSON.stringify({
      alias: "mcp_unapproved",
      arguments: {},
    })));

    await expect(executeOriginMcpToolRound({
      session: target,
      request: request(),
      executeProvider,
    })).rejects.toMatchObject({ code: "MCP_AGENT_SELECTION_INVALID" });

    expect(target.dispatch).not.toHaveBeenCalled();
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(executeProvider).toHaveBeenCalledTimes(1);
  });

  it("does not retry when tool dispatch returns a failure envelope", async () => {
    const target = session({
      dispatch: vi.fn(async () => JSON.stringify({ isError: true, code: "MCP_TOOL_TIMEOUT" })),
    });
    const executeProvider = vi.fn()
      .mockResolvedValueOnce(providerResult(JSON.stringify({
        alias: "mcp_1234567890abcdef1234567890abcdef1234567890abcdef",
        arguments: { path: "README.md" },
      })))
      .mockResolvedValueOnce(providerResult("The tool outcome is uncertain and was not retried."));

    const result = await executeOriginMcpToolRound({
      session: target,
      request: request(),
      executeProvider,
    });

    expect(result.text).toContain("not retried");
    expect(target.dispatch).toHaveBeenCalledTimes(1);
    expect(executeProvider).toHaveBeenCalledTimes(2);
  });

  it("fails closed when there are no owner-approved MCP tools", async () => {
    const target = session({ catalog: vi.fn(() => []), functions: vi.fn(() => []) });
    const executeProvider = vi.fn();

    await expect(executeOriginMcpToolRound({
      session: target,
      request: request(),
      executeProvider,
    })).rejects.toEqual(new McpAgentExecutionError("MCP_AGENT_NO_APPROVED_TOOLS"));

    expect(executeProvider).not.toHaveBeenCalled();
    expect(target.dispatch).not.toHaveBeenCalled();
    expect(target.close).toHaveBeenCalledTimes(1);
  });

  it("rejects nested provider tool contracts so callers cannot bypass the boundary", async () => {
    const target = session();
    const base = request();
    base.requiredTool = {
      name: "unexpected",
      description: "unexpected",
      parameters: { type: "object" },
    };

    await expect(executeOriginMcpToolRound({
      session: target,
      request: base,
      executeProvider: vi.fn(),
    })).rejects.toMatchObject({ code: "MCP_AGENT_REQUEST_INVALID" });

    expect(target.connect).not.toHaveBeenCalled();
    expect(target.close).not.toHaveBeenCalled();
  });
});
