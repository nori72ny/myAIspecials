import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertOriginZeroCostExecutionResultWithFailover,
  executeOriginProviderWithFailover,
  resetOriginProviderFailoverCircuitForTests,
} from "./originProviderFailover";
import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient";
import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";
import { OriginCloudflarePreflightError } from "./originCloudflareProviderClient";
import { OriginGroqPreflightError } from "./originGroqProviderClient";
import { OriginOvhcloudPreflightError } from "./originOvhcloudProviderClient";
import { ORIGIN_OVHCLOUD_FREE_MODEL_ID } from "../lib/orchestration/OriginOvhcloudFreeModelCatalog";

const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");
const primaryPlan: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: "google/gemma-4-31b-it:free",
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
  messages: [{ role: "user", content: "短く要約してください" }],
  systemInstruction: "安全に回答してください。",
  ovhcloudFallbackEligible: true,
};
const unusedFetch = vi.fn(async () => { throw new Error("network must not be called"); }) as unknown as OriginFetch;

const SYNTHETIC_KEY = "synthetic-groq-api-key-for-tests-only";
const bothEnv = {
  ORIGIN_CF_FAILOVER_ENABLED: "true",
  GROQ_API_KEY: SYNTHETIC_KEY,
  ORIGIN_OVH_FAILOVER_ENABLED: "true",
} as NodeJS.ProcessEnv;

function rateLimitedError(transportRequestCount: number): OriginProviderError {
  return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, {
    transportRequestCount,
    upstreamStatus: 429,
    upstreamErrorCode: "rate_limit_exceeded",
  });
}

function ovhcloudResult(): OriginProviderExecutionResult {
  return {
    text: "第4経路の回答です。",
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    usage: { costUsd: 0 },
    transportRequestCount: 1,
    routingEvidence: {
      requestedModel: ORIGIN_OVHCLOUD_FREE_MODEL_ID,
      servedModel: ORIGIN_OVHCLOUD_FREE_MODEL_ID,
      strategy: "verified-free-failover",
      provider: "OVHcloud",
      attempt: 4,
      fallbackUsed: true,
    },
  };
}

function cloudflareDown(): OriginProviderError {
  return rateLimitedError(4);
}

function groqDown(): OriginProviderError {
  return rateLimitedError(1);
}

type Executor = (
  providerRequest: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options?: unknown,
) => Promise<OriginProviderExecutionResult>;

function executors(overrides: Partial<Record<"cloudflare" | "groq" | "ovhcloud", Executor>>): {
  cloudflareExecute: Executor;
  groqExecute: Executor;
  ovhcloudExecute: Executor;
} {
  return {
    cloudflareExecute: vi.fn(overrides.cloudflare ?? (async () => { throw cloudflareDown(); })) as Executor,
    groqExecute: vi.fn(overrides.groq ?? (async () => { throw groqDown(); })) as Executor,
    ovhcloudExecute: vi.fn(overrides.ovhcloud ?? (async () => ovhcloudResult())) as Executor,
  };
}

