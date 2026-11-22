import { describe, expect, it, vi } from "vitest";
import {
  buildOriginExecutionPlan,
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import { DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import {
  DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG,
  ORIGIN_GROQ_FREE_MODEL_ID,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "./originProviderClient.js";
import {
  assertGroundedResearchRecordsZeroCost,
  createGroundedResearchRecordsRetryExecutor,
  createGroundedResearchRecordsRetryExecutorWithDetail,
  identifyGroundedResearchServingRoute,
} from "./originRecordsRetryRoute.js";

/**
 * R-PR-5 (design §10): route advancement for the records fresh retry.
 * Pins serving-route identification, the next-route plan derivation
 * (route 1 → the Cloudflare route plan, route 2 → the Groq route
 * plan, executed through the route's own executor), every
 * no-next-route case, and the per-shape $0 assertion dispatch.
 */

const PRIMARY_MODEL = "google/gemma-4-31b-it:free";
const ZERO_POLICY = { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true } as const;

const SOURCE_PLAN: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "OpenRouter",
  modelId: PRIMARY_MODEL,
  taskType: "research",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 20_000,
  requiresOwnerApproval: false,
  reason: "test",
  providerDataPolicy: { ...ZERO_POLICY },
  modelEvidence: {
    providerId: "openrouter-free",
    verifiedAt: "2026-11-14T00:00:00.000Z",
    reviewAfter: "2026-12-31T00:00:00.000Z",
    sourceUrl: "https://example.com/evidence",
  },
};

const REQUEST: OriginProviderExecutionRequest = {
  plan: SOURCE_PLAN,
  messages: [{ role: "user", content: "records please" }],
  systemInstruction: "records instruction",
  groqSystemInstruction: "compact groq instruction",
};

const CF_ENV: NodeJS.ProcessEnv = {
  ORIGIN_CF_FAILOVER_ENABLED: "true",
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  ORIGIN_CF_PROOF_TOKEN: "proof-token-value-0123456789",
  ORIGIN_CF_AI_TOKEN: "ai-token-value-0123456789",
};

const GROQ_ENV: NodeJS.ProcessEnv = { GROQ_API_KEY: "gsk_test_key_value_0123456789" };

const CF_NOW_MS = Date.parse(DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG[0].verifiedAt) + 1_000;
const GROQ_NOW_MS = Date.parse(DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG[0].verifiedAt) + 1_000;

function bareResult(
  provider: string,
  attempt: number,
  model: string,
  strategy: string,
): OriginProviderExecutionResult {
  return {
    text: "records",
    actualCostUsd: 0,
    providerDataPolicy: { ...ZERO_POLICY },
    routingEvidence: {
      requestedModel: model,
      servedModel: model,
      strategy,
      provider,
      attempt,
      fallbackUsed: attempt > 1,
    },
    usage: { costUsd: 0 },
    transportRequestCount: 1,
  };
}

function route1Result(): OriginProviderExecutionResult {
  return {
    ...bareResult("OpenRouter", 1, PRIMARY_MODEL, "adaptive-primary"),
    attempts: [{
      providerId: "openrouter-free",
      modelId: PRIMARY_MODEL,
      outcome: "succeeded",
      transportRequestCount: 1,
      durationMs: 100,
    }],
  };
}

function route2Result(): OriginProviderExecutionResult {
  return {
    ...bareResult("Cloudflare", 2, ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, "verified-free-failover"),
    transportRequestCount: 2,
    attempts: [
      { providerId: "openrouter-free", modelId: PRIMARY_MODEL, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", transportRequestCount: 1 },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, outcome: "succeeded", transportRequestCount: 1 },
    ],
  };
}

function route3Result(): OriginProviderExecutionResult {
  return {
    ...bareResult("Groq", 3, ORIGIN_GROQ_FREE_MODEL_ID, "verified-free-failover"),
    transportRequestCount: 3,
    attempts: [
      { providerId: "openrouter-free", modelId: PRIMARY_MODEL, outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", transportRequestCount: 1 },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, outcome: "availability-error", errorCode: "PROVIDER_UNAVAILABLE", transportRequestCount: 1 },
      { providerId: "groq-free", modelId: ORIGIN_GROQ_FREE_MODEL_ID, outcome: "succeeded", transportRequestCount: 1 },
    ],
  };
}

describe("identifyGroundedResearchServingRoute", () => {
  it("reads the serving route from the composite attempts record", () => {
    expect(identifyGroundedResearchServingRoute(route1Result())).toBe(1);
    expect(identifyGroundedResearchServingRoute(route2Result())).toBe(2);
    expect(identifyGroundedResearchServingRoute(route3Result())).toBe(3);
  });

  it("skips non-succeeded attempts (a circuit-breaker skip still resolves to the serving route)", () => {
    const result = route2Result();
    result.attempts = [
      { providerId: "openrouter-free", modelId: PRIMARY_MODEL, outcome: "skipped", skipReason: "primary-circuit-open", errorCode: "PROVIDER_RATE_LIMITED", transportRequestCount: 0 },
      { providerId: "cloudflare-workers-ai-free", modelId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, outcome: "succeeded", transportRequestCount: 1 },
    ];
    expect(identifyGroundedResearchServingRoute(result)).toBe(2);
  });

  it("falls back to routingEvidence for bare results (attempt number, then provider name)", () => {
    expect(identifyGroundedResearchServingRoute(bareResult("Cloudflare", 2, ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, "verified-free-failover"))).toBe(2);
    expect(identifyGroundedResearchServingRoute(bareResult("OpenRouter", 1, PRIMARY_MODEL, "adaptive-primary"))).toBe(1);
    const byName = bareResult("Groq", 0, ORIGIN_GROQ_FREE_MODEL_ID, "verified-free-failover");
    expect(identifyGroundedResearchServingRoute(byName)).toBe(3);
  });

  it("returns null when no source identifies a route in the fixed order", () => {
    expect(identifyGroundedResearchServingRoute(bareResult("Other", 9, "m", "s"))).toBeNull();
    const unknownAttempt: OriginProviderExecutionResult = {
      ...bareResult("OpenRouter", 1, PRIMARY_MODEL, "adaptive-primary"),
      attempts: [{ providerId: "some-other-provider", modelId: "m", outcome: "succeeded", transportRequestCount: 1 }],
    };
    expect(identifyGroundedResearchServingRoute(unknownAttempt)).toBeNull();
  });
});

describe("createGroundedResearchRecordsRetryExecutor", () => {
  it("advances route 1 to the Cloudflare route plan and executes it there", async () => {
    const cfResult = bareResult("Cloudflare", 2, ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, "verified-free-failover");
    let seenRequest: OriginProviderExecutionRequest | undefined;
    const cloudflareExecute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      seenRequest = request;
      return cfResult;
    });
    const groqExecute = vi.fn(async () => {
      throw new Error("must not run");
    });
    const executeRetry = createGroundedResearchRecordsRetryExecutor({
      env: CF_ENV,
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
      groqExecute: groqExecute as never,
    });
    const outcome = await executeRetry(REQUEST, route1Result());
    expect(outcome).toBe(cfResult);
    expect(groqExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).toHaveBeenCalledTimes(1);
    expect(seenRequest?.plan.providerId).toBe("cloudflare-workers-ai-free");
    expect(seenRequest?.plan.modelId).toBe(ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL);
    // The route plan carries the dispatcher's raised route timeout.
    expect(seenRequest?.plan.timeoutMs).toBe(52_000);
    expect(seenRequest?.messages).toBe(REQUEST.messages);
    expect(seenRequest?.systemInstruction).toBe(REQUEST.systemInstruction);
  });

  it("advances route 2 to the Groq route plan and executes it there", async () => {
    const groqResult = bareResult("Groq", 3, ORIGIN_GROQ_FREE_MODEL_ID, "verified-free-failover");
    const cloudflareExecute = vi.fn(async () => {
      throw new Error("must not run");
    });
    let seenRequest: OriginProviderExecutionRequest | undefined;
    const groqExecute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      seenRequest = request;
      return groqResult;
    });
    const executeRetry = createGroundedResearchRecordsRetryExecutor({
      env: GROQ_ENV,
      nowMs: GROQ_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
      groqExecute: groqExecute as never,
    });
    const outcome = await executeRetry(REQUEST, route2Result());
    expect(outcome).toBe(groqResult);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(groqExecute).toHaveBeenCalledTimes(1);
    expect(seenRequest?.plan.providerId).toBe("groq-free");
    expect(seenRequest?.plan.modelId).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(seenRequest?.plan.timeoutMs).toBe(52_000);
    expect(seenRequest?.groqSystemInstruction).toBe(REQUEST.groqSystemInstruction);
  });

  it("returns null when the initial execution already reached route 3", async () => {
    const cloudflareExecute = vi.fn(async () => route2Result());
    const groqExecute = vi.fn(async () => route3Result());
    const executeRetry = createGroundedResearchRecordsRetryExecutor({
      env: { ...CF_ENV, ...GROQ_ENV },
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
      groqExecute: groqExecute as never,
    });
    expect(await executeRetry(REQUEST, route3Result())).toBeNull();
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("returns null when the serving route cannot be identified", async () => {
    const executeRetry = createGroundedResearchRecordsRetryExecutor({ env: { ...CF_ENV, ...GROQ_ENV }, nowMs: CF_NOW_MS });
    expect(await executeRetry(REQUEST, bareResult("Other", 9, "m", "s"))).toBeNull();
  });

  it("returns null when the Cloudflare route is not enabled or not credentialed", async () => {
    const cloudflareExecute = vi.fn(async () => route2Result());
    const notEnabled = createGroundedResearchRecordsRetryExecutor({
      env: { ...CF_ENV, ORIGIN_CF_FAILOVER_ENABLED: "false" },
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
    });
    expect(await notEnabled(REQUEST, route1Result())).toBeNull();
    const notCredentialed = createGroundedResearchRecordsRetryExecutor({
      env: { ORIGIN_CF_FAILOVER_ENABLED: "true" },
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
    });
    expect(await notCredentialed(REQUEST, route1Result())).toBeNull();
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });

  it("returns null when the Groq route is not configured", async () => {
    const groqExecute = vi.fn(async () => route3Result());
    const executeRetry = createGroundedResearchRecordsRetryExecutor({
      env: {},
      nowMs: GROQ_NOW_MS,
      groqExecute: groqExecute as never,
    });
    expect(await executeRetry(REQUEST, route2Result())).toBeNull();
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("returns null without executing when the next route's evidence is stale", async () => {
    const cloudflareExecute = vi.fn(async () => route2Result());
    const staleNowMs = Date.parse(DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG[0].reviewAfter) + 1_000;
    const executeRetry = createGroundedResearchRecordsRetryExecutor({
      env: CF_ENV,
      nowMs: staleNowMs,
      cloudflareExecute: cloudflareExecute as never,
    });
    expect(await executeRetry(REQUEST, route1Result())).toBeNull();
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });
});

describe("createGroundedResearchRecordsRetryExecutorWithDetail (R-PR-8d skip stages)", () => {
  it("names the route-unidentifiable stage", async () => {
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: { ...CF_ENV, ...GROQ_ENV },
      nowMs: CF_NOW_MS,
    });
    expect(await executeRetry(REQUEST, bareResult("Other", 9, "m", "s"))).toEqual({
      skipDetail: "route-unidentifiable",
    });
  });

  it("names the final-route stage when the initial execution already reached route 3", async () => {
    const cloudflareExecute = vi.fn(async () => route2Result());
    const groqExecute = vi.fn(async () => route3Result());
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: { ...CF_ENV, ...GROQ_ENV },
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
      groqExecute: groqExecute as never,
    });
    expect(await executeRetry(REQUEST, route3Result())).toEqual({ skipDetail: "final-route" });
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("distinguishes the Cloudflare not-enabled and not-credentialed stages", async () => {
    const cloudflareExecute = vi.fn(async () => route2Result());
    const notEnabled = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: { ...CF_ENV, ORIGIN_CF_FAILOVER_ENABLED: "false" },
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
    });
    expect(await notEnabled(REQUEST, route1Result())).toEqual({ skipDetail: "cloudflare-not-enabled" });
    const notCredentialed = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: { ORIGIN_CF_FAILOVER_ENABLED: "true" },
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
    });
    expect(await notCredentialed(REQUEST, route1Result())).toEqual({
      skipDetail: "cloudflare-not-credentialed",
    });
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });

  it("names the Cloudflare plan stage with the plan failure code, without executing", async () => {
    const cloudflareExecute = vi.fn(async () => route2Result());
    const staleNowMs = Date.parse(DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG[0].reviewAfter) + 1_000;
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: CF_ENV,
      nowMs: staleNowMs,
      cloudflareExecute: cloudflareExecute as never,
    });
    expect(await executeRetry(REQUEST, route1Result())).toEqual({
      skipDetail: "cloudflare-plan-failed:FREE_MODEL_EVIDENCE_STALE",
    });
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });

  it("names the Groq not-configured stage", async () => {
    const groqExecute = vi.fn(async () => route3Result());
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: {},
      nowMs: GROQ_NOW_MS,
      groqExecute: groqExecute as never,
    });
    expect(await executeRetry(REQUEST, route2Result())).toEqual({ skipDetail: "groq-not-configured" });
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("names the Groq plan stage with the plan failure code, without executing", async () => {
    const groqExecute = vi.fn(async () => route3Result());
    const staleNowMs = Date.parse(DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG[0].reviewAfter) + 1_000;
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: GROQ_ENV,
      nowMs: staleNowMs,
      groqExecute: groqExecute as never,
    });
    expect(await executeRetry(REQUEST, route2Result())).toEqual({
      skipDetail: "groq-plan-failed:FREE_MODEL_EVIDENCE_STALE",
    });
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("returns the executed result itself (no skip carrier) when the derivation succeeds", async () => {
    const cfResult = bareResult("Cloudflare", 2, ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, "verified-free-failover");
    const cloudflareExecute = vi.fn(async () => cfResult);
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: CF_ENV,
      nowMs: CF_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
    });
    expect(await executeRetry(REQUEST, route1Result())).toBe(cfResult);
  });
});

