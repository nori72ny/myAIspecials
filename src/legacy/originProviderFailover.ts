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
 *
 * Attempt time budgets (2026-11-07, from the production inspection of the same day:
 * 10-pattern chat check completed 6/10, with 4 requests timing out at ~21-22s). The
 * pre-existing timeout stack could starve the second route in two ways: the primary
 * client retries a hanging request for up to ~56s internally (3 attempts x 18s plus
 * delays, per provider-policy stage) before the dispatcher ever sees the failure, and
 * the Cloudflare inference inherited the plan's 20s default timeout, which clips
 * longer generations. The dispatcher therefore enforces its own budget on the primary
 * attempt: after ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS the attempt's fetches are aborted
 * and the dispatcher proceeds to the second route regardless of the primary's internal
 * retry state. The Cloudflare route plan is given the Cloudflare client's own maximum
 * request timeout (52s) instead of the plan default, so its inference is no longer
 * clipped at 20s. Composed worst case stays inside the Vercel function limit of 120s:
 * 8s primary budget + up to 30s of plan-proof reads (3 x 10s, unchanged) + 52s
 * inference = 90s.
 *
 * Circuit breaker (best effort, in-process memory only): when the primary fails with
 * PROVIDER_RATE_LIMITED or a timeout (its own, or the dispatcher budget above), the
 * breaker opens for ORIGIN_PRIMARY_CIRCUIT_COOLDOWN_MS and later requests skip the
 * primary entirely, going straight to the Cloudflare route. After the cooldown the
 * next request trials the primary once (half-open): success closes the breaker, a
 * repeated rate-limit/timeout failure re-opens it. Serverless instances do not share
 * this state and may lose it at any time; that is safe because correctness never
 * depends on the breaker — with no state, the per-attempt budget alone still bounds
 * every primary attempt. A request that skips the primary records the attempt as
 * outcome "skipped" with skipReason "primary-circuit-open", the error code that
 * opened the breaker, and a transport count of 0 (nothing was sent).
 */

export const ORIGIN_FAILOVER_TRIGGER_CODES: ReadonlySet<OriginProviderErrorCode> = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NOT_CONFIGURED",
]);

/** Dispatcher-enforced budget for one primary attempt, including its internal retries. */
export const ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS = 8_000;
/** How long the primary is skipped after a rate-limit or timeout failure. */
export const ORIGIN_PRIMARY_CIRCUIT_COOLDOWN_MS = 300_000;
/** Timeout given to the Cloudflare route plan; the Cloudflare client caps inference at its own 52s maximum. */
export const ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS = 52_000;
/** skipReason recorded on the primary attempt evidence while the circuit breaker is open. */
export const ORIGIN_PRIMARY_CIRCUIT_SKIP_REASON = "primary-circuit-open";

export interface OriginProviderFailoverOptions {
  nowMs?: number;
  cloudflareCatalog?: readonly OriginCloudflareFreeModelEvidence[];
  primaryExecute?: typeof executeOriginProvider;
  cloudflareExecute?: typeof executeOriginCloudflareProvider;
  streamExecute?: typeof executeOriginProviderStream;
  /** Overrides ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS (tests and tuning). */
  primaryAttemptBudgetMs?: number;
  /** Overrides ORIGIN_PRIMARY_CIRCUIT_COOLDOWN_MS (tests and tuning). */
  primaryCircuitCooldownMs?: number;
}

interface OriginPrimaryCircuitState {
  openUntilMs: number;
  errorCode: OriginProviderErrorCode;
}

/**
 * In-process circuit breaker for the primary route. Module-level on purpose: it is a
 * best-effort latency optimization only, never a correctness or policy mechanism, so
 * losing it (cold start, scale-out, instance recycling) simply reverts to trying the
 * primary first under the per-attempt budget.
 */
let primaryCircuit: OriginPrimaryCircuitState | null = null;

export function resetOriginProviderFailoverCircuitForTests(): void {
  primaryCircuit = null;
}

function dispatcherNowMs(options: OriginProviderFailoverOptions): number {
  return options.nowMs ?? Date.now();
}

function openPrimaryCircuit(options: OriginProviderFailoverOptions, errorCode: OriginProviderErrorCode): void {
  const cooldownMs = options.primaryCircuitCooldownMs ?? ORIGIN_PRIMARY_CIRCUIT_COOLDOWN_MS;
  primaryCircuit = { openUntilMs: dispatcherNowMs(options) + cooldownMs, errorCode };
}

function primaryCircuitOpen(options: OriginProviderFailoverOptions): OriginPrimaryCircuitState | null {
  if (!primaryCircuit) return null;
  return dispatcherNowMs(options) < primaryCircuit.openUntilMs ? primaryCircuit : null;
}

function closePrimaryCircuit(): void {
  primaryCircuit = null;
}

