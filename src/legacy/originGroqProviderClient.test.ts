import { describe, expect, it, vi } from "vitest";
import {
  estimateOriginGroqInputTokens,
  executeOriginGroqProvider,
  isOriginGroqRouteConfigured,
  OriginGroqPreflightError,
  ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT,
} from "./originGroqProviderClient";
import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
} from "./originProviderClient";
import {
  buildOriginGroqRoutePlan,
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";
import { ORIGIN_GROQ_FREE_MODEL_ID } from "../lib/orchestration/OriginGroqFreeModelCatalog";

// Synthetic test fixture only; not a real credential (kept clearly fake on purpose).
const SYNTHETIC_KEY = "synthetic-groq-api-key-for-tests-only";
const NOW_MS = Date.parse("2026-11-08T12:00:00.000Z");
const AFTER_REVIEW_MS = Date.parse("2026-11-23T00:00:00.000Z");

const groqEnv = { GROQ_API_KEY: SYNTHETIC_KEY } as NodeJS.ProcessEnv;

const primaryPlan: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: ORIGIN_OPENROUTER_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "test",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-11-05T09:30:00.000Z", reviewAfter: "2026-11-15T09:30:00.000Z", sourceUrl: "https://openrouter.ai/google/gemma-4-31b-it:free" },
};

function groqPlan(): OriginExecutionPlan {
  const result = buildOriginGroqRoutePlan(primaryPlan, { nowMs: NOW_MS });
  if (!result.ok) throw new Error("groq route plan must build inside the evidence window");
  return result.plan;
}

const request: OriginProviderExecutionRequest = {
  plan: groqPlan(),
  messages: [{ role: "user", content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

function groqJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function successBody(content = "第3経路の回答です。"): Record<string, unknown> {
  return {
    model: ORIGIN_GROQ_FREE_MODEL_ID,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  };
}

describe("isOriginGroqRouteConfigured", () => {
  it("is false without a key and true with a plausible key", () => {
    expect(isOriginGroqRouteConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqRouteConfigured({ GROQ_API_KEY: "short" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqRouteConfigured(groqEnv)).toBe(true);
  });
});

describe("executeOriginGroqProvider", () => {
  it("is completely disabled without GROQ_API_KEY: preflight skip, no network", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, {} as NodeJS.ProcessEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("not-configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed before sending when the evidence is stale", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: AFTER_REVIEW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("evidence-stale");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips before sending when the estimated input would exceed the TPM ceiling", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const hugeRequest: OriginProviderExecutionRequest = {
      ...request,
      messages: [{ role: "user", content: "あ".repeat(20_000) }],
    };
    expect(estimateOriginGroqInputTokens(["あ".repeat(20_000)])).toBeGreaterThan(ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT);
    const error = await executeOriginGroqProvider(hugeRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("token-budget-exceeded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("executes once against the Groq OpenAI-compatible endpoint with the key only in the header", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    const result = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.transportRequestCount).toBe(1);
    expect(result.actualCostUsd).toBe(0);
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 40, totalTokens: 160, costUsd: 0 });
    expect(result.routingEvidence).toEqual({
      requestedModel: ORIGIN_GROQ_FREE_MODEL_ID,
      servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
      strategy: "verified-free-failover",
      provider: "Groq",
      attempt: 3,
      fallbackUsed: true,
    });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_KEY);

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
    const body = JSON.parse(String(init.body)) as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    // taskType "review" budgets 4,096 completion tokens; the small input leaves it uncapped.
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "確認してください" });
  });

  it("caps max_tokens so input plus completion stays under the TPM ceiling", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    const longRequest: OriginProviderExecutionRequest = {
      ...request,
      messages: [{ role: "user", content: "あ".repeat(12_000) }],
    };
    const result = await executeOriginGroqProvider(longRequest, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("第3経路の回答です。");
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse(String((calls[0] as [string, RequestInit])[1].body)) as { max_tokens: number };
    expect(body.max_tokens).toBeLessThan(4096);
    expect(body.max_tokens).toBeGreaterThanOrEqual(256);
  });

  it("maps HTTP 429 to PROVIDER_RATE_LIMITED with the transport count attached", async () => {
    const fetchMock = vi.fn(async () => groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429)) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(1);
  });

  it("fails closed when the served model identity differs from the fixed free model", async () => {
    const fetchMock = vi.fn(async () => groqJson({ ...successBody(), model: "openai/gpt-oss-20b" })) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_ROUTING_UNVERIFIED");
  });

  it("rejects a plan that relaxes the ZDR data policy before any network call", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const relaxedRequest: OriginProviderExecutionRequest = {
      ...request,
      plan: {
        ...groqPlan(),
        providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: false },
      },
    };
    const error = await executeOriginGroqProvider(relaxedRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_POLICY_VIOLATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps required-tool requests off this route", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const toolRequest: OriginProviderExecutionRequest = { ...request, requiredTool: { name: "lookup", description: "test", parameters: {} } };
    const error = await executeOriginGroqProvider(toolRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_POLICY_VIOLATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