describe("next-route derivation with production-shaped inputs (R-PR-8d)", () => {
  // The routers wire the executor with no catalogs (the builders fall
  // back to the default evidence catalogs) and a plan built by
  // buildOriginExecutionPlan. These tests pin the derivation against
  // exactly that shape, on a clock inside every route's current
  // evidence freshness window (the pin moves with the catalog
  // evidence refreshes): route 1 must derive the Cloudflare plan and
  // route 2 must derive the Groq plan.
  const MEASUREMENT_NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");
  const PROD_ENV: NodeJS.ProcessEnv = { ...CF_ENV, ...GROQ_ENV };

  function productionRequest(): OriginProviderExecutionRequest {
    const planResult = buildOriginExecutionPlan(
      { goal: "records please", requiresCodeChanges: false, requiresFreshResearch: true, containsSecrets: false },
      { openRouterConfigured: true },
      undefined,
      { nowMs: MEASUREMENT_NOW_MS },
    );
    if (!planResult.ok) throw new Error("primary plan must build");
    return {
      plan: planResult.plan,
      messages: [{ role: "user", content: "records please" }],
      systemInstruction: "records instruction",
      groqSystemInstruction: "compact groq instruction",
    };
  }

  it("derives the Cloudflare plan for a route-1 result and executes it there", async () => {
    const cfResult = bareResult("Cloudflare", 2, ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, "verified-free-failover");
    let seenRequest: OriginProviderExecutionRequest | undefined;
    const cloudflareExecute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      seenRequest = request;
      return cfResult;
    });
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: PROD_ENV,
      nowMs: MEASUREMENT_NOW_MS,
      cloudflareExecute: cloudflareExecute as never,
    });
    const outcome = await executeRetry(productionRequest(), route1Result());
    expect(outcome).toBe(cfResult);
    expect(cloudflareExecute).toHaveBeenCalledTimes(1);
    expect(seenRequest?.plan.providerId).toBe("cloudflare-workers-ai-free");
    expect(seenRequest?.plan.modelId).toBe(ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL);
    expect(seenRequest?.plan.timeoutMs).toBe(52_000);
  });

  it("derives the Groq plan for a route-2 result and executes it there", async () => {
    const groqResult = bareResult("Groq", 3, ORIGIN_GROQ_FREE_MODEL_ID, "verified-free-failover");
    let seenRequest: OriginProviderExecutionRequest | undefined;
    const groqExecute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      seenRequest = request;
      return groqResult;
    });
    const executeRetry = createGroundedResearchRecordsRetryExecutorWithDetail({
      env: PROD_ENV,
      nowMs: MEASUREMENT_NOW_MS,
      groqExecute: groqExecute as never,
    });
    const outcome = await executeRetry(productionRequest(), route2Result());
    expect(outcome).toBe(groqResult);
    expect(groqExecute).toHaveBeenCalledTimes(1);
    expect(seenRequest?.plan.providerId).toBe("groq-free");
    expect(seenRequest?.plan.modelId).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(seenRequest?.plan.timeoutMs).toBe(52_000);
    expect(seenRequest?.groqSystemInstruction).toBe("compact groq instruction");
  });
});

