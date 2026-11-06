import {
  buildOriginCloudflareRoutePlan,
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
  ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  ORIGIN_CLOUDFLARE_FREE_MODEL,
  type OriginCloudflareFreeModelEvidence,
} from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import {
  assertOriginZeroCostExecutionResult,
  executeOriginProvider,
  OriginProviderError,
  type OriginFetch,
  type OriginProviderAttemptEvidence,
  type OriginProviderErrorCode,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";
import {
  assertOriginCloudflareExecutionResult,
  executeOriginCloudflareProvider,
  isOriginCloudflareFailoverEnabled,
  OriginCloudflarePreflightError,
} from "./originCloudflareProviderClient.js";
import {
  executeOriginProviderStream,
  type OriginProviderStreamHandlers,
} from "./originProviderStreamClient.js";

/**
 * Free-provider failover dispatcher (Phase 1).
 *
 * Route order is fixed: (1) OpenRouter primary, unchanged; (2) Cloudflare Workers AI,
 * reached only when the primary fails with an availability error and the owner has enabled
 * ORIGIN_CF_FAILOVER_ENABLED. Owner decision 2026-11-06 approved replacing the previous
 * "never switch providers automatically" release-gate rule with this bounded failover
 * between independently verified free ZDR routes. The verification standard is not relaxed:
 * each route verifies its own evidence freshness, $0 state, data policy, and served-model
 * identity, and the composite result records every executed attempt in `attempts`.
 *
 * Failover triggers are availability errors only. Integrity failures after a response is
 * received (cost, routing, policy) never switch routes: they fail closed on the spot so a
 * second route can never hide them. Required-tool requests never fail over in Phase 1.
 * When the failover flag is unset, this module is a transparent pass-through to the
 * existing executors and behavior is identical to before.
 */

export const ORIGIN_FAILOVER_TRIGGER_CODES: ReadonlySet<OriginProviderErrorCode> = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NOT_CONFIGURED",
]);

export interface OriginProviderFailoverOptions {
  nowMs?: number;
  cloudflareCatalog?: readonly OriginCloudflareFreeModelEvidence[];
  primaryExecute?: typeof executeOriginProvider;
  cloudflareExecute?: typeof executeOriginCloudflareProvider;
  streamExecute?: typeof executeOriginProviderStream;
}

function primaryAttemptEvidence(
  request: OriginProviderExecutionRequest,
  outcome: OriginProviderAttemptEvidence["outcome"],
  error?: OriginProviderError,
): OriginProviderAttemptEvidence {
  return {
    providerId: ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
    modelId: request.plan.modelId,
    outcome,
    ...(error ? { errorCode: error.code } : {}),
    transportRequestCount: error ? error.diagnostic?.transportRequestCount : undefined,
  };
}

function cloudflareAttemptEvidence(
  outcome: OriginProviderAttemptEvidence["outcome"],
  extras: Partial<OriginProviderAttemptEvidence> = {},
): OriginProviderAttemptEvidence {
  return {
    providerId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
    modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
    outcome,
    ...extras,
  };
}

function withFailoverAttempts(error: OriginProviderError, attempts: readonly OriginProviderAttemptEvidence[]): OriginProviderError {
  return new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, {
    ...error.diagnostic,
    failoverAttempts: attempts,
  });
}

async function runCloudflareRoute(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<OriginProviderExecutionResult> {
  const planResult = buildOriginCloudflareRoutePlan(request.plan, {
    cloudflareFreeModelCatalog: options.cloudflareCatalog,
    nowMs: options.nowMs,
  });
  if (planResult.ok === false) {
    throw new OriginCloudflarePreflightError(
      planResult.code === "FREE_MODEL_CATALOG_INVALID" ? "catalog-invalid" : "evidence-stale",
    );
  }
  const execute = options.cloudflareExecute ?? executeOriginCloudflareProvider;
  return execute(
    { plan: planResult.plan, messages: request.messages, systemInstruction: request.systemInstruction },
    env,
    fetchImpl,
    { catalog: options.cloudflareCatalog, nowMs: options.nowMs },
  );
}

function composeFailoverResult(
  cloudflareResult: OriginProviderExecutionResult,
  primaryAttempt: OriginProviderAttemptEvidence,
): OriginProviderExecutionResult {
  const cloudflareAttempt = cloudflareAttemptEvidence("succeeded", {
    transportRequestCount: cloudflareResult.transportRequestCount,
  });
  return {
    ...cloudflareResult,
    transportRequestCount: (primaryAttempt.transportRequestCount ?? 0) + (cloudflareResult.transportRequestCount ?? 0),
    attempts: [primaryAttempt, cloudflareAttempt],
  };
}

/**
 * Handles a primary availability failure. Returns the Cloudflare result on success;
 * otherwise throws the honest error: the primary error when the secondary route was
 * skipped before execution, or the secondary route's own error when it executed and
 * failed. Attempt history is attached to the thrown error's diagnostic either way.
 */
async function failOverFromPrimaryError(
  request: OriginProviderExecutionRequest,
  primaryError: OriginProviderError,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<OriginProviderExecutionResult> {
  const primaryAttempt = primaryAttemptEvidence(request, "availability-error", primaryError);
  try {
    const cloudflareResult = await runCloudflareRoute(request, env, fetchImpl, options);
    return composeFailoverResult(cloudflareResult, primaryAttempt);
  } catch (error) {
    if (error instanceof OriginCloudflarePreflightError) {
      const skipped = cloudflareAttemptEvidence("skipped", {
        skipReason: error.reason === "plan-proof-failed" && error.proofReason
          ? `plan-proof-failed:${error.proofReason}`
          : error.reason,
        transportRequestCount: 0,
      });
      throw withFailoverAttempts(primaryError, [primaryAttempt, skipped]);
    }
    if (error instanceof OriginProviderError) {
      const failed = cloudflareAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, transportRequestCount: error.diagnostic?.transportRequestCount },
      );
      throw withFailoverAttempts(error, [primaryAttempt, failed]);
    }
    throw error;
  }
}

