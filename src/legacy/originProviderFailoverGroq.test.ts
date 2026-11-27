import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertOriginZeroCostExecutionResultWithFailover,
  executeOriginProviderStreamWithFailover,
  executeOriginProviderWithFailover,
  executeOriginSynthesisWithFailover,
  isOriginGroqFirstEnabled,
  ORIGIN_CHAT_TOTAL_BUDGET_MS,
  ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS,
  ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS,
  ORIGIN_CLOUDFLARE_CIRCUIT_FAILURE_THRESHOLD,
  ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON,
  ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS,
  ORIGIN_GROQ_ATTEMPT_BUDGET_MS,
  ORIGIN_GROQ_FIRST_ENV,
  ORIGIN_GROQ_ROUTE_RESERVE_MS,
  ORIGIN_SYNTHESIS_CLOUDFLARE_ATTEMPT_BUDGET_MS,
  resetOriginProviderFailoverCircuitForTests,
} from "./originProviderFailover";

// The circuit breaker is process-level state; every test starts from a closed
// breaker so cases stay independent of execution order.
beforeEach(() => {
  resetOriginProviderFailoverCircuitForTests();
});
import {
  buildOriginProviderFailureDiagnostic,
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
const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");

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
    expect(primaryExecute).not.toHaveBeenCalled();
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
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.attempts).toEqual([
      { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "skipped", skipReason: "route-stopped", transportRequestCount: 0 },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_FREE_MODEL, outcome: "skipped", skipReason: "not-configured", transportRequestCount: 0 },
      { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "succeeded", rateLimitHit: false, transportRequestCount: 1, durationMs: expect.any(Number) },
    ]);
    expect(result.transportRequestCount).toBe(1);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("reaches Groq when the Cloudflare route executed and failed with an availability error", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareRateLimited();
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.attempts?.[1]).toEqual({
      providerId: "cloudflare-workers-ai-free",
      modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
      outcome: "availability-error",
      errorCode: "PROVIDER_RATE_LIMITED",
      rateLimitHit: true,
      transportRequestCount: 4,
      durationMs: expect.any(Number),
    });
    expect(result.transportRequestCount).toBe(0 + 4 + 1);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("forwards the route-3 compact instruction to the Groq executor only", async () => {
    const compactInstruction = "経路3専用の短縮指示です。";
    const activatedRequest: OriginProviderExecutionRequest = { ...request, groqSystemInstruction: compactInstruction };
    let cloudflareSeen: OriginProviderExecutionRequest | undefined;
    let groqSeen: OriginProviderExecutionRequest | undefined;
    const primaryExecute = vi.fn(async () => {
      throw new Error("primary must not be attempted under the stopped disposition");
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
    // route-3 substitute. The primary executor is never invoked at all under the
    // stopped disposition (PKG-4 PR-2), and the Cloudflare route's constructed
    // request does not carry the field.
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(groqSeen?.groqSystemInstruction).toBe(compactInstruction);
    expect(groqSeen?.systemInstruction).toBe(request.systemInstruction);
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

  it("surfaces the route-stopped unavailability when Groq is skipped before execution (stale evidence)", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = cloudflareSkipped();
    const groqExecute = vi.fn(async () => { throw new OriginGroqPreflightError("evidence-stale"); });
    const error = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught);
    expect(primaryExecute).not.toHaveBeenCalled();
    // Every route was skipped before execution, so the honest surfaced error
    // is the synthesized route-stopped unavailability (PKG-4 PR-2).
    expect((error as OriginProviderError).code).toBe("PROVIDER_UNAVAILABLE");
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

  it("records each executed route's upstream status and raw error code on its failed attempt evidence", async () => {
    const primaryExecute = vi.fn(async () => {
      throw new Error("primary must not be attempted under the stopped disposition");
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
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.diagnostic?.failoverAttempts).toEqual([
      { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "skipped", skipReason: "route-stopped", transportRequestCount: 0 },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_FREE_MODEL, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", rateLimitHit: true, upstreamStatus: 429, upstreamErrorCode: "10023", transportRequestCount: 4, durationMs: expect.any(Number) },
      { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", rateLimitHit: true, upstreamStatus: 429, upstreamErrorCode: "rate_limit_exceeded", transportRequestCount: 1, durationMs: expect.any(Number) },
    ]);
  });

  it("records the route-stopped skip and chains to Groq on every request (PKG-4 PR-2)", async () => {
    const primaryExecute = vi.fn(async () => { throw new Error("primary must not be attempted under the stopped disposition"); });
    const first = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS,
      primaryExecute,
      cloudflareExecute: cloudflareSkipped(),
      groqExecute: groqOk(),
    });
    expect(first.text).toBe("第3経路の回答です。");

    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS + 1_000,
      primaryExecute,
      cloudflareExecute: cloudflareSkipped(),
      groqExecute: groqOk(),
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.attempts?.[0]).toEqual({
      providerId: "openrouter-free",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      outcome: "skipped",
      skipReason: "route-stopped",
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
      rateLimitHit: false,
      transportRequestCount: 2,
      durationMs: expect.any(Number),
    });
    expect(result.transportRequestCount).toBe(0 + 0 + 2);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("delivers the Groq answer through the streaming variant without starting the stopped primary stream", async () => {
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
    expect(streamExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第3経路の回答です。");
    expect(deltas).toEqual(["第3経路の回答です。"]);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "route-stopped" });
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

  it("accepts the route-stopped three-attempt shape (PKG-4 PR-2)", () => {
    const routeStopped = { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "skipped" as const, skipReason: "route-stopped", transportRequestCount: 0 };
    const result = groqServedResult([routeStopped, cfSkipped, groqServed], 1);
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

describe("third-route reserve and attempt durations (PKG-4 PR-1)", () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("sets the default reserve for the third route to 10 seconds", () => {
    expect(ORIGIN_GROQ_ROUTE_RESERVE_MS).toBe(10_000);
  });

  it("cuts a slow second route at its slice so the third route starts with the reserve left and actually runs", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const groqExecute = groqOk();
    const startedAt = Date.now();
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute, totalBudgetMs: 2_500, groqReserveMs: 1_000,
    });
    const elapsedMs = Date.now() - startedAt;
    expect(result.text).toBe("第3経路の回答です。");
    expect(groqExecute).toHaveBeenCalledTimes(1);
    // The second route's slice is total (2,500) minus reserve (1,000) = 1,500ms:
    // the dispatch ends at the slice plus the third route's own time, well
    // before the full total budget the second route used to consume alone.
    expect(elapsedMs).toBeGreaterThanOrEqual(1_250);
    expect(elapsedMs).toBeLessThan(2_500);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts?.[1]).toMatchObject({
      providerId: "cloudflare-workers-ai-free",
      outcome: "availability-error",
      errorCode: "PROVIDER_TIMEOUT",
    });
    const cloudflareDurationMs = result.attempts?.[1]?.durationMs;
    expect(cloudflareDurationMs).toBeGreaterThanOrEqual(1_250);
    expect(cloudflareDurationMs).toBeLessThan(2_500);
    expect(result.attempts?.[2]).toMatchObject({ providerId: "groq-free", outcome: "succeeded" });
    // The first attempt is the route-stopped skip (PKG-4 PR-2): nothing was
    // executed, so it carries no duration.
    expect(result.attempts?.[0]?.durationMs).toBeUndefined();
    expect(typeof result.attempts?.[2]?.durationMs).toBe("number");
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("leaves the second route untouched when it finishes inside its slice: the third route is never attempted", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => { await delay(100); return cloudflareSuccessResult(); });
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute, totalBudgetMs: 2_500, groqReserveMs: 1_000,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(groqExecute).not.toHaveBeenCalled();
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[1]?.durationMs).toBeGreaterThanOrEqual(75);
  });
});

describe("synthesis attempt budget (round-6 measure 6-1c)", () => {
  // ANSWER_STATISTICS_ROUND6_DIAGNOSIS_2026-11-27 §1/§5: every
  // round-6 synthesis provider failure was the main route hitting
  // the general 25s attempt budget (measured 25,002–25,003ms) while
  // the Groq pool was exhausted. The synthesis dispatch entry gives
  // the synthesis stage 32s; every other dispatch keeps 25s.
  it("pins the synthesis budget inside every enclosing bound", () => {
    expect(ORIGIN_SYNTHESIS_CLOUDFLARE_ATTEMPT_BUDGET_MS).toBe(32_000);
    expect(ORIGIN_SYNTHESIS_CLOUDFLARE_ATTEMPT_BUDGET_MS).toBeGreaterThan(ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS);
    // The slice formula caps at remaining − Groq reserve, so the
    // synthesis budget must fit under total − reserve with the
    // reserve itself untouched.
    expect(ORIGIN_SYNTHESIS_CLOUDFLARE_ATTEMPT_BUDGET_MS)
      .toBeLessThanOrEqual(ORIGIN_CHAT_TOTAL_BUDGET_MS - ORIGIN_GROQ_ROUTE_RESERVE_MS);
    // Below the route/client caps; the 120s function limit sits far
    // above all of these (vercel.json maxDuration).
    expect(ORIGIN_SYNTHESIS_CLOUDFLARE_ATTEMPT_BUDGET_MS).toBeLessThan(ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS);
  });

  it("dispatches through the general failover with caller options honored after the synthesis default", async () => {
    const cloudflareExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const groqExecute = groqOk();
    const startedAt = Date.now();
    const result = await executeOriginSynthesisWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, cloudflareExecute, groqExecute,
      totalBudgetMs: 4_000, groqReserveMs: 500, cloudflareAttemptBudgetMs: 300,
    });
    const elapsedMs = Date.now() - startedAt;
    // The hanging second route is cut at the caller's 300ms budget
    // and the third route answers — the synthesis entry is the
    // general dispatch with its options plumbed through.
    expect(result.text).toBe("第3経路の回答です。");
    expect(groqExecute).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(250);
    expect(elapsedMs).toBeLessThan(2_000);
    expect(result.attempts?.[1]).toMatchObject({ outcome: "availability-error", errorCode: "PROVIDER_TIMEOUT" });
  });

  it("serves a healthy second route exactly like the general entry", async () => {
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const groqExecute = groqOk();
    const result = await executeOriginSynthesisWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(groqExecute).not.toHaveBeenCalled();
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });
});