describe("assertGroundedResearchRecordsZeroCost", () => {
  it("accepts a bare route-2 (Cloudflare) result through the route's own assertion", () => {
    const result = bareResult("Cloudflare", 2, ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, "verified-free-failover");
    result.routingEvidence = { ...result.routingEvidence, neurons: 12 };
    expect(() => assertGroundedResearchRecordsZeroCost(result, PRIMARY_MODEL)).not.toThrow();
  });

  it("accepts a bare route-3 (Groq) result through the route's own assertion", () => {
    const result = bareResult("Groq", 3, ORIGIN_GROQ_FREE_MODEL_ID, "verified-free-failover");
    expect(() => assertGroundedResearchRecordsZeroCost(result, PRIMARY_MODEL)).not.toThrow();
  });

  it("keeps bare route-1 and composite results on the standing failover assertion", () => {
    expect(() => assertGroundedResearchRecordsZeroCost(bareResult("OpenRouter", 1, PRIMARY_MODEL, "adaptive-primary"), PRIMARY_MODEL)).not.toThrow();
    expect(() => assertGroundedResearchRecordsZeroCost(route2Result(), PRIMARY_MODEL)).not.toThrow();
    expect(() => assertGroundedResearchRecordsZeroCost(route3Result(), PRIMARY_MODEL)).not.toThrow();
  });

  it("rejects a bare route-2 result whose served model is not the route model", () => {
    const result = bareResult("Cloudflare", 2, "some/other-model", "verified-free-failover");
    expect(() => assertGroundedResearchRecordsZeroCost(result, PRIMARY_MODEL)).toThrow();
  });

  it("rejects a bare route-1 result that fails the standing assertion", () => {
    const result = bareResult("OpenRouter", 1, "some/other-model", "adaptive-primary");
    expect(() => assertGroundedResearchRecordsZeroCost(result, PRIMARY_MODEL)).toThrow();
  });
});
