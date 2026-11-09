import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertOriginZeroCostExecutionResultWithFailover,
  executeOriginProviderStreamWithFailover,
  executeOriginProviderWithFailover,
  resetOriginProviderFailoverCircuitForTests,
} from "./originProviderFailover";

// The circuit breaker is process-level state; every test starts from a closed
// breaker so cases stay independent of execution order.
beforeEach(() => {
  resetOriginProviderFailoverCircuitForTests();
});
import {
  OriginProviderError,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient";
import { OriginCloudflarePreflightError } from "./originCloudflareProviderClient";
import { OriginGroqPreflightError } from "./originGroqProviderClient";
import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";
import { ORIGIN_CLOUDFLARE_FREE_MODEL } from "../lib/orchestration/OriginCloudflareFreeModelCatalog";
import {
  ORIGIN_GROQ_FREE_MODEL_ID,
  ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
} from "../lib/orchestration/OriginGroqFreeModelCatalog";

// Synthetic test fixture only; not a real credential (kept clearly fake on purpose).
const SYNTHETIC_KEY = "synthetic-groq-api-key-for-tests-only";
const NOW_MS = Date.parse("2026-11-10T12:00:00.000Z");

const cfEnabledEnv = { ORIGIN_CF_FAILOVER_ENABLED: "true" } as NodeJS.ProcessEnv;
const groqOnlyEnv = { GROQ_API_KEY: SYNTHETIC_KEY } as NodeJS.ProcessEnv;
const bothEnv = { ORIGIN_CF_FAILOVER_ENABLED: "true", GROQ_API_KEY: SYNTHETIC_KEY } as NodeJS.ProcessEnv;

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
const request: OriginProviderExecutionRequest = {
  plan: primaryPlan,
  messages: [{ role: "user", content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

function cloudflareSuccessResult(): OriginProviderExecutionResult {
  return {
    text: "第2経路の回答です。",
    transportRequestCount: 4,
    actualCostUsd: 0,
    providerDataPolicy: primaryPlan.providerDataPolicy,
    routingEvidence: {
      requestedModel: ORIGIN_CLOUDFLARE_FREE_MODEL,
      servedModel: ORIGIN_CLOUDFLARE_FREE_MODEL,
      strategy: "verified-free-failover",
      provider: "Cloudflare",
      attempt: 2,
      fallbackUsed: true,
      neurons: 36,
    },
    usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, costUsd: 0 },
  };
}

function groqSuccessResult(): OriginProviderExecutionResult {
  return {
    text: "第3経路の回答です。",
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: primaryPlan.providerDataPolicy,
    routingEvidence: {
      requestedModel: ORIGIN_GROQ_FREE_MODEL_ID,
      servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
      strategy: "verified-free-failover",
      provider: "Groq",
      attempt: 3,
      fallbackUsed: true,
    },
    usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160, costUsd: 0 },
  };
}

function rateLimitedError(transportRequestCount = 1): OriginProviderError {
  return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, { transportRequestCount });
}

const primaryRateLimited = () => vi.fn(async () => { throw rateLimitedError(1); });
const cloudflareSkipped = (reason: "not-enabled" | "not-configured" = "not-configured") =>
  vi.fn(async () => { throw new OriginCloudflarePreflightError(reason); });
const cloudflareRateLimited = () => vi.fn(async () => { throw rateLimitedError(4); });
const groqOk = () => vi.fn(async () => groqSuccessResult());

describe("Groq third route in the failover dispatcher", () => {
  it("stays a transparent pass-through when neither the CF flag nor GROQ_API_KEY is set, even with a Groq executor injected", async () => {
    const primaryError = rateLimitedError(1);
    const primaryExecute = vi.fn(async () => { throw primaryError; });
    const cloudflareExecute = cloudflareSkipped();
    const groqExecute = groqOk();
    const error = await executeOriginProviderWithFailover(request, {} as NodeJS.ProcessEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught);
    expect(error).toBe(primaryError);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("never attempts Groq when the key is absent: the two-route result is unchanged", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(request, cfEnabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.attempts).toHaveLength(2);
    expect(groqExecute).not.toHaveBeenCalled();
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("reaches Groq after the Cloudflare route is skipped before execution, and records all three attempts", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareSkipped();
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.attempts).toEqual([
      { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", transportRequestCount: 1 },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_FREE_MODEL, outcome: "skipped", skipReason: "not-configured", transportRequestCount: 0 },
      { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "succeeded", transportRequestCount: 1 },
    ]);
    expect(result.transportRequestCount).toBe(2);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("reaches Groq when the Cloudflare route executed and failed with an availability error", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareRateLimited();
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.attempts?.[1]).toEqual({
      providerId: "cloudflare-workers-ai-free",
      modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
      outcome: "availability-error",
      errorCode: "PROVIDER_RATE_LIMITED",
      transportRequestCount: 4,
    });
    expect(result.transportRequestCount).toBe(1 + 4 + 1);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("forwards the route-3 compact instruction to the Groq executor only", async () => {
    const compactInstruction = "経路3専用の短縮指示です。";
    const activatedRequest: OriginProviderExecutionRequest = { ...request, groqSystemInstruction: compactInstruction };
    let primarySeen: OriginProviderExecutionRequest | undefined;
    let cloudflareSeen: OriginProviderExecutionRequest | undefined;
    let groqSeen: OriginProviderExecutionRequest | undefined;
    const primaryExecute = vi.fn(async (seen: OriginProviderExecutionRequest) => {
      primarySeen = seen;
      throw rateLimitedError(1);
    });
    const cloudflareExecute = vi.fn(async (seen: OriginProviderExecutionRequest) => {
      cloudflareSeen = seen;
      throw new OriginCloudflarePreflightError("not-configured");
    });
    const groqExecute = vi.fn(async (seen: OriginProviderExecutionRequest) => {
      groqSeen = seen;
      return groqSuccessResult();
    });
    const result = await executeOriginProviderWithFailover(activatedRequest, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第3経路の回答です。");
    // The Groq executor receives both the original instruction (untouched) and the
    // route-3 substitute. The primary executor shares the request object but never
    // reads the substitute (its payload is built from systemInstruction alone), and
    // the Cloudflare route's constructed request does not carry the field at all.
    expect(groqSeen?.groqSystemInstruction).toBe(compactInstruction);
    expect(groqSeen?.systemInstruction).toBe(request.systemInstruction);
    expect(primarySeen?.groqSystemInstruction).toBe(compactInstruction);
    expect(primarySeen?.systemInstruction).toBe(request.systemInstruction);
    expect(cloudflareSeen?.groqSystemInstruction).toBeUndefined();
    expect(cloudflareSeen?.systemInstruction).toBe(request.systemInstruction);
  });

  it("engages the dispatch on the Groq key alone when the Cloudflare flag is off", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareSkipped("not-enabled");
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(request, groqOnlyEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts?.[1].skipReason).toBe("not-enabled");
  });

  it("never switches to Groq after an integrity failure on the Cloudflare route", async () => {
    const integrityError = new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行計画です。", 400, false, undefined, { transportRequestCount: 4 });
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => { throw integrityError; });
    const groqExecute = groqOk();
    const error = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught);
    expect(groqExecute).not.toHaveBeenCalled();
    expect((error as OriginProviderError).code).toBe("PROVIDER_POLICY_VIOLATION");
    expect((error as OriginProviderError).diagnostic?.failoverAttempts).toHaveLength(2);
  });

  it("surfaces the primary error when Groq is skipped before execution (stale evidence)", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareSkipped();
    const groqExecute = vi.fn(async () => { throw new OriginGroqPreflightError("evidence-stale"); });
    const error = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    const attempts = (error as OriginProviderError).diagnostic?.failoverAttempts;
    expect(attempts).toHaveLength(3);
    expect(attempts?.[2]).toEqual({
      providerId: "groq-free",
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      outcome: "skipped",
      skipReason: "evidence-stale",
      transportRequestCount: 0,
    });
  });

  it("surfaces the Groq error when the third route executed and failed", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareRateLimited();
    const groqExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const error = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    // The surfaced error is Groq's own (its diagnostic carries its single transport
    // request), not the Cloudflare error (which carried four).
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(1);
    const attempts = (error as OriginProviderError).diagnostic?.failoverAttempts;
    expect(attempts).toHaveLength(3);
    expect(attempts?.[2].outcome).toBe("availability-error");
  });

  it("records each route's upstream status and raw error code on its failed attempt evidence", async () => {
    const primaryExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, { transportRequestCount: 1, upstreamStatus: 429, upstreamErrorType: "rate_limit_exceeded" });
    });
    const cloudflareExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, { transportRequestCount: 4, upstreamStatus: 429, upstreamErrorCode: "10023" });
    });
    const groqExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, { transportRequestCount: 1, upstreamStatus: 429, upstreamErrorCode: "rate_limit_exceeded" });
    });
    const error = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.diagnostic?.failoverAttempts).toEqual([
      { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", upstreamStatus: 429, upstreamErrorType: "rate_limit_exceeded", transportRequestCount: 1 },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_FREE_MODEL, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", upstreamStatus: 429, upstreamErrorCode: "10023", transportRequestCount: 4 },
      { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", upstreamStatus: 429, upstreamErrorCode: "rate_limit_exceeded", transportRequestCount: 1 },
    ]);
  });

  it("chains through a circuit-open primary skip to Groq on the next request", async () => {
    const first = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS,
      primaryExecute: primaryRateLimited(),
      cloudflareExecute: cloudflareSkipped(),
      groqExecute: groqOk(),
    });
    expect(first.text).toBe("第3経路の回答です。");

    const primaryExecute = vi.fn(async () => { throw new Error("primary must not be attempted while the circuit is open"); });
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS,
      primaryExecute,
      cloudflareExecute: cloudflareSkipped(),
      groqExecute: groqOk(),
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.attempts?.[0]).toEqual({
      providerId: "openrouter-free",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      outcome: "skipped",
      skipReason: "primary-circuit-open",
      errorCode: "PROVIDER_RATE_LIMITED",
      transportRequestCount: 0,
    });
    expect(result.attempts).toHaveLength(3);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("names the rotation model on the Groq attempt when the route served via gpt-oss-20b", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareSkipped();
    // The executor rotated inside the route: two Groq sends, served by 20b.
    const groqExecute = vi.fn(async () => ({
      ...groqSuccessResult(),
      transportRequestCount: 2,
      routingEvidence: {
        requestedModel: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
        servedModel: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
        strategy: "verified-free-failover" as const,
        provider: "Groq" as const,
        attempt: 3 as const,
        fallbackUsed: true as const,
      },
    }));
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.attempts?.[2]).toEqual({
      providerId: "groq-free",
      modelId: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
      outcome: "succeeded",
      transportRequestCount: 2,
    });
    expect(result.transportRequestCount).toBe(1 + 0 + 2);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("delivers the Groq answer through the streaming variant when the primary stream fails before any byte", async () => {
    const deltas: string[] = [];
    const streamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const result = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: (text: string) => { deltas.push(text); } },
      bothEnv,
      fetch,
      {
        nowMs: NOW_MS,
        streamExecute,
        cloudflareExecute: cloudflareSkipped(),
        groqExecute: groqOk(),
      },
    );
    expect(result.text).toBe("第3経路の回答です。");
    expect(deltas).toEqual(["第3経路の回答です。"]);
    expect(result.attempts).toHaveLength(3);
  });
});