describe("second-route circuit breaker and attempt cap (speed wave 1, 2026-11-16)", () => {
  const timeoutError = (transportRequestCount = 4): OriginProviderError =>
    new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, {
      transportFailure: "timeout",
      transportRequestCount,
    });
  const cloudflareTimeout = () => vi.fn(async () => { throw timeoutError(); });
  // Every request enters the second-route phase through the route-stopped
  // primary skip (PKG-4 PR-2), so the second-route breaker is exercised
  // through that entry throughout this describe.

  it("pins the attempt budget, failure threshold, and cooldown defaults", () => {
    expect(ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS).toBe(25_000);
    expect(ORIGIN_CLOUDFLARE_CIRCUIT_FAILURE_THRESHOLD).toBe(2);
    expect(ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS).toBe(180_000);
  });

  it("caps a hanging second route at its attempt budget instead of the remaining-minus-reserve slice", async () => {
    const cloudflareExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const groqExecute = groqOk();
    const startedAt = Date.now();
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, cloudflareExecute, groqExecute,
      totalBudgetMs: 4_000, groqReserveMs: 500, cloudflareAttemptBudgetMs: 300,
    });
    const elapsedMs = Date.now() - startedAt;
    expect(result.text).toBe("第3経路の回答です。");
    expect(groqExecute).toHaveBeenCalledTimes(1);
    // Without the cap the slice would be 4,000 - 500 = 3,500ms; the attempt
    // budget cuts the wait at ~300ms and the third route answers.
    expect(elapsedMs).toBeGreaterThanOrEqual(250);
    expect(elapsedMs).toBeLessThan(2_000);
    expect(result.attempts?.[1]).toMatchObject({ outcome: "availability-error", errorCode: "PROVIDER_TIMEOUT" });
    expect(result.attempts?.[1]?.durationMs).toBeLessThan(1_000);
  });

  it("opens after two consecutive second-route timeouts and skips the route while open", async () => {
    const cloudflareExecute = cloudflareTimeout();
    const groqExecute = groqOk();
    const options = { cloudflareExecute, groqExecute };
    const first = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    expect(first.text).toBe("第3経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(1);
    const second = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    expect(second.text).toBe("第3経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);
    const third = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 2_000 });
    expect(third.text).toBe("第3経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);
    expect(third.attempts).toHaveLength(3);
    expect(third.attempts?.[1]).toEqual({
      providerId: "cloudflare-workers-ai-free",
      modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
      outcome: "skipped",
      skipReason: ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON,
      errorCode: "PROVIDER_TIMEOUT",
      transportRequestCount: 0,
    });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(third, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("also skips the second route when the request arrives through the route-stopped entry (PKG-4 PR-2)", async () => {
    const primaryExecute = vi.fn(async () => { throw new Error("primary must not be attempted under the stopped disposition"); });
    const cloudflareExecute = cloudflareTimeout();
    const groqExecute = groqOk();
    // The route-stopped entry is the only entry now: the second-route
    // breaker must engage — and later skip — from it as well.
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { nowMs: NOW_MS + 1_000, primaryExecute, cloudflareExecute, groqExecute });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);
    const third = await executeOriginProviderWithFailover(request, bothEnv, fetch, { nowMs: NOW_MS + 2_000, primaryExecute, cloudflareExecute, groqExecute });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);
    expect(third.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "route-stopped" });
    expect(third.attempts?.[1]).toMatchObject({
      outcome: "skipped",
      skipReason: ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON,
      errorCode: "PROVIDER_TIMEOUT",
      transportRequestCount: 0,
    });
    expect(third.text).toBe("第3経路の回答です。");
    expect(() => assertOriginZeroCostExecutionResultWithFailover(third, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("resets the consecutive count on a second-route success", async () => {
    let cfBehavior: "timeout" | "ok" = "timeout";
    const cloudflareExecute = vi.fn(async () => {
      if (cfBehavior === "timeout") throw timeoutError();
      return cloudflareSuccessResult();
    });
    const groqExecute = groqOk();
    const options = { cloudflareExecute, groqExecute };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    cfBehavior = "ok";
    const recovered = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    expect(recovered.text).toBe("第2経路の回答です。");
    cfBehavior = "timeout";
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 2_000 });
    // Only one counted failure since the success: the route is still attempted.
    const fourth = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 3_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(4);
    expect(fourth.text).toBe("第3経路の回答です。");
  });

  it("half-opens after the cooldown: a trial success closes the breaker and restarts the count", async () => {
    let cfBehavior: "timeout" | "ok" = "timeout";
    const cloudflareExecute = vi.fn(async () => {
      if (cfBehavior === "timeout") throw timeoutError();
      return cloudflareSuccessResult();
    });
    const groqExecute = groqOk();
    const options = { cloudflareExecute, groqExecute };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);
    // The breaker opened at NOW+1_000 for the 180s cooldown; the next request
    // after that trials the route once.
    cfBehavior = "ok";
    const trialed = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      ...options, nowMs: NOW_MS + 1_000 + ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS + 1,
    });
    expect(trialed.text).toBe("第2経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
    // Closed again with a fresh count: one new timeout does not re-open it.
    cfBehavior = "timeout";
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 182_000 });
    const after = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 183_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(5);
    expect(after.text).toBe("第3経路の回答です。");
  });

  it("re-opens at once when the half-open trial fails with a counted failure", async () => {
    const cloudflareExecute = cloudflareTimeout();
    const groqExecute = groqOk();
    const options = { cloudflareExecute, groqExecute };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    const trialed = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      ...options, nowMs: NOW_MS + 1_000 + ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS + 1,
    });
    expect(trialed.text).toBe("第3経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
    const skipped = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 182_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
    expect(skipped.attempts?.[1]).toMatchObject({ outcome: "skipped", skipReason: ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON });
  });

  it("does not count configuration failures toward the breaker", async () => {
    const notConfigured = new OriginProviderError("PROVIDER_NOT_CONFIGURED", "Provider認証情報を確認できません。", 401, false, undefined, { transportRequestCount: 4 });
    let cfBehavior: "not-configured" | "timeout" = "not-configured";
    const cloudflareExecute = vi.fn(async () => {
      if (cfBehavior === "not-configured") throw notConfigured;
      throw timeoutError();
    });
    const groqExecute = groqOk();
    const options = { cloudflareExecute, groqExecute };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    cfBehavior = "timeout";
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 2_000 });
    // The two not-configured failures never counted and the timeout is only
    // the first counted one: the route is still attempted on the next request.
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 3_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(4);
  });

  it("does not count a timeout that never reached the network (zero transport)", async () => {
    const cloudflareExecute = vi.fn(async () => { throw timeoutError(0); });
    const groqExecute = groqOk();
    const options = { cloudflareExecute, groqExecute };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 2_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
  });

  it("delivers the third route through the streaming variant while the second-route breaker is open", async () => {
    const cloudflareExecute = cloudflareTimeout();
    const groqExecute = groqOk();
    const options = { cloudflareExecute, groqExecute };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);
    const deltas: string[] = [];
    const streamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const result = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: (text: string) => { deltas.push(text); } },
      bothEnv,
      fetch,
      { nowMs: NOW_MS + 2_000, streamExecute, cloudflareExecute, groqExecute },
    );
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("第3経路の回答です。");
    expect(deltas).toEqual(["第3経路の回答です。"]);
    expect(result.attempts?.[1]).toMatchObject({ outcome: "skipped", skipReason: ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON });
  });
});