/** Only sustained availability failures open the breaker: rate limits and timeouts. */
function circuitOpeningCode(error: OriginProviderError): OriginProviderErrorCode | null {
  return error.code === "PROVIDER_RATE_LIMITED" || error.code === "PROVIDER_TIMEOUT" ? error.code : null;
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

/**
 * Wraps the fetch handed to a primary executor so the dispatcher can cut the attempt
 * off: every call is counted (the count feeds the attempt's transport evidence) and
 * carries the attempt's abort signal merged with any signal the executor set itself.
 * Once the attempt is aborted, further calls reject immediately without touching the
 * network or the count, so an abandoned executor's internal retries cannot send more
 * requests or distort the recorded evidence.
 */
function createAttemptBoundedFetch(
  fetchImpl: OriginFetch,
  attemptController: AbortController,
  transport: { count: number },
): OriginFetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (attemptController.signal.aborted) {
      return Promise.reject(attemptController.signal.reason ?? new Error("AbortError"));
    }
    transport.count += 1;
    const signal = init?.signal
      ? mergeAbortSignals(init.signal, attemptController.signal)
      : attemptController.signal;
    return fetchImpl(input, { ...init, signal });
  };
}

type PrimaryAttemptOutcome =
  | { kind: "result"; result: OriginProviderExecutionResult }
  | { kind: "error"; error: unknown }
  | { kind: "budget-timeout"; transportRequestCount: number };

/**
 * Runs one primary executor call under the dispatcher attempt budget. The executor is
 * raced against the budget; on a budget win the attempt's fetches are aborted and the
 * outcome is "budget-timeout" even if the executor's own retry loop would have kept
 * going. The abandoned promise's late settlement is always handled, never unhandled.
 */
