import { describe, expect, it, vi } from "vitest";
import { assertOriginZeroCostExecutionResult, executeOriginProvider, OriginProviderError, type OriginFetch } from "./originProviderClient";
import { buildOriginExecutionPlan, ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL, ORIGIN_OPENROUTER_FREE_MODEL } from "../lib/orchestration/OriginExecutionPolicy";

const planResult = buildOriginExecutionPlan(
  { goal: "最新の安全な実装方針を確認してください", requiresFreshResearch: true },
  { openRouterConfigured: true, googleAiStudioConfigured: true, groqConfigured: true },
);
if (!planResult.ok) throw new Error("security regression fixture could not build an execution plan");

const request = {
  plan: planResult.plan,
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
  it("fails closed on upstream 402 and never falls through", async () => {
    const fetchMock = vi.fn(async () => new Response("payment required: secret", { status: 402 }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key", GEMINI_API_KEY: "synthetic-gemini-key" }, fetchMock as unknown as OriginFetch))
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

  it("falls back from 429 to Gemini's approved free model", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "gemini safe response" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key", GEMINI_API_KEY: "synthetic-gemini-key" }, fetchMock as unknown as OriginFetch);
    expect(result.text).toBe("gemini safe response");
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL);
    expect(result.routingEvidence.fallbackUsed).toBe(true);
    expect(result.actualCostUsd).toBe(0);
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