describe("agent data-step invalid-response route switch (D1, 2026-11-25)", () => {
  // The agent model-call adapter is the only caller that sets the
  // capacity-allocation hint, in exactly these two values; the hint
  // is the dispatch's agent marker.
  const agentRequest = (allocation: "agent-analyzer-chunk" | "agent-analyzer-chunk-primary"): OriginProviderExecutionRequest => ({
    ...request,
    groqSystemInstruction: "経路3専用の短縮指示です。",
    groqCapacityAllocation: allocation,
  });
  const invalidResponseError = (transportRequestCount = 4): OriginProviderError =>
    new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true, undefined, { transportRequestCount });

  it.each(["agent-analyzer-chunk", "agent-analyzer-chunk-primary"] as const)(
    "switches to Groq when the Cloudflare route answers with no usable text on an agent dispatch (%s)",
    async (allocation) => {
      const primaryExecute = primaryRateLimited();
      const cloudflareExecute = vi.fn(async () => { throw invalidResponseError(4); });
      const groqExecute = groqOk();
      const result = await executeOriginProviderWithFailover(agentRequest(allocation), bothEnv, fetch, {
        nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
      });
      expect(primaryExecute).not.toHaveBeenCalled();
      expect(result.text).toBe("第3経路の回答です。");
      // The Cloudflare attempt keeps its honest "failed" outcome —
      // it executed and produced nothing usable — and the composed
      // result still passes the zero-cost assertion: the route
      // demonstrably did not serve.
      expect(result.attempts?.[1]).toEqual({
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "failed",
        errorCode: "PROVIDER_INVALID_RESPONSE",
        rateLimitHit: false,
        transportRequestCount: 4,
        durationMs: expect.any(Number),
      });
      expect(result.attempts).toHaveLength(3);
      expect(result.attempts?.[2]?.outcome).toBe("succeeded");
      expect(result.transportRequestCount).toBe(0 + 4 + 1);
      expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
    },
  );

  it("never switches on an invalid response for a dispatch without the agent marker", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => { throw invalidResponseError(4); });
    const groqExecute = groqOk();
    const error = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(groqExecute).not.toHaveBeenCalled();
    expect(error.code).toBe("PROVIDER_INVALID_RESPONSE");
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual(["skipped", "failed"]);
  });

  it("surfaces the final route's own error when both routes answer with no usable text on an agent dispatch", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => { throw invalidResponseError(4); });
    const groqExecute = vi.fn(async () => { throw invalidResponseError(1); });
    const error = await executeOriginProviderWithFailover(agentRequest("agent-analyzer-chunk"), bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_INVALID_RESPONSE");
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual(["skipped", "failed", "failed"]);
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.providerId)).toEqual([
      "openrouter-free", "cloudflare-workers-ai-free", "groq-free",
    ]);
  });

  it("keeps every other integrity code terminal on an agent dispatch", async () => {
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行計画です。", 400, false, undefined, { transportRequestCount: 4 });
    });
    const groqExecute = groqOk();
    const error = await executeOriginProviderWithFailover(agentRequest("agent-analyzer-chunk"), bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(groqExecute).not.toHaveBeenCalled();
    expect(error.code).toBe("PROVIDER_POLICY_VIOLATION");
  });

  it("falls through to Cloudflare in the Groq-first order when Groq answers with no usable text on an agent dispatch", async () => {
    const groqFirstAgentEnv = {
      ORIGIN_CF_FAILOVER_ENABLED: "true",
      GROQ_API_KEY: SYNTHETIC_KEY,
      ORIGIN_GROQ_FIRST_ENABLED: "true",
    } as NodeJS.ProcessEnv;
    const primaryExecute = primaryRateLimited();
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const groqExecute = vi.fn(async () => { throw invalidResponseError(1); });
    const result = await executeOriginProviderWithFailover(agentRequest("agent-analyzer-chunk"), groqFirstAgentEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.attempts?.[1]).toEqual({
      providerId: "groq-free",
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      outcome: "failed",
      errorCode: "PROVIDER_INVALID_RESPONSE",
      rateLimitHit: false,
      transportRequestCount: 1,
      durationMs: expect.any(Number),
    });
    expect(result.attempts).toHaveLength(3);
    expect(result.transportRequestCount).toBe(0 + 1 + 4);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });
});