describe("assertOriginZeroCostExecutionResultWithFailover with three attempts", () => {
  function groqServedResult(attempts: OriginProviderExecutionResult["attempts"], transportRequestCount: number): OriginProviderExecutionResult {
    return { ...groqSuccessResult(), transportRequestCount, attempts };
  }
  const primaryFailed = { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const, transportRequestCount: 1 };
  const cfSkipped = { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_FREE_MODEL, outcome: "skipped" as const, skipReason: "not-configured", transportRequestCount: 0 };
  const groqServed = { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "succeeded" as const, transportRequestCount: 1 };

  it("accepts the honest three-attempt shape", () => {
    const result = groqServedResult([primaryFailed, cfSkipped, groqServed], 2);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("rejects a three-attempt result whose middle route also claims success", () => {
    const cfServed = { ...cfSkipped, outcome: "succeeded" as const, skipReason: undefined, transportRequestCount: 4 };
    const result = groqServedResult([primaryFailed, cfServed, groqServed], 6);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });

  it("rejects a three-attempt result served by an unapproved Groq model", () => {
    const wrongModel = { ...groqServed, modelId: "llama-3.3-70b-versatile" };
    const result = groqServedResult([primaryFailed, cfSkipped, wrongModel], 2);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });

  it("accepts a three-attempt result served by the rotation model gpt-oss-20b", () => {
    const rotationServed = { ...groqServed, modelId: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, transportRequestCount: 2 };
    const result: OriginProviderExecutionResult = {
      ...groqSuccessResult(),
      transportRequestCount: 3,
      routingEvidence: {
        requestedModel: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
        servedModel: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
        strategy: "verified-free-failover",
        provider: "Groq",
        attempt: 3,
        fallbackUsed: true,
      },
      attempts: [primaryFailed, cfSkipped, rotationServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("rejects a rotation attempt whose routing evidence names the other Groq model", () => {
    const rotationAttempt = { ...groqServed, modelId: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, transportRequestCount: 2 };
    // Attempt evidence claims 20b served, but the result's routing evidence
    // still names the primary model: the pair does not agree, so unverified.
    const result = groqServedResult([primaryFailed, cfSkipped, rotationAttempt], 3);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });

  it("rejects four-attempt results outright", () => {
    const result = groqServedResult([primaryFailed, cfSkipped, groqServed, groqServed], 3);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });
});