async function runPrimaryAttempt(
  execute: (
    request: OriginProviderExecutionRequest,
    env: NodeJS.ProcessEnv,
    fetchImpl: OriginFetch,
  ) => Promise<OriginProviderExecutionResult>,
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<PrimaryAttemptOutcome> {
  const attemptController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, attemptController, transport);
  const primaryPromise = execute(request, env, boundedFetch);
  primaryPromise.catch(() => undefined);
  const settled: Promise<PrimaryAttemptOutcome> = primaryPromise.then(
    (result): PrimaryAttemptOutcome => ({ kind: "result", result }),
    (error): PrimaryAttemptOutcome => ({ kind: "error", error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"budget">((resolve) => {
    timer = setTimeout(() => resolve("budget"), options.primaryAttemptBudgetMs ?? ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS);
  });
  const winner = await Promise.race([settled, budget]);
  if (winner === "budget") {
    attemptController.abort();
    return { kind: "budget-timeout", transportRequestCount: transport.count };
  }
  if (timer) clearTimeout(timer);
  return winner;
}

function primaryBudgetTimeoutError(transportRequestCount: number): OriginProviderError {
  return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, {
    transportFailure: "timeout",
    transportRequestCount,
  });
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
  // The Cloudflare route keeps the primary plan's semantics but not its timeout: the
  // plan default (20s) clipped this route's inference in production, so the route plan
  // is raised to the Cloudflare client's own maximum request timeout. The primary
  // plan itself is never modified.
  const planResult = buildOriginCloudflareRoutePlan(
    { ...request.plan, timeoutMs: Math.max(request.plan.timeoutMs, ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS) },
    {
      cloudflareFreeModelCatalog: options.cloudflareCatalog,
      nowMs: options.nowMs,
    },
  );
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

/**
 * Circuit-breaker path: the primary is inside its cooldown after a recent rate-limit
 * or timeout failure, so it is not attempted at all and the Cloudflare route runs
 * directly. The primary attempt is recorded as skipped (skipReason
 * "primary-circuit-open", the error code that opened the breaker, zero transport
 * requests). Error surfacing mirrors failOverFromPrimaryError, except that when the
 * Cloudflare route is skipped before execution the honest error is a synthesized
 * primary unavailability carrying the code that opened the breaker (with the
 * remaining cooldown as Retry-After for a rate limit), since no primary attempt ran
 * in this request.
 */
async function failOverFromOpenCircuit(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  circuit: OriginPrimaryCircuitState,
): Promise<OriginProviderExecutionResult> {
  const primaryAttempt: OriginProviderAttemptEvidence = {
    providerId: ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
    modelId: request.plan.modelId,
    outcome: "skipped",
    skipReason: ORIGIN_PRIMARY_CIRCUIT_SKIP_REASON,
    errorCode: circuit.errorCode,
    transportRequestCount: 0,
  };
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
      const remainingCooldownSeconds = Math.max(1, Math.ceil((circuit.openUntilMs - dispatcherNowMs(options)) / 1000));
      const primaryError = circuit.errorCode === "PROVIDER_RATE_LIMITED"
        ? new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, remainingCooldownSeconds, { transportRequestCount: 0 })
        : new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, { transportFailure: "timeout", transportRequestCount: 0 });
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
  const circuit = primaryCircuitOpen(options);
  if (circuit) {
    return failOverFromOpenCircuit(providerRequest, env, fetchImpl, options, circuit);
  }
  const outcome = await runPrimaryAttempt(primary, providerRequest, env, fetchImpl, options);
  if (outcome.kind === "budget-timeout") {
    openPrimaryCircuit(options, "PROVIDER_TIMEOUT");
    return failOverFromPrimaryError(providerRequest, primaryBudgetTimeoutError(outcome.transportRequestCount), env, fetchImpl, options);
  }
  if (outcome.kind === "error") {
    const error = outcome.error;
    if (error instanceof OriginProviderError && ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
      const openingCode = circuitOpeningCode(error);
      if (openingCode) openPrimaryCircuit(options, openingCode);
      return failOverFromPrimaryError(providerRequest, error, env, fetchImpl, options);
    }
    throw error;
  }
  closePrimaryCircuit();
  const primaryResult = outcome.result;
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
  const circuit = primaryCircuitOpen(options);
  if (circuit) {
    const composed = await failOverFromOpenCircuit(providerRequest, env, fetchImpl, options, circuit);
    handlers.onDelta(composed.text);
    return composed;
  }
  let delivered = false;
  let abandoned = false;
  const trackingHandlers: OriginProviderStreamHandlers = {
    onDelta: (text: string) => {
      if (abandoned) return;
      if (text) delivered = true;
      handlers.onDelta(text);
    },
  };
  // The attempt budget gates only the pre-first-byte phase: once text has been
  // delivered, abandoning the primary would corrupt the stream, so a budget win
  // after delivery simply keeps waiting for the primary under its own internal
  // caps. A budget win before any byte aborts the attempt's fetches, detaches its
  // handlers (a late delta from the abandoned stream is dropped), and fails over.
  const attemptController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, attemptController, transport);
  const primaryPromise = stream(providerRequest, trackingHandlers, env, boundedFetch);
  primaryPromise.catch(() => undefined);
  const settled: Promise<
    | { kind: "result"; result: OriginProviderExecutionResult }
    | { kind: "error"; error: unknown }
  > = primaryPromise.then(
    (result) => ({ kind: "result" as const, result }),
    (error) => ({ kind: "error" as const, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"budget">((resolve) => {
    timer = setTimeout(() => resolve("budget"), options.primaryAttemptBudgetMs ?? ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS);
  });
  const winner = await Promise.race([settled, budget]);
  if (winner === "budget" && !delivered) {
    abandoned = true;
    attemptController.abort();
    openPrimaryCircuit(options, "PROVIDER_TIMEOUT");
    const composed = await failOverFromPrimaryError(
      providerRequest,
      primaryBudgetTimeoutError(transport.count),
      env,
      fetchImpl,
      options,
    );
    handlers.onDelta(composed.text);
    return composed;
  }
  if (timer) clearTimeout(timer);
  const outcome = winner === "budget" ? await settled : winner;
  if (outcome.kind === "error") {
    const error = outcome.error;
    if (!delivered && error instanceof OriginProviderError && ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
      const openingCode = circuitOpeningCode(error);
      if (openingCode) openPrimaryCircuit(options, openingCode);
      const composed = await failOverFromPrimaryError(providerRequest, error, env, fetchImpl, options);
      handlers.onDelta(composed.text);
      return composed;
    }
    throw error;
  }
  closePrimaryCircuit();
  const primaryResult = outcome.result;
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
  // The first attempt is either a real availability failure, or a circuit-breaker
  // skip: the primary was not attempted at all because a recent rate-limit/timeout
  // failure opened the breaker. A skip is accepted only with the exact breaker skip
  // reason, one of the two circuit-opening error codes, and zero transport requests
  // (proof nothing was sent); every other skipped or ambiguous shape stays
  // unverified, exactly as before.
  const firstIsAvailabilityFailure = first.outcome === "availability-error"
    && Boolean(first.errorCode)
    && ORIGIN_FAILOVER_TRIGGER_CODES.has(first.errorCode as OriginProviderErrorCode);
  const firstIsCircuitSkip = first.outcome === "skipped"
    && first.skipReason === ORIGIN_PRIMARY_CIRCUIT_SKIP_REASON
    && (first.errorCode === "PROVIDER_RATE_LIMITED" || first.errorCode === "PROVIDER_TIMEOUT")
    && first.transportRequestCount === 0;
  if (first.providerId !== ORIGIN_OPENROUTER_FREE_PROVIDER_ID
    || (!firstIsAvailabilityFailure && !firstIsCircuitSkip)
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