describe("Groq-first direct chat order (S-1, 2026-11-17)", () => {
  const groqFirstEnv = {
    ORIGIN_CF_FAILOVER_ENABLED: "true",
    GROQ_API_KEY: SYNTHETIC_KEY,
    ORIGIN_GROQ_FIRST_ENABLED: "true",
  } as NodeJS.ProcessEnv;
  // The direct chat dispatch shape: both chat routers attach the route-2 and
  // route-3 substitute instructions. Synthesis and records requests never do.
  const directRequest: OriginProviderExecutionRequest = {
    ...request,
    cloudflareSystemInstruction: "経路2専用の重複除去指示です。",
    groqSystemInstruction: "経路3専用の短縮指示です。",
  };
  const cloudflareOk = () => vi.fn(async () => cloudflareSuccessResult());
  // A counted second-route failure for the breaker cases below: a timeout
  // that actually sent requests (mirrors the breaker describe's fixture).
  const cloudflareTimeoutError = (): OriginProviderError =>
    new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, {
      transportFailure: "timeout",
      transportRequestCount: 4,
    });

  it("pins the switch name, its exact-true predicate, and the Groq attempt budget default", () => {
    expect(ORIGIN_GROQ_FIRST_ENV).toBe("ORIGIN_GROQ_FIRST_ENABLED");
    expect(isOriginGroqFirstEnabled({ ORIGIN_GROQ_FIRST_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isOriginGroqFirstEnabled({ ORIGIN_GROQ_FIRST_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqFirstEnabled({ ORIGIN_GROQ_FIRST_ENABLED: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqFirstEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(ORIGIN_GROQ_ATTEMPT_BUDGET_MS).toBe(8_000);
  });

  it("keeps the current order for a direct chat dispatch while the switch is unset or not exactly true", async () => {
    for (const env of [bothEnv, { ...bothEnv, ORIGIN_GROQ_FIRST_ENABLED: "yes" } as NodeJS.ProcessEnv]) {
      const cloudflareExecute = cloudflareOk();
      const groqExecute = groqOk();
      const result = await executeOriginProviderWithFailover(directRequest, env, fetch, {
        nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute, groqExecute,
      });
      expect(result.text).toBe("第2経路の回答です。");
      expect(result.attempts).toHaveLength(2);
      expect(groqExecute).not.toHaveBeenCalled();
    }
  });

  it("keeps the current order for a synthesis-shaped dispatch even while the switch is on", async () => {
    const cloudflareExecute = cloudflareOk();
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(request, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.attempts).toHaveLength(2);
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("serves from Groq first: the Cloudflare route is never attempted, so its transport stays at zero", async () => {
    const cloudflareExecute = cloudflareOk();
    const groqExecute = groqOk();
    const result = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第3経路の回答です。");
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(result.attempts).toEqual([
      { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "skipped", skipReason: "route-stopped", transportRequestCount: 0 },
      { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "succeeded", rateLimitHit: false, transportRequestCount: 1, durationMs: expect.any(Number) },
    ]);
    expect(result.transportRequestCount).toBe(1);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("falls through to Cloudflare when Groq fails with an availability error, recording the Groq-first attempt order", async () => {
    const cloudflareExecute = cloudflareOk();
    const groqExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const result = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.attempts).toEqual([
      { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "skipped", skipReason: "route-stopped", transportRequestCount: 0 },
      { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", rateLimitHit: true, transportRequestCount: 1, durationMs: expect.any(Number) },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_FREE_MODEL, outcome: "succeeded", rateLimitHit: false, transportRequestCount: 4, durationMs: expect.any(Number) },
    ]);
    expect(result.transportRequestCount).toBe(0 + 1 + 4);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("falls through to Cloudflare when Groq is skipped before execution, recording the skip in Groq-first order", async () => {
    const cloudflareExecute = cloudflareOk();
    const groqExecute = vi.fn(async () => { throw new OriginGroqPreflightError("evidence-stale"); });
    const result = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute, groqExecute,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.attempts?.[1]).toEqual({
      providerId: "groq-free",
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      outcome: "skipped",
      skipReason: "evidence-stale",
      transportRequestCount: 0,
    });
    expect(result.attempts).toHaveLength(3);
    expect(result.transportRequestCount).toBe(0 + 0 + 4);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("cuts a hanging Groq attempt at its attempt budget and moves on to Cloudflare", async () => {
    const cloudflareExecute = cloudflareOk();
    const groqExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const startedAt = Date.now();
    const result = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute, groqExecute,
      totalBudgetMs: 4_000, groqAttemptBudgetMs: 300,
    });
    const elapsedMs = Date.now() - startedAt;
    expect(result.text).toBe("第2経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(1);
    // Without the attempt budget the Groq route would race the whole
    // remaining total budget (4s here, 45s by default) before giving up.
    expect(elapsedMs).toBeGreaterThanOrEqual(250);
    expect(elapsedMs).toBeLessThan(2_500);
    expect(result.attempts?.[1]).toMatchObject({
      providerId: "groq-free",
      outcome: "availability-error",
      errorCode: "PROVIDER_TIMEOUT",
      transportRequestCount: 0,
    });
    expect(result.attempts?.[1]?.durationMs).toBeGreaterThanOrEqual(250);
    expect(result.attempts?.[1]?.durationMs).toBeLessThan(1_500);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("records the route-stopped skip and serves Groq first on every request (PKG-4 PR-2)", async () => {
    const cloudflareExecute = cloudflareOk();
    const primaryExecute = vi.fn(async () => { throw new Error("primary must not be attempted under the stopped disposition"); });
    const first = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, groqExecute: groqOk(),
    });
    expect(first.text).toBe("第3経路の回答です。");

    const result = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS + 1_000, primaryExecute, cloudflareExecute, groqExecute: groqOk(),
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(result.attempts?.[0]).toEqual({
      providerId: "openrouter-free",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      outcome: "skipped",
      skipReason: "route-stopped",
      transportRequestCount: 0,
    });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[1]).toMatchObject({ providerId: "groq-free", outcome: "succeeded" });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("never fails over a required-tool request while the switch is on: the primary result and error pass through untouched", async () => {
    const toolRequest: OriginProviderExecutionRequest = {
      ...directRequest,
      requiredTool: { name: "emit_result", description: "test", parameters: { type: "object" } },
    };
    const cloudflareExecute = cloudflareOk();
    const groqExecute = groqOk();
    const primaryResult = {
      ...groqSuccessResult(),
      text: "第1経路の回答です。",
      routingEvidence: {
        requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        strategy: "adaptive-primary",
        provider: "OpenRouter",
        attempt: 1,
        fallbackUsed: false,
      },
    } as OriginProviderExecutionResult;
    const result = await executeOriginProviderWithFailover(toolRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: vi.fn(async () => primaryResult), cloudflareExecute, groqExecute,
    });
    expect(result).toBe(primaryResult);
    expect(result.attempts).toBeUndefined();

    const primaryError = rateLimitedError(1);
    const error = await executeOriginProviderWithFailover(toolRequest, groqFirstEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: vi.fn(async () => { throw primaryError; }), cloudflareExecute, groqExecute,
    }).catch((caught: unknown) => caught);
    expect(error).toBe(primaryError);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("streams the Groq answer first without starting the stopped primary stream, without touching Cloudflare", async () => {
    const cloudflareExecute = cloudflareOk();
    const groqExecute = groqOk();
    const streamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      directRequest,
      { onDelta: (text: string) => { deltas.push(text); } },
      groqFirstEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute, groqExecute },
    );
    expect(streamExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第3経路の回答です。");
    expect(deltas).toEqual(["第3経路の回答です。"]);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "route-stopped" });
    expect(result.attempts?.[1]).toMatchObject({ providerId: "groq-free", outcome: "succeeded" });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("streams Cloudflare when the Groq stream fails before any fragment, recording the Groq-first order", async () => {
    const cloudflareExecute = cloudflareOk();
    const groqStreamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const streamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      directRequest,
      { onDelta: (text: string) => { deltas.push(text); } },
      groqFirstEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute, groqStreamExecute },
    );
    expect(result.text).toBe("第2経路の回答です。");
    expect(deltas).toEqual(["第2経路の回答です。"]);
    expect(result.attempts?.map((attempt) => attempt.providerId)).toEqual([
      "openrouter-free",
      "groq-free",
      "cloudflare-workers-ai-free",
    ]);
    expect(result.attempts?.[1]).toMatchObject({ outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED" });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("never switches to Cloudflare after the Groq stream delivered a fragment", async () => {
    const cloudflareExecute = cloudflareOk();
    const cloudflareStreamExecute = vi.fn(async () => cloudflareSuccessResult());
    const groqStreamExecute = vi.fn(async (
      _injectedRequest: OriginProviderExecutionRequest,
      handlers: { onDelta: (text: string) => void },
    ) => {
      handlers.onDelta("第3経路の途中まで");
      throw rateLimitedError(1);
    });
    const streamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const deltas: string[] = [];
    const error = await executeOriginProviderStreamWithFailover(
      directRequest,
      { onDelta: (text: string) => { deltas.push(text); } },
      groqFirstEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute, cloudflareStreamExecute, groqStreamExecute },
    ).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(deltas).toEqual(["第3経路の途中まで"]);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(cloudflareStreamExecute).not.toHaveBeenCalled();
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.providerId)).toEqual([
      "openrouter-free",
      "groq-free",
    ]);
  });

  it("streams Groq first through the route-stopped primary skip as well (PKG-4 PR-2)", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const cloudflareExecute = cloudflareOk();
    const first = await executeOriginProviderStreamWithFailover(
      directRequest,
      { onDelta: () => {} },
      groqFirstEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute, groqExecute: groqOk() },
    );
    expect(first.text).toBe("第3経路の回答です。");
    expect(streamExecute).not.toHaveBeenCalled();

    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      directRequest,
      { onDelta: (text: string) => { deltas.push(text); } },
      groqFirstEnv,
      fetch,
      { nowMs: NOW_MS + 1_000, streamExecute, cloudflareExecute, groqExecute: groqOk() },
    );
    expect(streamExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "route-stopped" });
    expect(result.attempts).toHaveLength(2);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("attempts the final Cloudflare route even while its circuit breaker is open, and the success closes the breaker", async () => {
    // Open the second-route breaker through the current order first: two
    // consecutive counted Cloudflare timeouts with Groq serving behind it.
    let cfBehavior: "timeout" | "ok" = "timeout";
    const cloudflareExecute = vi.fn(async () => {
      if (cfBehavior === "timeout") throw cloudflareTimeoutError();
      return cloudflareSuccessResult();
    });
    const options = {
      cloudflareExecute, groqExecute: groqOk(),
    };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);

    // Groq-first: Groq fails with an availability error, and the final route
    // still runs despite the open breaker — as the last route it is never
    // skipped, exactly like the current order's second route when no later
    // route exists — and serves.
    cfBehavior = "ok";
    const groqFirstExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const result = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      ...options, groqExecute: groqFirstExecute, nowMs: NOW_MS + 2_000,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
    expect(result.attempts?.map((attempt) => attempt.outcome)).toEqual(["skipped", "availability-error", "succeeded"]);
    expect(result.attempts?.[2]).toMatchObject({ providerId: "cloudflare-workers-ai-free", outcome: "succeeded" });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();

    // The success was recorded on the breaker and closed it: a following
    // current-order request attempts the route again instead of skipping it.
    cfBehavior = "timeout";
    const after = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 3_000 });
    expect(after.text).toBe("第3経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(4);
  });

  it("records a counted failure of the final route executed while its breaker is open, keeping the breaker open", async () => {
    const cloudflareExecute = vi.fn(async () => { throw cloudflareTimeoutError(); });
    const options = {
      cloudflareExecute, groqExecute: groqOk(),
    };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);

    // Groq-first: Groq is rate limited and the final route — attempted
    // despite the open breaker — times out as well. The final route's own
    // error surfaces, with all three attempts recorded in Groq-first order.
    const groqFirstExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const error = await executeOriginProviderWithFailover(directRequest, groqFirstEnv, fetch, {
      ...options, groqExecute: groqFirstExecute, nowMs: NOW_MS + 2_000,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_TIMEOUT");
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.providerId)).toEqual([
      "openrouter-free",
      "groq-free",
      "cloudflare-workers-ai-free",
    ]);
    expect(error.diagnostic?.failoverAttempts?.[2]).toMatchObject({ outcome: "availability-error", errorCode: "PROVIDER_TIMEOUT" });

    // The failure was recorded as usual (an executed-while-open counted
    // failure re-opens the breaker at once): the next current-order request
    // still skips the route and Groq serves.
    const after = await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...options, nowMs: NOW_MS + 3_000 });
    expect(after.text).toBe("第3経路の回答です。");
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
    expect(after.attempts?.[1]).toMatchObject({ outcome: "skipped", skipReason: ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON });
  });

  it("streams the final Cloudflare route even while its circuit breaker is open", async () => {
    const cloudflareExecute = vi.fn(async () => { throw cloudflareTimeoutError(); });
    const setupOptions = {
      cloudflareExecute, groqExecute: groqOk(),
    };
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...setupOptions, nowMs: NOW_MS });
    await executeOriginProviderWithFailover(request, bothEnv, fetch, { ...setupOptions, nowMs: NOW_MS + 1_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(2);

    const streamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const groqStreamExecute = vi.fn(async () => { throw rateLimitedError(1); });
    const cloudflareStreamOk = vi.fn(async () => cloudflareSuccessResult());
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      directRequest,
      { onDelta: (text: string) => { deltas.push(text); } },
      groqFirstEnv,
      fetch,
      { nowMs: NOW_MS + 2_000, streamExecute, cloudflareExecute: cloudflareStreamOk, groqStreamExecute },
    );
    expect(result.text).toBe("第2経路の回答です。");
    expect(deltas).toEqual(["第2経路の回答です。"]);
    expect(cloudflareStreamOk).toHaveBeenCalledTimes(1);
    expect(result.attempts?.map((attempt) => attempt.providerId)).toEqual([
      "openrouter-free",
      "groq-free",
      "cloudflare-workers-ai-free",
    ]);
    expect(result.attempts?.[2]).toMatchObject({ outcome: "succeeded" });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });
});

describe("assertOriginZeroCostExecutionResultWithFailover with the Groq-first order (S-1)", () => {
  const primaryFailed = { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const, transportRequestCount: 1 };
  const groqFailed = { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const, transportRequestCount: 1 };
  const groqSkipped = { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "skipped" as const, skipReason: "evidence-stale", transportRequestCount: 0 };
  const groqServed = { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "succeeded" as const, transportRequestCount: 1 };
  const cfServed = { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_FREE_MODEL, outcome: "succeeded" as const, transportRequestCount: 4 };

  it("accepts the two-attempt Groq-first shape (Groq served immediately)", () => {
    const result: OriginProviderExecutionResult = {
      ...groqSuccessResult(),
      transportRequestCount: 2,
      attempts: [primaryFailed, groqServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("accepts the route-stopped Groq-first shapes (PKG-4 PR-2)", () => {
    const routeStopped = { providerId: "openrouter-free", modelId: ORIGIN_OPENROUTER_FREE_MODEL, outcome: "skipped" as const, skipReason: "route-stopped", transportRequestCount: 0 };
    const twoAttempt: OriginProviderExecutionResult = {
      ...groqSuccessResult(),
      transportRequestCount: 1,
      attempts: [routeStopped, groqServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(twoAttempt, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
    const threeAttempt: OriginProviderExecutionResult = {
      ...cloudflareSuccessResult(),
      transportRequestCount: 0 + 1 + 4,
      attempts: [routeStopped, groqFailed, cfServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(threeAttempt, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("accepts the three-attempt Groq-first shape (Groq failed, Cloudflare served)", () => {
    const result: OriginProviderExecutionResult = {
      ...cloudflareSuccessResult(),
      transportRequestCount: 1 + 1 + 4,
      attempts: [primaryFailed, groqFailed, cfServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("accepts the three-attempt Groq-first shape with a pre-execution Groq skip in the middle", () => {
    const result: OriginProviderExecutionResult = {
      ...cloudflareSuccessResult(),
      transportRequestCount: 1 + 0 + 4,
      attempts: [primaryFailed, groqSkipped, cfServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("rejects a forged order whose middle attempt claims success", () => {
    const result: OriginProviderExecutionResult = {
      ...groqSuccessResult(),
      transportRequestCount: 1 + 4 + 1,
      attempts: [primaryFailed, cfServed, groqServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });

  it("rejects a Groq-first attempt record paired with the other route's result", () => {
    // The attempts claim Cloudflare served last, but the result itself is the
    // Groq route's: the serving route's own verification refuses the pairing.
    const result: OriginProviderExecutionResult = {
      ...groqSuccessResult(),
      transportRequestCount: 1 + 1 + 4,
      attempts: [primaryFailed, groqFailed, cfServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });

  it("rejects a record that runs the same failover route twice", () => {
    const result: OriginProviderExecutionResult = {
      ...groqSuccessResult(),
      transportRequestCount: 1 + 1 + 1,
      attempts: [primaryFailed, groqFailed, groqServed],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });

  it("rejects a record whose serving attempt is not the last one", () => {
    const result: OriginProviderExecutionResult = {
      ...cloudflareSuccessResult(),
      transportRequestCount: 1 + 1 + 4,
      attempts: [primaryFailed, groqServed, { ...cfServed, outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const }],
    };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_ROUTING_UNVERIFIED" }));
  });
});

describe("rate-limit attempt evidence (capacity D-0)", () => {
  const RATE_LIMIT_SNAPSHOT = {
    limitRequests: 1000,
    remainingRequests: 0,
    limitTokens: 200000,
    remainingTokens: 0,
    resetRequestsSeconds: 2,
    resetTokensSeconds: 0.5,
  };

  it("carries the serving route's rate-limit snapshot and a false hit flag on its success attempt", async () => {
    const groqExecute = vi.fn(async () => ({ ...groqSuccessResult(), rateLimit: RATE_LIMIT_SNAPSHOT }));
    const result = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute: cloudflareSkipped(), groqExecute,
    });
    expect(result.rateLimit).toEqual(RATE_LIMIT_SNAPSHOT);
    expect(result.attempts?.[2]).toEqual({
      providerId: "groq-free",
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      outcome: "succeeded",
      rateLimitHit: false,
      rateLimit: RATE_LIMIT_SNAPSHOT,
      transportRequestCount: 1,
      durationMs: expect.any(Number),
    });
  });

  it("marks a rate-limited attempt as a hit and surfaces the snapshot through the failure diagnostic", async () => {
    const groqExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, {
        transportRequestCount: 1, upstreamStatus: 429, rateLimit: RATE_LIMIT_SNAPSHOT,
      });
    });
    const error = await executeOriginProviderWithFailover(request, bothEnv, fetch, {
      nowMs: NOW_MS, primaryExecute: primaryRateLimited(), cloudflareExecute: cloudflareSkipped(), groqExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.diagnostic?.failoverAttempts?.[2]).toEqual({
      providerId: "groq-free",
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      outcome: "availability-error",
      errorCode: "PROVIDER_RATE_LIMITED",
      rateLimitHit: true,
      rateLimit: RATE_LIMIT_SNAPSHOT,
      upstreamStatus: 429,
      transportRequestCount: 1,
      durationMs: expect.any(Number),
    });
    const summary = buildOriginProviderFailureDiagnostic(error);
    expect(summary.rateLimit).toEqual(RATE_LIMIT_SNAPSHOT);
    expect(summary.failoverAttempts[2]).toMatchObject({ rateLimitHit: true, rateLimit: RATE_LIMIT_SNAPSHOT });
  });
});
