import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertOriginZeroCostExecutionResult, executeOriginProvider, OriginProviderError, resetOriginProviderCooldownForTests, type OriginFetch } from "./originProviderClient";
import { ORIGIN_OPENROUTER_FREE_MODEL, type OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";

const plan: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: ORIGIN_OPENROUTER_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "security regression fixture",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: false },
  modelEvidence: {
    providerId: "openrouter-free",
    verifiedAt: "2026-09-02T08:00:17.472Z",
    reviewAfter: "2026-09-12T08:00:17.471Z",
    sourceUrl: "https://openrouter.ai/google/gemma-4-26b-a4b-it:free",
  },
};

const request = {
  plan,
  messages: [{ role: "user" as const, content: "安全な実装方針を説明してください" }],
  systemInstruction: "安全に回答してください。",
};

const openRouterPayload = (overrides: Record<string, unknown> = {}) => ({
  id: "test",
  model: ORIGIN_OPENROUTER_FREE_MODEL,
  choices: [{ message: { content: "safe response" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0 },
  ...overrides,
});

describe("originProviderClient security regressions", () => {
  beforeEach(() => resetOriginProviderCooldownForTests());

  it("fails closed on upstream 402 and never falls through", async () => {
    const fetchMock = vi.fn(async () => new Response("payment required: secret", { status: 402 }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful response served by a non-approved model", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(openRouterPayload({ model: "paid-model" })), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
  });

  it("preserves Retry-After without exposing upstream content or credentials", async () => {
    const body = "Authorization: Bearer upstream-secret-value";
    const error = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key" }, vi.fn(async () => new Response(body, { status: 429, headers: { "Retry-After": "60" } })) as unknown as OriginFetch)
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(String(error)).not.toContain(body);
    expect(String(error)).not.toContain("synthetic-key");
    expect(error).toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryAfterSeconds: 60 });
  });

  it("does not fall back to Gemini or another provider after a rate limit", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key", GEMINI_API_KEY: "synthetic-gemini-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-zero cost evidence even with valid routing evidence", () => {
    const result = {
      text: "x", actualCostUsd: 0, providerDataPolicy: request.plan.providerDataPolicy,
      routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
      usage: { costUsd: 0.000001 },
    } as unknown as Parameters<typeof assertOriginZeroCostExecutionResult>[0];
    expect(() => assertOriginZeroCostExecutionResult(result)).toThrow("usage.costUsd が$0ポリシーを満たしません。");
  });
});
