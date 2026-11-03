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
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: {
    providerId: "openrouter-free",
    verifiedAt: "2026-09-02T08:00:17.472Z",
    reviewAfter: "2026-09-12T08:00:17.471Z",
    sourceUrl: "https://openrouter.ai/google/gemma-4-31b-it:free",
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

  it("rejects the canonical non-free slug before any provider request", async () => {
    const fetchMock = vi.fn();
    const unsafeRequest = { ...request, plan: { ...plan, modelId: ORIGIN_OPENROUTER_FREE_MODEL.replace(/:free$/, "") } };
    await expect(executeOriginProvider(unsafeRequest, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a canonical served slug only when the request was :free and usage cost plus BYOK evidence are zero/false", async () => {
    const canonical = ORIGIN_OPENROUTER_FREE_MODEL.replace(/:free$/, "");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(openRouterPayload({ model: canonical, usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0, is_byok: false } })), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch);
    expect(result.routingEvidence.servedModel).toBe(canonical);
    expect(result.actualCostUsd).toBeNull();
    expect(result.costEvidenceStatus).toBe("NOT_MEASURED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a canonical served slug when reported usage cost is missing", async () => {
    const canonical = ORIGIN_OPENROUTER_FREE_MODEL.replace(/:free$/, "");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(openRouterPayload({ model: canonical, usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, is_byok: false } })), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
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
      .rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryable: false });
    // OpenRouter counts failed 429 attempts against its free daily allowance.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes untrusted served-model diagnostics before logging", async () => {
    const maliciousModel = `bad\n${"x".repeat(200)}`;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(openRouterPayload({ model: maliciousModel })), { status: 200, headers: { "Content-Type": "application/json" } }));
    const error = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch).then(() => undefined, (caught: unknown) => caught);
    const diagnostic = (error as OriginProviderError).diagnostic?.upstreamErrorType ?? "";
    expect(diagnostic).toHaveLength(64);
    expect(diagnostic).not.toMatch(/[\r\n\u0000-\u001f\u007f]/);
  });

  it("rejects a numeric actualCostUsd field even when it is zero because actual billing is unmeasured", () => {
    const result = {
      text: "x", actualCostUsd: 0, reportedUsageCostUsd: 0, policyMaxCostUsd: 0, costEvidenceStatus: "NOT_MEASURED",
      providerDataPolicy: request.plan.providerDataPolicy,
      routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
      billingEvidence: { reportedUsageCostUsd: 0, isByok: false }, usage: { reportedCostUsd: 0 }, transportRequestCount: 1,
    } as unknown as Parameters<typeof assertOriginZeroCostExecutionResult>[0];
    expect(() => assertOriginZeroCostExecutionResult(result)).toThrow("無料実行の費用を確認できません。");
  });

  it("rejects non-zero cost evidence even with valid routing evidence", () => {
    const result = {
      text: "x", actualCostUsd: null, reportedUsageCostUsd: 0, policyMaxCostUsd: 0, costEvidenceStatus: "NOT_MEASURED", billingEvidence: { reportedUsageCostUsd: 0, isByok: false }, providerDataPolicy: request.plan.providerDataPolicy,
      routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
      usage: { reportedCostUsd: 0.000001 },
    } as unknown as Parameters<typeof assertOriginZeroCostExecutionResult>[0];
    expect(() => assertOriginZeroCostExecutionResult(result)).toThrow("0ドル固定ポリシーに適合しない実行計画です。");
  });
});