export async function executeOriginProviderWithFailover(
  providerRequest: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  options: OriginProviderFailoverOptions = {},
): Promise<OriginProviderExecutionResult> {
  const primary = options.primaryExecute ?? executeOriginProvider;
  if (providerRequest.requiredTool || !isOriginCloudflareFailoverEnabled(env)) {
    return primary(providerRequest, env, fetchImpl);
  }
  let primaryResult: OriginProviderExecutionResult;
  try {
    primaryResult = await primary(providerRequest, env, fetchImpl);
  } catch (error) {
    if (error instanceof OriginProviderError && ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
      return failOverFromPrimaryError(providerRequest, error, env, fetchImpl, options);
    }
    throw error;
  }
  return {
    ...primaryResult,
    attempts: [{
      ...primaryAttemptEvidence(providerRequest, "succeeded"),
      transportRequestCount: primaryResult.transportRequestCount,
    }],
  };
}

/**
 * Streaming variant. The primary stream executor releases text only after its terminal
 * billing/routing verification, so failover here still happens strictly before the first
 * downstream byte: if the primary stream fails with an availability error and nothing was
 * delivered, the Cloudflare route runs non-streaming and its verified full text is
 * delivered as a single delta. After any byte is delivered, no switch is attempted.
 */
export async function executeOriginProviderStreamWithFailover(
  providerRequest: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  options: OriginProviderFailoverOptions = {},
): Promise<OriginProviderExecutionResult> {
  const stream = options.streamExecute ?? executeOriginProviderStream;
  if (providerRequest.requiredTool || !isOriginCloudflareFailoverEnabled(env)) {
    return stream(providerRequest, handlers, env, fetchImpl);
  }
  let delivered = false;
  const trackingHandlers: OriginProviderStreamHandlers = {
    onDelta: (text: string) => {
      if (text) delivered = true;
      handlers.onDelta(text);
    },
  };
  let primaryResult: OriginProviderExecutionResult;
  try {
    primaryResult = await stream(providerRequest, trackingHandlers, env, fetchImpl);
  } catch (error) {
    if (!delivered && error instanceof OriginProviderError && ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
      const composed = await failOverFromPrimaryError(providerRequest, error, env, fetchImpl, options);
      handlers.onDelta(composed.text);
      return composed;
    }
    throw error;
  }
  return {
    ...primaryResult,
    attempts: [{
      ...primaryAttemptEvidence(providerRequest, "succeeded"),
      transportRequestCount: primaryResult.transportRequestCount,
    }],
  };
}

function assertZeroCostField(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OriginProviderError("PROVIDER_COST_UNVERIFIED", `${field} を検証できません。`, 502, false);
  }
  if (value !== 0 || !Object.is(value, 0)) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", `${field} が厳密な$0ポリシーを満たしません。`, 502, false);
  }
}

function routingFailure(message: string): never {
  throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", message, 502, false);
}

/**
 * Generalized zero-cost result verification. Results without an `attempts` record are
 * verified by the original single-route assertion, unchanged. Composite failover results
 * must prove that every executed attempt stayed on an approved free route, that the first
 * route stopped only for an availability reason, that the serving route passed its own
 * route-specific verification, and that the transport count equals the sum of attempts.
 */
export function assertOriginZeroCostExecutionResultWithFailover(
  result: OriginProviderExecutionResult,
  expectedPrimaryModel?: string,
): void {
  if (!result || typeof result !== "object" || !result.attempts) {
    assertOriginZeroCostExecutionResult(result, expectedPrimaryModel);
    return;
  }
  const attempts = result.attempts;
  assertZeroCostField(result.actualCostUsd, "actualCostUsd");
  assertZeroCostField(result.usage?.costUsd, "usage.costUsd");
  if (!Array.isArray(attempts) || attempts.length < 1 || attempts.length > 2) {
    routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
  }
  let transportTotal = 0;
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== "object"
      || !Number.isSafeInteger(attempt.transportRequestCount)
      || Number(attempt.transportRequestCount) < 0) {
      throw new OriginProviderError("PROVIDER_TRANSPORT_UNVERIFIED", "実際のProvider HTTP送信回数を確認できません。", 502, false);
    }
    transportTotal += Number(attempt.transportRequestCount);
  }
  if (!Number.isSafeInteger(result.transportRequestCount) || result.transportRequestCount !== transportTotal) {
    throw new OriginProviderError("PROVIDER_TRANSPORT_UNVERIFIED", "実際のProvider HTTP送信回数を確認できません。", 502, false);
  }
  if (attempts.length === 1) {
    const only = attempts[0];
    if (only.providerId !== ORIGIN_OPENROUTER_FREE_PROVIDER_ID || only.outcome !== "succeeded") {
      routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
    }
    assertOriginZeroCostExecutionResult(result, expectedPrimaryModel);
    return;
  }
  const [first, second] = attempts;
  if (first.providerId !== ORIGIN_OPENROUTER_FREE_PROVIDER_ID
    || first.outcome !== "availability-error"
    || !first.errorCode
    || !ORIGIN_FAILOVER_TRIGGER_CODES.has(first.errorCode)
    || (expectedPrimaryModel !== undefined && first.modelId !== expectedPrimaryModel)) {
    routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
  }
  if (second.providerId !== ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID
    || second.outcome !== "succeeded"
    || second.modelId !== ORIGIN_CLOUDFLARE_FREE_MODEL) {
    routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
  }
  assertOriginCloudflareExecutionResult(result);
}