describe("OVHcloud fourth route in the failover dispatcher", () => {
  beforeEach(() => {
    resetOriginProviderFailoverCircuitForTests();
  });

  it("serves from OVHcloud when both routes are availability-down, the switch is on, and the request is marked", async () => {
    const routes = executors({});
    const result = await executeOriginProviderWithFailover(request, bothEnv, unusedFetch, {
      nowMs: NOW_MS,
      primaryExecute: vi.fn(async () => { throw new Error("primary must not run"); }),
      ...routes,
    });
    expect(result.text).toBe("第4経路の回答です。");
    expect(routes.ovhcloudExecute).toHaveBeenCalledTimes(1);
    expect(result.attempts?.map((attempt) => [attempt.providerId, attempt.outcome])).toEqual([
      ["openrouter-free", "skipped"],
      ["cloudflare-workers-ai-free", "availability-error"],
      ["groq-free", "availability-error"],
      ["ovhcloud-free", "succeeded"],
    ]);
    expect(result.transportRequestCount).toBe(6);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result)).not.toThrow();
  });

  it("never calls OVHcloud while the switch is off: the Groq error surfaces unchanged", async () => {
    const routes = executors({});
    const env = {
      ORIGIN_CF_FAILOVER_ENABLED: "true",
      GROQ_API_KEY: SYNTHETIC_KEY,
    } as NodeJS.ProcessEnv;
    const error = await executeOriginProviderWithFailover(request, env, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    }).catch((caught: unknown) => caught);
    expect(routes.ovhcloudExecute).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).diagnostic?.failoverAttempts).toHaveLength(3);
  });

  it("never calls OVHcloud for an unmarked request even when the switch is on", async () => {
    const routes = executors({});
    const unmarked: OriginProviderExecutionRequest = {
      plan: primaryPlan,
      messages: request.messages,
      systemInstruction: request.systemInstruction,
    };
    const error = await executeOriginProviderWithFailover(unmarked, bothEnv, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    }).catch((caught: unknown) => caught);
    expect(routes.ovhcloudExecute).not.toHaveBeenCalled();
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
  });

  it("does not call OVHcloud when Groq already served", async () => {
    const groqServed: OriginProviderExecutionResult = {
      ...ovhcloudResult(),
      text: "Groqの回答です。",
      routingEvidence: {
        requestedModel: "openai/gpt-oss-120b",
        servedModel: "openai/gpt-oss-120b",
        strategy: "verified-free-failover",
        provider: "Groq",
        attempt: 3,
        fallbackUsed: true,
      },
    };
    const routes = executors({ groq: async () => groqServed });
    const result = await executeOriginProviderWithFailover(request, bothEnv, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    });
    expect(result.text).toBe("Groqの回答です。");
    expect(routes.ovhcloudExecute).not.toHaveBeenCalled();
    expect(result.attempts).toHaveLength(3);
  });

  it("does not call OVHcloud when Cloudflare was only skipped before execution (evidence stale)", async () => {
    const routes = executors({
      cloudflare: async () => { throw new OriginCloudflarePreflightError("evidence-stale"); },
    });
    const error = await executeOriginProviderWithFailover(request, bothEnv, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    }).catch((caught: unknown) => caught);
    expect(routes.ovhcloudExecute).not.toHaveBeenCalled();
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual([
      "skipped",
      "skipped",
      "availability-error",
    ]);
  });

  it("does not call OVHcloud when Groq was only skipped before execution (stale evidence)", async () => {
    const routes = executors({
      groq: async () => { throw new OriginGroqPreflightError("evidence-stale"); },
    });
    const error = await executeOriginProviderWithFailover(request, bothEnv, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    }).catch((caught: unknown) => caught);
    expect(routes.ovhcloudExecute).not.toHaveBeenCalled();
    // The Cloudflare error stays the surfaced one, as before this route existed.
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).diagnostic?.failoverAttempts).toHaveLength(3);
  });

  it("records an OVHcloud pre-execution skip and surfaces the earlier routes' error", async () => {
    const routes = executors({
      ovhcloud: async () => { throw new OriginOvhcloudPreflightError("evidence-stale"); },
    });
    const error = await executeOriginProviderWithFailover(request, bothEnv, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    }).catch((caught: unknown) => caught);
    expect(routes.ovhcloudExecute).toHaveBeenCalledTimes(1);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    const attempts = (error as OriginProviderError).diagnostic?.failoverAttempts;
    expect(attempts).toHaveLength(4);
    expect(attempts?.[3]).toMatchObject({
      providerId: "ovhcloud-free",
      outcome: "skipped",
      skipReason: "evidence-stale",
      transportRequestCount: 0,
    });
  });

  it("surfaces the OVHcloud route's own error when it executed and failed", async () => {
    const routes = executors({
      ovhcloud: async () => { throw rateLimitedError(1); },
    });
    const error = await executeOriginProviderWithFailover(request, bothEnv, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    }).catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    const attempts = (error as OriginProviderError).diagnostic?.failoverAttempts;
    expect(attempts).toHaveLength(4);
    expect(attempts?.[3]).toMatchObject({
      providerId: "ovhcloud-free",
      outcome: "availability-error",
      errorCode: "PROVIDER_RATE_LIMITED",
    });
  });

  it("serves from OVHcloud in Groq-first order as well (Groq down, then Cloudflare down)", async () => {
    const routes = executors({});
    const groqFirstRequest: OriginProviderExecutionRequest = {
      ...request,
      groqSystemInstruction: "直接チャットのシステム指示です。",
    };
    const groqFirstEnv = { ...bothEnv, ORIGIN_GROQ_FIRST_ENABLED: "true" } as NodeJS.ProcessEnv;
    const result = await executeOriginProviderWithFailover(groqFirstRequest, groqFirstEnv, unusedFetch, {
      nowMs: NOW_MS,
      ...routes,
    });
    expect(result.text).toBe("第4経路の回答です。");
    expect(routes.ovhcloudExecute).toHaveBeenCalledTimes(1);
    expect(result.attempts?.map((attempt) => [attempt.providerId, attempt.outcome])).toEqual([
      ["openrouter-free", "skipped"],
      ["groq-free", "availability-error"],
      ["cloudflare-workers-ai-free", "availability-error"],
      ["ovhcloud-free", "succeeded"],
    ]);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result)).not.toThrow();
  });
});
