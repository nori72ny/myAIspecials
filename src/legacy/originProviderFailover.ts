import {
  buildOriginCloudflareRoutePlan,
  buildOriginGroqRoutePlan,
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
  ORIGIN_GROQ_FREE_PROVIDER_ID,
  ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  ORIGIN_CLOUDFLARE_FREE_MODEL,
  type OriginCloudflareFreeModelEvidence,
} from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import {
  isOriginGroqFreeModelId,
  ORIGIN_GROQ_FREE_MODEL_ID,
  type OriginGroqFreeModelEvidence,
  type OriginGroqFreeModelId,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
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
  executeOriginCloudflareProviderStream,
  isOriginCloudflareFailoverEnabled,
  OriginCloudflarePreflightError,
  type OriginCloudflareStreamExecutor,
} from "./originCloudflareProviderClient.js";
import {
  assertOriginGroqExecutionResult,
  executeOriginGroqProvider,
  executeOriginGroqProviderStream,
  isOriginGroqRouteConfigured,
  OriginGroqPreflightError,
  type OriginGroqStreamExecutor,
} from "./originGroqProviderClient.js";
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
 * clipped at 20s.
 *
 * Total time budget (2026-11-07 speed audit: general chat median 14.5s, grounded
 * chat 27.9-106.7s against the 120s Vercel limit). The per-layer caps above composed
 * additively — 8s primary + up to 30s of plan-proof reads (3 x 10s, unchanged) + 52s
 * inference = 90s, plus up to ~8s of grounding in the router — so the sum of layer
 * limits, not any single decision, decided how long a chat request could take. The
 * dispatcher now owns one authoritative total budget for the whole dispatch,
 * ORIGIN_CHAT_TOTAL_BUDGET_MS: the primary attempt budget runs inside it, and the
 * Cloudflare route (plan proof + inference) is raced against the time remaining when
 * it starts and aborted when the total expires. Worst-case dispatch is therefore the
 * total budget itself (45s), and even a grounded chat request (grounding ~8s +
 * dispatch 45s) stays far inside the 120s function limit. Composition at the total:
 * a fast primary failure (~1s) leaves the proof (~1s typical, 10s worst for a single
 * read) and inference the remaining ~34-44s, well above observed generation times;
 * a hanging primary consumes its 8s first, still leaving ~27s+ for the second route.
 * The one deliberate exception is the streaming variant after the first delivered
 * byte: abandoning a stream mid-text would corrupt it, so an in-progress stream is
 * allowed to finish under the primary client's own caps exactly as before; the total
 * budget governs route selection and everything before delivery.
 *
 * Cloudflare error-code branching (2026-11-08 rethink, item 2; state lives in the
 * Cloudflare client): when the second route's inference fails with the raw code
 * 3036 or 4006, the account's daily Neuron pool is exhausted, so the client stops
 * the route for the rest of the UTC day and later dispatches record it as skipped
 * (skipReason "pool-exhausted") and fall through to the third route without paying
 * the plan-proof reads or a doomed inference. Code 3040 is temporary capacity
 * instead: the route only backs off briefly (skipReason "capacity-cooldown") and
 * is never mistaken for a day-long stop.
 *
 * Third-route reserve (PKG-4 PR-1, 2026-11-13): the second route previously raced
 * against ALL of the remaining total budget, so a slow Cloudflare inference could
 * consume the whole window and the third route (Groq) started with nothing left —
 * it recorded an immediate timeout without ever sending. While the Groq route is
 * configured, the second route's race is now capped at the remaining time minus
 * ORIGIN_GROQ_ROUTE_RESERVE_MS, so the third route always starts with at least the
 * reserve left. When Groq is not configured there is no third route to protect and
 * the second route keeps the full remainder, exactly as before. The reserve only
 * caps the second route's wait; it never extends the total budget, and a second
 * route that finishes inside its slice is unaffected.
 *
 * Attempt durations (PKG-4 PR-1): every executed attempt now records durationMs
 * (real elapsed time of that route's bounded execution) on its attempt evidence,
 * so the failure diagnostic and the success routing record show how much of the
 * budget each route actually consumed and whether the third route really sent.
 * Skipped attempts (nothing was executed) carry no duration.
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
 *
 * Second-route attempt cap (speed wave 1, 2026-11-16): the production measurement
 * of the same day showed ordinary/planning answers taking 32-37s, dominated by the
 * second route's slow failures being waited out serially — one planning request
 * waited 34.9s for the Cloudflare route to time out before the third route answered
 * in 1.4s — while a successful second-route attempt took 16.6s. While the third
 * route is configured, the second route's slice is therefore additionally capped
 * at ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS (25s, ~1.5x the observed healthy success),
 * on top of the third-route reserve: a slow second-route failure now costs at most
 * the cap, and the third route still starts with at least its reserve. Without a
 * configured third route the second route is the last route and keeps the full
 * remainder, exactly as before (mirroring the reserve's conditionality).
 *
 * Second-route circuit breaker (speed wave 1, 2026-11-16): the Cloudflare client
 * already stops the route on its own for a day on pool exhaustion and for 60s on
 * a temporary-capacity code, but a hanging route has no such state — every request
 * paid the full slice again. The dispatcher now counts consecutive executed
 * second-route attempts that fail with a timeout, a rate limit, or an
 * unavailability error AND actually sent at least one request (a bounded-race
 * expiry that sent nothing says nothing about the route's health and never
 * counts). At ORIGIN_CLOUDFLARE_CIRCUIT_FAILURE_THRESHOLD consecutive counted
 * failures the breaker opens for ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS: while the
 * third route is configured, later requests skip the second route entirely
 * (attempt recorded as outcome "skipped", skipReason "cloudflare-circuit-open",
 * the opening error code, transport count 0) and go straight to the third route.
 * After the cooldown the next request trials the second route once (half-open):
 * success closes the breaker and resets the count; a counted failure re-opens it
 * at once. A success at any time resets the consecutive count, and outcomes that
 * are not counted failures (pre-execution skips, integrity failures) leave the
 * count untouched. Without a configured third route the breaker never skips: the
 * second route is the last chance and always runs. Like the primary breaker this
 * is best-effort in-process state only — losing it reverts to attempting the
 * route under its slice. Breaker open/close transitions are logged with numbers
 * and fixed codes only.
 *
 * Groq-first order for direct chat (S-1, 2026-11-17; audit
 * CAPACITY_SPEED_AUDIT_2026-11-17 §5): the production measurement showed the
 * order above costs 24-28s on ordinary/planning answers because the slow
 * second route is always tried before the fast third route (0.7-2.0s). While
 * ORIGIN_GROQ_FIRST_ENABLED is exactly "true", a DIRECT CHAT dispatch runs the
 * failover routes in the opposite order after a primary availability failure:
 * Groq first, under ORIGIN_GROQ_ATTEMPT_BUDGET_MS, then Cloudflare as the
 * final route with its usual attempt cap and circuit-breaker recording but no
 * third-route reserve (there is no later route to protect). As the last route
 * it is never skipped by its breaker — the same rule the current order
 * applies when no third route is configured — so a Groq outage cannot turn
 * into a hard failure of every request while the breaker happens to be open. The switch defaults to OFF:
 * unset or any other value reproduces the order above exactly, and flipping it
 * back is the whole rollback. Only direct chat is reordered. A dispatch is a
 * direct chat dispatch when the request carries the route-3 substitute
 * instruction the two chat routers (blocking and streaming) attach
 * (`groqSystemInstruction`); the grounded-research synthesis, the records
 * paths, and the research router never set it — the same documented convention
 * the field itself carries — so their dispatches keep the order above even
 * while the switch is on. Required-tool requests never reach either order
 * (pass-through, unchanged). Integrity failures still never switch routes in
 * either order. The zero-cost result assertion is order-independent: the
 * serving route is the last attempt, every earlier failover attempt shows its
 * route did not serve (an availability failure, or a pre-execution skip with
 * zero transport requests), and each route's own $0/free-route verification
 * runs unchanged on the serving result.
 */

export const ORIGIN_FAILOVER_TRIGGER_CODES: ReadonlySet<OriginProviderErrorCode> = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NOT_CONFIGURED",
]);

/** Dispatcher-enforced budget for one primary attempt, including its internal retries. */
export const ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS = 8_000;
/**
 * The one authoritative total budget for a whole failover dispatch: primary attempt,
 * second-route plan proof, and second-route inference together never wait longer
 * than this. Enforced by the dispatcher with real elapsed time (the injectable
 * nowMs clock exists for evidence freshness, not for timers).
 */
export const ORIGIN_CHAT_TOTAL_BUDGET_MS = 45_000;
/** How long the primary is skipped after a rate-limit or timeout failure. */
export const ORIGIN_PRIMARY_CIRCUIT_COOLDOWN_MS = 300_000;
/** Timeout given to the Cloudflare route plan; the Cloudflare client caps inference at its own 52s maximum. */
export const ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS = 52_000;
/**
 * Time kept free at the end of the total budget for the third (Groq) route while
 * that route is configured (PKG-4 PR-1). The second route's bounded race is capped
 * at the remaining budget minus this reserve, so the third route is guaranteed at
 * least this much time to actually attempt its request.
 */
export const ORIGIN_GROQ_ROUTE_RESERVE_MS = 10_000;
/** skipReason recorded on the primary attempt evidence while the circuit breaker is open. */
export const ORIGIN_PRIMARY_CIRCUIT_SKIP_REASON = "primary-circuit-open";
/**
 * Cap on the second route's slice of the total budget while the third route is
 * configured (speed wave 1): ~1.5x the 16.6s healthy success measured in
 * production on 2026-11-16, so a healthy success is not clipped while a hanging
 * attempt stops costing the previous ~35s (remaining minus reserve).
 */
export const ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS = 25_000;
/** Consecutive counted availability failures of the second route that open its circuit breaker. */
export const ORIGIN_CLOUDFLARE_CIRCUIT_FAILURE_THRESHOLD = 2;
/** How long the second route is skipped after its circuit breaker opens. */
export const ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS = 180_000;
/** skipReason recorded on the Cloudflare attempt evidence while its circuit breaker is open. */
export const ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON = "cloudflare-circuit-open";
/** Environment switch for the Groq-first direct-chat order (S-1). Only the exact value "true" enables it. */
export const ORIGIN_GROQ_FIRST_ENV = "ORIGIN_GROQ_FIRST_ENABLED" as const;

/** True only for the exact value "true"; unset or any other value keeps the current route order. */
export function isOriginGroqFirstEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_GROQ_FIRST_ENV] === "true";
}

/**
 * Budget for one Groq attempt while the Groq route runs FIRST (Groq-first
 * mode, S-1): ~4x the 0.7-2.0s healthy success measured in production on
 * 2026-11-16, and the same value as the primary attempt budget. A Groq attempt
 * that exceeds it (or fails with an availability error) moves on to the
 * Cloudflare route; the total budget is unchanged. While Groq runs last (the
 * current order) this cap does not apply: the route keeps the full remainder,
 * exactly as before.
 */
export const ORIGIN_GROQ_ATTEMPT_BUDGET_MS = 8_000;

export interface OriginProviderFailoverOptions {
  nowMs?: number;
  cloudflareCatalog?: readonly OriginCloudflareFreeModelEvidence[];
  groqCatalog?: readonly OriginGroqFreeModelEvidence[];
  primaryExecute?: typeof executeOriginProvider;
  cloudflareExecute?: typeof executeOriginCloudflareProvider;
  groqExecute?: typeof executeOriginGroqProvider;
  streamExecute?: typeof executeOriginProviderStream;
  /**
   * Streaming executors for the failover routes, used only by the streaming
   * entry. When unset, an injected blocking executor is adapted (its verified
   * full text is released once at completion, the pre-streaming behavior) and
   * otherwise the route's real streaming executor runs.
   */
  cloudflareStreamExecute?: OriginCloudflareStreamExecutor;
  groqStreamExecute?: OriginGroqStreamExecutor;
  /** Overrides ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS (tests and tuning). */
  primaryAttemptBudgetMs?: number;
  /** Overrides ORIGIN_PRIMARY_CIRCUIT_COOLDOWN_MS (tests and tuning). */
  primaryCircuitCooldownMs?: number;
  /** Overrides ORIGIN_CHAT_TOTAL_BUDGET_MS (tests and tuning). */
  totalBudgetMs?: number;
  /** Overrides ORIGIN_GROQ_ROUTE_RESERVE_MS (tests and tuning). */
  groqReserveMs?: number;
  /** Overrides ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS (tests and tuning). */
  cloudflareAttemptBudgetMs?: number;
  /** Overrides ORIGIN_GROQ_ATTEMPT_BUDGET_MS (tests and tuning). */
  groqAttemptBudgetMs?: number;
  /** Overrides ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS (tests and tuning). */
  cloudflareCircuitCooldownMs?: number;
  /** Overrides ORIGIN_CLOUDFLARE_CIRCUIT_FAILURE_THRESHOLD (tests and tuning). */
  cloudflareCircuitFailureThreshold?: number;
  /**
   * Internal: the total-budget window opened by the public entry points and shared
   * with every internal helper, so the primary phase and the second route draw from
   * the same budget. Callers outside this module must not set it.
   */
  totalBudgetWindow?: OriginChatTotalBudgetWindow;
}

/** A running total-budget window, measured in real elapsed time. */
export interface OriginChatTotalBudgetWindow {
  startedAtMs: number;
  totalBudgetMs: number;
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
  cloudflareCircuit = null;
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

interface OriginCloudflareCircuitState {
  consecutiveFailures: number;
  /** Epoch ms until which the route is skipped; 0 while the breaker is closed (failures only counted). */
  openUntilMs: number;
  errorCode: OriginProviderErrorCode;
}

/**
 * In-process circuit breaker for the second (Cloudflare) route, mirroring the
 * primary breaker above: a best-effort latency optimization only, never a
 * correctness or policy mechanism, so losing it (cold start, scale-out,
 * instance recycling) simply reverts to attempting the route under its slice.
 */
let cloudflareCircuit: OriginCloudflareCircuitState | null = null;

function cloudflareCircuitOpen(options: OriginProviderFailoverOptions): OriginCloudflareCircuitState | null {
  if (!cloudflareCircuit || cloudflareCircuit.openUntilMs <= 0) return null;
  return dispatcherNowMs(options) < cloudflareCircuit.openUntilMs ? cloudflareCircuit : null;
}

/**
 * The second-route failures that count toward its breaker: timeouts, rate
 * limits (the client's classification of the capacity and pool-exhaustion
 * 429s), and unavailability (5xx / network). The attempt must actually have
 * sent at least one request: a bounded-race expiry that sent nothing (the
 * total budget was already spent before the route could run) is a budget
 * event, not route ill health, and never counts. Configuration and integrity
 * failures never count either.
 */
function cloudflareCircuitFailureCode(error: OriginProviderError): OriginProviderErrorCode | null {
  if (error.code !== "PROVIDER_TIMEOUT" && error.code !== "PROVIDER_RATE_LIMITED" && error.code !== "PROVIDER_UNAVAILABLE") {
    return null;
  }
  if ((error.diagnostic?.transportRequestCount ?? 0) <= 0) return null;
  return error.code;
}

function recordCloudflareRouteFailure(error: OriginProviderError, options: OriginProviderFailoverOptions): void {
  const errorCode = cloudflareCircuitFailureCode(error);
  if (!errorCode) return;
  const nowMs = dispatcherNowMs(options);
  const previous = cloudflareCircuit;
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  // A counted failure on the half-open trial (the cooldown had expired and this
  // request retried the route) re-opens the breaker at once, as does one that
  // somehow executed while already open (possible only when no third route is
  // configured and the breaker therefore never skips). Otherwise the breaker
  // opens when the consecutive-failure threshold is reached.
  const halfOpenTrial = previous !== null && previous.openUntilMs > 0 && nowMs >= previous.openUntilMs;
  const alreadyOpen = previous !== null && nowMs < previous.openUntilMs;
  const threshold = Math.max(1, options.cloudflareCircuitFailureThreshold ?? ORIGIN_CLOUDFLARE_CIRCUIT_FAILURE_THRESHOLD);
  if (halfOpenTrial || alreadyOpen || consecutiveFailures >= threshold) {
    const cooldownMs = options.cloudflareCircuitCooldownMs ?? ORIGIN_CLOUDFLARE_CIRCUIT_COOLDOWN_MS;
    cloudflareCircuit = { consecutiveFailures, openUntilMs: nowMs + cooldownMs, errorCode };
    console.warn("[origin-provider-failover] cloudflare circuit opened", { errorCode, consecutiveFailures, cooldownMs });
    return;
  }
  cloudflareCircuit = { consecutiveFailures, openUntilMs: 0, errorCode };
}

function recordCloudflareRouteSuccess(): void {
  if (!cloudflareCircuit) return;
  const wasOpen = cloudflareCircuit.openUntilMs > 0;
  const errorCode = cloudflareCircuit.errorCode;
  cloudflareCircuit = null;
  if (wasOpen) {
    console.info("[origin-provider-failover] cloudflare circuit closed", { errorCode });
  }
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

/** Milliseconds left in the dispatch's total budget; Infinity when no window is open. */
function totalBudgetRemainingMs(options: OriginProviderFailoverOptions): number {
  const window = options.totalBudgetWindow;
  if (!window) return Number.POSITIVE_INFINITY;
  return window.totalBudgetMs - (Date.now() - window.startedAtMs);
}

/**
 * The primary attempt's effective budget: its own cap, clamped to what the total
 * budget still has left, so the primary phase can never overrun the total either.
 */
function primaryBudgetMs(options: OriginProviderFailoverOptions): number {
  const attempt = options.primaryAttemptBudgetMs ?? ORIGIN_PRIMARY_ATTEMPT_BUDGET_MS;
  return Math.max(1, Math.min(attempt, totalBudgetRemainingMs(options)));
}

/** Opens the total-budget window for one dispatch, unless a caller already opened one. */
function withTotalBudgetWindow(options: OriginProviderFailoverOptions): OriginProviderFailoverOptions {
  if (options.totalBudgetWindow) return options;
  return {
    ...options,
    totalBudgetWindow: {
      startedAtMs: Date.now(),
      totalBudgetMs: options.totalBudgetMs ?? ORIGIN_CHAT_TOTAL_BUDGET_MS,
    },
  };
}

type PrimaryAttemptOutcome =
  | { kind: "result"; result: OriginProviderExecutionResult; durationMs: number }
  | { kind: "error"; error: unknown; durationMs: number }
  | { kind: "budget-timeout"; transportRequestCount: number; durationMs: number };

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
  const startedAtMs = Date.now();
  const attemptController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, attemptController, transport);
  const primaryPromise = execute(request, env, boundedFetch);
  primaryPromise.catch(() => undefined);
  const settled: Promise<PrimaryAttemptOutcome> = primaryPromise.then(
    (result): PrimaryAttemptOutcome => ({ kind: "result", result, durationMs: Date.now() - startedAtMs }),
    (error): PrimaryAttemptOutcome => ({ kind: "error", error, durationMs: Date.now() - startedAtMs }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"budget">((resolve) => {
    timer = setTimeout(() => resolve("budget"), primaryBudgetMs(options));
  });
  const winner = await Promise.race([settled, budget]);
  if (winner === "budget") {
    attemptController.abort();
    return { kind: "budget-timeout", transportRequestCount: transport.count, durationMs: Date.now() - startedAtMs };
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
  durationMs?: number,
): OriginProviderAttemptEvidence {
  return {
    providerId: ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
    modelId: request.plan.modelId,
    outcome,
    ...(error ? { errorCode: error.code, ...upstreamAttemptFields(error) } : {}),
    transportRequestCount: error ? error.diagnostic?.transportRequestCount : undefined,
    ...(durationMs !== undefined ? { durationMs } : {}),
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

function groqAttemptEvidence(
  outcome: OriginProviderAttemptEvidence["outcome"],
  extras: Partial<OriginProviderAttemptEvidence> = {},
): OriginProviderAttemptEvidence {
  return {
    providerId: ORIGIN_GROQ_FREE_PROVIDER_ID,
    modelId: ORIGIN_GROQ_FREE_MODEL_ID,
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

/**
 * Copies the failed route's upstream metadata (HTTP status and the provider's
 * raw error code/type, as captured by that route's client) onto its attempt
 * evidence, so the diagnostic of the error that is finally surfaced shows why
 * each route actually failed instead of only the classified code. The values
 * stay internal here; the chat routers pass attempts through the whitelisting
 * failure-diagnostic summary before anything reaches a response or a log line.
 */
function upstreamAttemptFields(error: OriginProviderError): Partial<OriginProviderAttemptEvidence> {
  const diagnostic = error.diagnostic;
  if (!diagnostic) return {};
  return {
    ...(diagnostic.upstreamStatus !== undefined ? { upstreamStatus: diagnostic.upstreamStatus } : {}),
    ...(diagnostic.upstreamErrorType !== undefined ? { upstreamErrorType: diagnostic.upstreamErrorType } : {}),
    ...(diagnostic.upstreamErrorCode !== undefined ? { upstreamErrorCode: diagnostic.upstreamErrorCode } : {}),
  };
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
    { plan: planResult.plan, messages: request.messages, systemInstruction: request.systemInstruction, cloudflareSystemInstruction: request.cloudflareSystemInstruction },
    env,
    fetchImpl,
    { catalog: options.cloudflareCatalog, nowMs: options.nowMs },
  );
}

function totalBudgetTimeoutError(transportRequestCount?: number): OriginProviderError {
  return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, {
    transportFailure: "timeout",
    // The bounded race knows how many requests the route actually sent before
    // the cut; recording it keeps the failed attempt's evidence (and the
    // zero-cost transport accounting when a later route serves) exact.
    ...(transportRequestCount !== undefined ? { transportRequestCount } : {}),
  });
}

/**
 * A dispatch is a direct chat dispatch when the request carries the route-3
 * substitute instruction. Only the two direct chat routers (blocking and
 * streaming) attach it; the grounded-research synthesis, the records paths,
 * and the research router never do — the convention the field's own
 * documentation in originProviderClient.ts already states. This is the
 * failover layer's only signal for the caller's answer mode, and it fails
 * safe: a request without the shaping keeps the current order.
 */
function isDirectChatDispatch(request: OriginProviderExecutionRequest): boolean {
  return typeof request.groqSystemInstruction === "string";
}

/**
 * Whether the Groq-first order (S-1) governs this dispatch: the owner switch
 * is on, the Groq route exists, and the dispatch is a direct chat dispatch.
 * Every other dispatch — switch off, no Groq route, or any non-direct caller —
 * follows the current order exactly.
 */
function groqFirstOrderApplies(request: OriginProviderExecutionRequest, env: NodeJS.ProcessEnv): boolean {
  return isOriginGroqFirstEnabled(env)
    && isOriginGroqRouteConfigured(env)
    && isDirectChatDispatch(request);
}

/**
 * The slice of the remaining budget the second route may consume. While the
 * third (Groq) route is configured, the reserve for that route is subtracted so
 * the third route always starts with at least the reserve left (PKG-4 PR-1);
 * earlier routes that finish sooner leave the third route more than the reserve.
 * Without a configured third route the second route keeps the full remainder.
 * Speed wave 1 additionally caps the slice at the second route's own attempt
 * budget while the third route is configured, so a hanging second route stops
 * costing the whole remainder-minus-reserve; the cap never extends the slice
 * beyond what the reserve leaves, and the total budget is unchanged.
 *
 * Groq-first mode (S-1): the second route is the FINAL route, so there is no
 * later route to reserve time for; its slice is its own attempt cap clamped to
 * the remaining total budget, with no reserve subtracted.
 */
function cloudflareSliceMs(request: OriginProviderExecutionRequest, options: OriginProviderFailoverOptions, env: NodeJS.ProcessEnv): number {
  const remainingMs = totalBudgetRemainingMs(options);
  if (groqFirstOrderApplies(request, env)) {
    const attemptBudgetMs = Math.max(1, options.cloudflareAttemptBudgetMs ?? ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS);
    return Math.min(remainingMs, attemptBudgetMs);
  }
  if (!isOriginGroqRouteConfigured(env)) return remainingMs;
  const reserveMs = Math.max(0, options.groqReserveMs ?? ORIGIN_GROQ_ROUTE_RESERVE_MS);
  const attemptBudgetMs = Math.max(1, options.cloudflareAttemptBudgetMs ?? ORIGIN_CLOUDFLARE_ATTEMPT_BUDGET_MS);
  return Math.min(remainingMs - reserveMs, attemptBudgetMs);
}

/**
 * The slice of the remaining budget the Groq route may consume. While the
 * route runs last (the current order) it keeps the full remainder, exactly as
 * before. In Groq-first mode (S-1) the attempt is additionally capped at
 * ORIGIN_GROQ_ATTEMPT_BUDGET_MS so a hanging fast route cannot eat the final
 * route's time; the cap never extends the slice beyond the remainder, and the
 * total budget is unchanged.
 */
function groqSliceMs(request: OriginProviderExecutionRequest, options: OriginProviderFailoverOptions, env: NodeJS.ProcessEnv): number {
  const remainingMs = totalBudgetRemainingMs(options);
  if (!groqFirstOrderApplies(request, env)) return remainingMs;
  const attemptBudgetMs = Math.max(1, options.groqAttemptBudgetMs ?? ORIGIN_GROQ_ATTEMPT_BUDGET_MS);
  return Math.min(remainingMs, attemptBudgetMs);
}

/**
 * Runs the Cloudflare route inside the dispatch's total budget: the route (plan
 * proof + inference) is raced against its slice of the time remaining in the
 * window (the full remainder, minus the third route's reserve while that route
 * is configured) and its fetches are aborted when the slice expires, so the
 * second route can never wait past the one authoritative deadline either.
 * Expiry surfaces as a PROVIDER_TIMEOUT availability error from the second
 * route, which the callers record in the attempt evidence. The abandoned
 * promise's late settlement is always handled. Without a window (direct
 * internal use only) the route runs exactly as before.
 */
async function runCloudflareRouteBounded(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<OriginProviderExecutionResult> {
  if (!options.totalBudgetWindow) return runCloudflareRoute(request, env, fetchImpl, options);
  const sliceMs = cloudflareSliceMs(request, options, env);
  if (sliceMs <= 0) throw totalBudgetTimeoutError(0);
  const routeController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, routeController, transport);
  const routePromise = runCloudflareRoute(request, env, boundedFetch, options);
  routePromise.catch(() => undefined);
  const settled: Promise<
    | { kind: "result"; result: OriginProviderExecutionResult }
    | { kind: "error"; error: unknown }
  > = routePromise.then(
    (result) => ({ kind: "result" as const, result }),
    (error) => ({ kind: "error" as const, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"budget">((resolve) => {
    timer = setTimeout(() => resolve("budget"), sliceMs);
  });
  const winner = await Promise.race([settled, budget]);
  if (winner === "budget") {
    routeController.abort();
    throw totalBudgetTimeoutError(transport.count);
  }
  if (timer) clearTimeout(timer);
  if (winner.kind === "error") throw winner.error;
  return winner.result;
}

function composeFailoverResult(
  cloudflareResult: OriginProviderExecutionResult,
  priorAttempts: readonly OriginProviderAttemptEvidence[],
  cloudflareDurationMs?: number,
): OriginProviderExecutionResult {
  const cloudflareAttempt = cloudflareAttemptEvidence("succeeded", {
    transportRequestCount: cloudflareResult.transportRequestCount,
    ...(cloudflareDurationMs !== undefined ? { durationMs: cloudflareDurationMs } : {}),
  });
  const priorTransport = priorAttempts.reduce((sum, attempt) => sum + (attempt.transportRequestCount ?? 0), 0);
  return {
    ...cloudflareResult,
    transportRequestCount: priorTransport + (cloudflareResult.transportRequestCount ?? 0),
    attempts: [...priorAttempts, cloudflareAttempt],
  };
}

async function runGroqRoute(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<OriginProviderExecutionResult> {
  // Mirrors the Cloudflare route: the route plan keeps the primary plan's semantics
  // with the timeout raised to the Groq client's own maximum, so a long generation
  // on the third route is bounded by the dispatch total budget, not the plan default.
  const planResult = buildOriginGroqRoutePlan(
    { ...request.plan, timeoutMs: Math.max(request.plan.timeoutMs, ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS) },
    {
      groqFreeModelCatalog: options.groqCatalog,
      nowMs: options.nowMs,
    },
  );
  if (planResult.ok === false) {
    throw new OriginGroqPreflightError(
      planResult.code === "FREE_MODEL_CATALOG_INVALID" ? "catalog-invalid" : "evidence-stale",
    );
  }
  const execute = options.groqExecute ?? executeOriginGroqProvider;
  return execute(
    { plan: planResult.plan, messages: request.messages, systemInstruction: request.systemInstruction, groqSystemInstruction: request.groqSystemInstruction },
    env,
    fetchImpl,
    { catalog: options.groqCatalog, nowMs: options.nowMs },
  );
}

/**
 * Runs the Groq route inside the dispatch's total budget, with the same semantics as
 * the bounded Cloudflare route: raced against its slice of the window and
 * aborted when the slice expires. The slice is the time remaining in the
 * window, additionally capped at the Groq attempt budget in Groq-first mode
 * (see groqSliceMs). Without a window (direct internal use only) the
 * route runs exactly as the unbounded helper.
 */
async function runGroqRouteBounded(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<OriginProviderExecutionResult> {
  if (!options.totalBudgetWindow) return runGroqRoute(request, env, fetchImpl, options);
  const sliceMs = groqSliceMs(request, options, env);
  if (sliceMs <= 0) throw totalBudgetTimeoutError(0);
  const routeController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, routeController, transport);
  const routePromise = runGroqRoute(request, env, boundedFetch, options);
  routePromise.catch(() => undefined);
  const settled: Promise<
    | { kind: "result"; result: OriginProviderExecutionResult }
    | { kind: "error"; error: unknown }
  > = routePromise.then(
    (result) => ({ kind: "result" as const, result }),
    (error) => ({ kind: "error" as const, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"budget">((resolve) => {
    timer = setTimeout(() => resolve("budget"), sliceMs);
  });
  const winner = await Promise.race([settled, budget]);
  if (winner === "budget") {
    routeController.abort();
    throw totalBudgetTimeoutError(transport.count);
  }
  if (timer) clearTimeout(timer);
  if (winner.kind === "error") throw winner.error;
  return winner.result;
}

function composeGroqResult(
  groqResult: OriginProviderExecutionResult,
  priorAttempts: readonly OriginProviderAttemptEvidence[],
  groqDurationMs?: number,
): OriginProviderExecutionResult {
  // The Groq route may have rotated inside itself (120b rate-limited, then 20b
  // served): the attempt evidence names the model that actually served, taken
  // from the result's verified routing evidence.
  const groqAttempt = groqAttemptEvidence("succeeded", {
    modelId: groqResult.routingEvidence?.servedModel ?? ORIGIN_GROQ_FREE_MODEL_ID,
    transportRequestCount: groqResult.transportRequestCount,
    ...(groqDurationMs !== undefined ? { durationMs: groqDurationMs } : {}),
  });
  const priorTransport = priorAttempts.reduce((sum, attempt) => sum + (attempt.transportRequestCount ?? 0), 0);
  return {
    ...groqResult,
    transportRequestCount: priorTransport + (groqResult.transportRequestCount ?? 0),
    attempts: [...priorAttempts, groqAttempt],
  };
}

/**
 * Third-route attempt, entered only from availability failures or pre-execution
 * skips of the earlier routes. When GROQ_API_KEY is not configured the route does
 * not exist: the fallback error is thrown with the prior attempts unchanged, exactly
 * as the two-route dispatcher behaved. When the route is skipped before execution,
 * the earlier routes' error stays the surfaced one; when the route executed and
 * failed, its own error is surfaced with the full attempt history.
 */
async function attemptGroqRoute(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  priorAttempts: readonly OriginProviderAttemptEvidence[],
  fallbackError: OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  if (!isOriginGroqRouteConfigured(env)) {
    throw withFailoverAttempts(fallbackError, priorAttempts);
  }
  const groqStartedAtMs = Date.now();
  try {
    const groqResult = await runGroqRouteBounded(request, env, fetchImpl, options);
    return composeGroqResult(groqResult, priorAttempts, Date.now() - groqStartedAtMs);
  } catch (error) {
    if (error instanceof OriginGroqPreflightError) {
      const skipped = groqAttemptEvidence("skipped", {
        skipReason: error.reason,
        transportRequestCount: 0,
      });
      throw withFailoverAttempts(fallbackError, [...priorAttempts, skipped]);
    }
    if (error instanceof OriginProviderError) {
      const failed = groqAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - groqStartedAtMs },
      );
      throw withFailoverAttempts(error, [...priorAttempts, failed]);
    }
    throw error;
  }
}

/**
 * Final-route attempt of the Cloudflare route in Groq-first mode (S-1): the
 * mirror of attemptGroqRoute with the roles exchanged. The route runs bounded
 * (its slice carries no third-route reserve in this order; see
 * cloudflareSliceMs), its outcome is recorded on its circuit breaker exactly
 * as in the current order, and there is no later route: a success is composed
 * over the prior attempts, a pre-execution skip surfaces the fallback error
 * (the error of the route that executed before it, or the primary error when
 * nothing executed), and an executed failure surfaces the route's own error.
 * The route's circuit breaker never skips it here: as the last route it runs
 * even while the breaker is open, exactly like the current order's second
 * route when no third route is configured. That matters most in the situation
 * Groq-first creates — when the Groq route is at its own limits, skipping the
 * final route as well would hard-fail every request instead of giving the
 * last chance its attempt. The outcome is still recorded on the breaker as
 * usual: a success closes it, and a counted failure re-opens it at once (the
 * record function's executed-while-open case).
 */
async function attemptCloudflareRoute(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  priorAttempts: readonly OriginProviderAttemptEvidence[],
  fallbackError: OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  const cloudflareStartedAtMs = Date.now();
  try {
    const cloudflareResult = await runCloudflareRouteBounded(request, env, fetchImpl, options);
    recordCloudflareRouteSuccess();
    return composeFailoverResult(cloudflareResult, priorAttempts, Date.now() - cloudflareStartedAtMs);
  } catch (error) {
    if (error instanceof OriginCloudflarePreflightError) {
      const skipped = cloudflareAttemptEvidence("skipped", {
        skipReason: error.reason === "plan-proof-failed" && error.proofReason
          ? `plan-proof-failed:${error.proofReason}`
          : error.reason,
        transportRequestCount: 0,
      });
      throw withFailoverAttempts(fallbackError, [...priorAttempts, skipped]);
    }
    if (error instanceof OriginProviderError) {
      recordCloudflareRouteFailure(error, options);
      const failed = cloudflareAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - cloudflareStartedAtMs },
      );
      throw withFailoverAttempts(error, [...priorAttempts, failed]);
    }
    throw error;
  }
}

/**
 * Groq-first phase (S-1), entered from a primary availability failure or a
 * circuit-open primary skip while groqFirstOrderApplies holds: the Groq route
 * runs first, bounded by its attempt budget (see groqSliceMs). A success is
 * composed over the primary attempt alone, so the Cloudflare route is never
 * attempted and sends nothing. An availability failure — including the
 * attempt budget expiring — and a pre-execution skip both move on to the
 * Cloudflare route as the final route; an integrity failure fails closed on
 * the spot, exactly as in the current order. The error surfaced when the
 * final route is skipped before execution is the Groq route's own error when
 * it executed and failed, or the caller's fallback error (built lazily by
 * `skippedFallbackError`) when the Groq route was skipped too.
 */
async function failOverFromGroqRoute(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  primaryAttempt: OriginProviderAttemptEvidence,
  skippedFallbackError: () => OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  const groqStartedAtMs = Date.now();
  try {
    const groqResult = await runGroqRouteBounded(request, env, fetchImpl, options);
    return composeGroqResult(groqResult, [primaryAttempt], Date.now() - groqStartedAtMs);
  } catch (error) {
    if (error instanceof OriginGroqPreflightError) {
      const skipped = groqAttemptEvidence("skipped", {
        skipReason: error.reason,
        transportRequestCount: 0,
      });
      return attemptCloudflareRoute(request, env, fetchImpl, options, [primaryAttempt, skipped], skippedFallbackError());
    }
    if (error instanceof OriginProviderError) {
      const failed = groqAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - groqStartedAtMs },
      );
      if (ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
        return attemptCloudflareRoute(request, env, fetchImpl, options, [primaryAttempt, failed], error);
      }
      throw withFailoverAttempts(error, [primaryAttempt, failed]);
    }
    throw error;
  }
}

/**
 * Adapts a blocking route executor to the streaming shape: its verified full
 * text is released once, at completion. This is the degradation for an
 * injected executor without streaming support (and exactly the behavior the
 * streaming entry had for every failover route before the routes learned to
 * stream); the production default below is the route's real streaming
 * executor.
 */
function adaptCloudflareStreamExecutor(execute: typeof executeOriginCloudflareProvider): OriginCloudflareStreamExecutor {
  return async (request, handlers, env, fetchImpl, options) => {
    const result = await execute(request, env, fetchImpl, options);
    if (result.text) handlers.onDelta(result.text);
    return result;
  };
}

function adaptGroqStreamExecutor(execute: typeof executeOriginGroqProvider): OriginGroqStreamExecutor {
  return async (request, handlers, env, fetchImpl, options) => {
    const result = await execute(request, env, fetchImpl, options);
    if (result.text) handlers.onDelta(result.text);
    return result;
  };
}

function resolveCloudflareStreamExecutor(options: OriginProviderFailoverOptions): OriginCloudflareStreamExecutor {
  if (options.cloudflareStreamExecute) return options.cloudflareStreamExecute;
  if (options.cloudflareExecute) return adaptCloudflareStreamExecutor(options.cloudflareExecute);
  return executeOriginCloudflareProviderStream;
}

function resolveGroqStreamExecutor(options: OriginProviderFailoverOptions): OriginGroqStreamExecutor {
  if (options.groqStreamExecute) return options.groqStreamExecute;
  if (options.groqExecute) return adaptGroqStreamExecutor(options.groqExecute);
  return executeOriginGroqProviderStream;
}

async function runCloudflareRouteStream(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<OriginProviderExecutionResult> {
  // Mirrors runCloudflareRoute (same route plan, timeout raised to the
  // Cloudflare client's own maximum); the request additionally carries the
  // stream-release policy, which only the streaming executor reads.
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
  const execute = resolveCloudflareStreamExecutor(options);
  return execute(
    { plan: planResult.plan, messages: request.messages, systemInstruction: request.systemInstruction, cloudflareSystemInstruction: request.cloudflareSystemInstruction, streamRelease: request.streamRelease },
    handlers,
    env,
    fetchImpl,
    { catalog: options.cloudflareCatalog, nowMs: options.nowMs },
  );
}

async function runGroqRouteStream(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
): Promise<OriginProviderExecutionResult> {
  // Mirrors runGroqRoute (same route plan, timeout raised to the Groq
  // client's own maximum), plus the stream-release policy.
  const planResult = buildOriginGroqRoutePlan(
    { ...request.plan, timeoutMs: Math.max(request.plan.timeoutMs, ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS) },
    {
      groqFreeModelCatalog: options.groqCatalog,
      nowMs: options.nowMs,
    },
  );
  if (planResult.ok === false) {
    throw new OriginGroqPreflightError(
      planResult.code === "FREE_MODEL_CATALOG_INVALID" ? "catalog-invalid" : "evidence-stale",
    );
  }
  const execute = resolveGroqStreamExecutor(options);
  return execute(
    { plan: planResult.plan, messages: request.messages, systemInstruction: request.systemInstruction, groqSystemInstruction: request.groqSystemInstruction, streamRelease: request.streamRelease },
    handlers,
    env,
    fetchImpl,
    { catalog: options.groqCatalog, nowMs: options.nowMs },
  );
}

/**
 * Races one failover route's stream against its slice of the total budget,
 * with the streaming delivery rule. Before the first delivered fragment, a
 * slice expiry aborts the route's fetches, detaches its handlers (a late
 * fragment from the abandoned stream is dropped by the guard), and surfaces
 * as the same bounded-race timeout the blocking routes produce. After any
 * fragment is delivered, abandoning the stream would corrupt the displayed
 * answer, so the race is stood down and the route finishes under its own
 * client's caps — the same exception the primary stream has always had.
 */
async function raceRouteStreamAgainstSlice(
  start: (guardedHandlers: OriginProviderStreamHandlers) => Promise<OriginProviderExecutionResult>,
  handlers: OriginProviderStreamHandlers,
  sliceMs: number,
  transport: { count: number },
  abort: () => void,
  delivery: { delivered: boolean },
): Promise<OriginProviderExecutionResult> {
  if (sliceMs <= 0) throw totalBudgetTimeoutError(0);
  let abandoned = false;
  const guardedHandlers: OriginProviderStreamHandlers = {
    onDelta: (text: string) => {
      if (abandoned) return;
      handlers.onDelta(text);
    },
  };
  const routePromise = start(guardedHandlers);
  routePromise.catch(() => undefined);
  const settled: Promise<
    | { kind: "result"; result: OriginProviderExecutionResult }
    | { kind: "error"; error: unknown }
  > = routePromise.then(
    (result) => ({ kind: "result" as const, result }),
    (error) => ({ kind: "error" as const, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"budget">((resolve) => {
    timer = setTimeout(() => resolve("budget"), sliceMs);
  });
  const winner = await Promise.race([settled, budget]);
  if (winner === "budget") {
    if (delivery.delivered) {
      const outcome = await settled;
      if (outcome.kind === "error") throw outcome.error;
      return outcome.result;
    }
    abandoned = true;
    abort();
    throw totalBudgetTimeoutError(transport.count);
  }
  if (timer) clearTimeout(timer);
  if (winner.kind === "error") throw winner.error;
  return winner.result;
}

/**
 * The Cloudflare route's stream inside the dispatch's total budget: same
 * slice computation as the blocking bounded route (third-route reserve and
 * the second route's attempt cap included), raced under the delivery rule
 * above. Without a window (direct internal use only) the route streams
 * exactly as the unbounded helper.
 */
async function runCloudflareRouteStreamBounded(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  delivery: { delivered: boolean },
): Promise<OriginProviderExecutionResult> {
  if (!options.totalBudgetWindow) return runCloudflareRouteStream(request, handlers, env, fetchImpl, options);
  const routeController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, routeController, transport);
  return raceRouteStreamAgainstSlice(
    (guardedHandlers) => runCloudflareRouteStream(request, guardedHandlers, env, boundedFetch, options),
    handlers,
    cloudflareSliceMs(request, options, env),
    transport,
    () => routeController.abort(),
    delivery,
  );
}

/** The Groq route's stream inside the total budget, mirroring the bounded blocking route. */
async function runGroqRouteStreamBounded(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  delivery: { delivered: boolean },
): Promise<OriginProviderExecutionResult> {
  if (!options.totalBudgetWindow) return runGroqRouteStream(request, handlers, env, fetchImpl, options);
  const routeController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, routeController, transport);
  return raceRouteStreamAgainstSlice(
    (guardedHandlers) => runGroqRouteStream(request, guardedHandlers, env, boundedFetch, options),
    handlers,
    groqSliceMs(request, options, env),
    transport,
    () => routeController.abort(),
    delivery,
  );
}

/**
 * Streaming mirror of attemptGroqRoute: identical skip and error surfacing,
 * with the third route running as a stream whose fragments the chain's
 * tracking handlers forward as they arrive.
 */
async function attemptGroqStreamRoute(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  delivery: { delivered: boolean },
  priorAttempts: readonly OriginProviderAttemptEvidence[],
  fallbackError: OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  if (!isOriginGroqRouteConfigured(env)) {
    throw withFailoverAttempts(fallbackError, priorAttempts);
  }
  const groqStartedAtMs = Date.now();
  try {
    const groqResult = await runGroqRouteStreamBounded(request, handlers, env, fetchImpl, options, delivery);
    return composeGroqResult(groqResult, priorAttempts, Date.now() - groqStartedAtMs);
  } catch (error) {
    if (error instanceof OriginGroqPreflightError) {
      const skipped = groqAttemptEvidence("skipped", {
        skipReason: error.reason,
        transportRequestCount: 0,
      });
      throw withFailoverAttempts(fallbackError, [...priorAttempts, skipped]);
    }
    if (error instanceof OriginProviderError) {
      const failed = groqAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - groqStartedAtMs },
      );
      throw withFailoverAttempts(error, [...priorAttempts, failed]);
    }
    throw error;
  }
}

/**
 * Streaming mirror of attemptCloudflareRoute: the Cloudflare route runs as
 * the final route of the Groq-first order, as a stream. Circuit-breaker
 * recording, attempt evidence, and error surfacing are identical to the
 * blocking final-route attempt; there is no later route to switch to, so a
 * failure is always surfaced (with the fallback error taking its place when
 * the route was skipped before execution). Like the blocking attempt, the
 * route runs even while its circuit breaker is open — the breaker records
 * the outcome but never skips the last route.
 */
async function attemptCloudflareStreamRoute(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  delivery: { delivered: boolean },
  priorAttempts: readonly OriginProviderAttemptEvidence[],
  fallbackError: OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  const cloudflareStartedAtMs = Date.now();
  try {
    const cloudflareResult = await runCloudflareRouteStreamBounded(request, handlers, env, fetchImpl, options, delivery);
    recordCloudflareRouteSuccess();
    return composeFailoverResult(cloudflareResult, priorAttempts, Date.now() - cloudflareStartedAtMs);
  } catch (error) {
    if (error instanceof OriginCloudflarePreflightError) {
      const skipped = cloudflareAttemptEvidence("skipped", {
        skipReason: error.reason === "plan-proof-failed" && error.proofReason
          ? `plan-proof-failed:${error.proofReason}`
          : error.reason,
        transportRequestCount: 0,
      });
      throw withFailoverAttempts(fallbackError, [...priorAttempts, skipped]);
    }
    if (error instanceof OriginProviderError) {
      recordCloudflareRouteFailure(error, options);
      const failed = cloudflareAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - cloudflareStartedAtMs },
      );
      throw withFailoverAttempts(error, [...priorAttempts, failed]);
    }
    throw error;
  }
}

/**
 * Streaming mirror of failOverFromGroqRoute: the Groq route streams first
 * under its attempt budget, and its fragments reach the client as they are
 * generated. The switch to the Cloudflare route happens only before the
 * first delivered fragment — once any fragment of the Groq route's answer
 * has been delivered, an availability failure no longer switches (switching
 * would duplicate the displayed text) and the failure is surfaced instead,
 * exactly like the current order's mid-stream guard on the second route.
 */
async function failOverStreamFromGroqRoute(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  primaryAttempt: OriginProviderAttemptEvidence,
  skippedFallbackError: () => OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  const delivery = { delivered: false };
  const trackingHandlers: OriginProviderStreamHandlers = {
    onDelta: (text: string) => {
      if (text) delivery.delivered = true;
      handlers.onDelta(text);
    },
  };
  const groqStartedAtMs = Date.now();
  try {
    const groqResult = await runGroqRouteStreamBounded(request, trackingHandlers, env, fetchImpl, options, delivery);
    return composeGroqResult(groqResult, [primaryAttempt], Date.now() - groqStartedAtMs);
  } catch (error) {
    if (error instanceof OriginGroqPreflightError) {
      const skipped = groqAttemptEvidence("skipped", {
        skipReason: error.reason,
        transportRequestCount: 0,
      });
      return attemptCloudflareStreamRoute(request, trackingHandlers, env, fetchImpl, options, delivery, [primaryAttempt, skipped], skippedFallbackError());
    }
    if (error instanceof OriginProviderError) {
      const failed = groqAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - groqStartedAtMs },
      );
      if (ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) && !delivery.delivered) {
        return attemptCloudflareStreamRoute(request, trackingHandlers, env, fetchImpl, options, delivery, [primaryAttempt, failed], error);
      }
      throw withFailoverAttempts(error, [primaryAttempt, failed]);
    }
    throw error;
  }
}

/**
 * Streaming mirror of failOverFromCloudflareRoute: the second route runs as
 * a stream and its fragments reach the client as they are generated, under
 * the request's stream-release policy. Circuit-breaker recording, attempt
 * evidence, and error surfacing are identical to the blocking chain, with
 * one streaming-only guard: once any fragment of the second route's answer
 * has been delivered, an availability failure no longer switches to the
 * third route — switching would duplicate the displayed text — and the
 * failure is surfaced instead, exactly like a mid-stream primary failure.
 */
async function failOverStreamFromCloudflareRoute(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  primaryAttempt: OriginProviderAttemptEvidence,
  skippedFallbackError: () => OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  const delivery = { delivered: false };
  const trackingHandlers: OriginProviderStreamHandlers = {
    onDelta: (text: string) => {
      if (text) delivery.delivered = true;
      handlers.onDelta(text);
    },
  };
  const circuit = cloudflareCircuitOpen(options);
  if (circuit && isOriginGroqRouteConfigured(env)) {
    const skipped = cloudflareAttemptEvidence("skipped", {
      skipReason: ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON,
      errorCode: circuit.errorCode,
      transportRequestCount: 0,
    });
    return attemptGroqStreamRoute(request, trackingHandlers, env, fetchImpl, options, delivery, [primaryAttempt, skipped], skippedFallbackError());
  }
  const cloudflareStartedAtMs = Date.now();
  try {
    const cloudflareResult = await runCloudflareRouteStreamBounded(request, trackingHandlers, env, fetchImpl, options, delivery);
    recordCloudflareRouteSuccess();
    return composeFailoverResult(cloudflareResult, [primaryAttempt], Date.now() - cloudflareStartedAtMs);
  } catch (error) {
    if (error instanceof OriginCloudflarePreflightError) {
      const skipped = cloudflareAttemptEvidence("skipped", {
        skipReason: error.reason === "plan-proof-failed" && error.proofReason
          ? `plan-proof-failed:${error.proofReason}`
          : error.reason,
        transportRequestCount: 0,
      });
      return attemptGroqStreamRoute(request, trackingHandlers, env, fetchImpl, options, delivery, [primaryAttempt, skipped], skippedFallbackError());
    }
    if (error instanceof OriginProviderError) {
      recordCloudflareRouteFailure(error, options);
      const failed = cloudflareAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - cloudflareStartedAtMs },
      );
      if (ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) && !delivery.delivered) {
        return attemptGroqStreamRoute(request, trackingHandlers, env, fetchImpl, options, delivery, [primaryAttempt, failed], error);
      }
      throw withFailoverAttempts(error, [primaryAttempt, failed]);
    }
    throw error;
  }
}

/** Streaming mirror of failOverFromPrimaryError. */
async function failOverStreamFromPrimaryError(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  primaryError: OriginProviderError,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  primaryDurationMs?: number,
): Promise<OriginProviderExecutionResult> {
  const primaryAttempt = primaryAttemptEvidence(request, "availability-error", primaryError, primaryDurationMs);
  if (groqFirstOrderApplies(request, env)) {
    return failOverStreamFromGroqRoute(request, handlers, env, fetchImpl, options, primaryAttempt, () => primaryError);
  }
  return failOverStreamFromCloudflareRoute(request, handlers, env, fetchImpl, options, primaryAttempt, () => primaryError);
}

/** Streaming mirror of failOverFromOpenCircuit. */
async function failOverStreamFromOpenCircuit(
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
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
  if (groqFirstOrderApplies(request, env)) {
    return failOverStreamFromGroqRoute(
      request,
      handlers,
      env,
      fetchImpl,
      options,
      primaryAttempt,
      () => circuitPrimaryError(circuit, options),
    );
  }
  return failOverStreamFromCloudflareRoute(
    request,
    handlers,
    env,
    fetchImpl,
    options,
    primaryAttempt,
    () => circuitPrimaryError(circuit, options),
  );
}

/**
 * Second-route phase shared by both failover entries (a primary availability
 * failure, and a circuit-open primary skip): runs the Cloudflare route bounded,
 * records the outcome on its circuit breaker, and falls through to the third
 * route on availability failures and pre-execution skips. Returns the serving
 * route's result on success; otherwise throws the honest error: the fallback
 * error (built lazily by `skippedFallbackError`, since the open-circuit
 * variant's Retry-After depends on when it is built) when the second route was
 * skipped before execution, or the second route's own error when it executed
 * and failed. Attempt history is attached to the thrown error's diagnostic
 * either way.
 *
 * Circuit breaker: while the second route's breaker is open and the third
 * route is configured, the second route is not attempted at all — the skip is
 * recorded exactly like a pre-execution skip (skipReason
 * "cloudflare-circuit-open", the opening error code, zero transport requests)
 * and the third route runs immediately. Without a configured third route the
 * second route is the last route and always runs, breaker state
 * notwithstanding.
 */
async function failOverFromCloudflareRoute(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginProviderFailoverOptions,
  primaryAttempt: OriginProviderAttemptEvidence,
  skippedFallbackError: () => OriginProviderError,
): Promise<OriginProviderExecutionResult> {
  const circuit = cloudflareCircuitOpen(options);
  if (circuit && isOriginGroqRouteConfigured(env)) {
    const skipped = cloudflareAttemptEvidence("skipped", {
      skipReason: ORIGIN_CLOUDFLARE_CIRCUIT_SKIP_REASON,
      errorCode: circuit.errorCode,
      transportRequestCount: 0,
    });
    return attemptGroqRoute(request, env, fetchImpl, options, [primaryAttempt, skipped], skippedFallbackError());
  }
  const cloudflareStartedAtMs = Date.now();
  try {
    const cloudflareResult = await runCloudflareRouteBounded(request, env, fetchImpl, options);
    recordCloudflareRouteSuccess();
    return composeFailoverResult(cloudflareResult, [primaryAttempt], Date.now() - cloudflareStartedAtMs);
  } catch (error) {
    if (error instanceof OriginCloudflarePreflightError) {
      const skipped = cloudflareAttemptEvidence("skipped", {
        skipReason: error.reason === "plan-proof-failed" && error.proofReason
          ? `plan-proof-failed:${error.proofReason}`
          : error.reason,
        transportRequestCount: 0,
      });
      return attemptGroqRoute(request, env, fetchImpl, options, [primaryAttempt, skipped], skippedFallbackError());
    }
    if (error instanceof OriginProviderError) {
      recordCloudflareRouteFailure(error, options);
      const failed = cloudflareAttemptEvidence(
        ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code) ? "availability-error" : "failed",
        { errorCode: error.code, ...upstreamAttemptFields(error), transportRequestCount: error.diagnostic?.transportRequestCount, durationMs: Date.now() - cloudflareStartedAtMs },
      );
      if (ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
        return attemptGroqRoute(request, env, fetchImpl, options, [primaryAttempt, failed], error);
      }
      throw withFailoverAttempts(error, [primaryAttempt, failed]);
    }
    throw error;
  }
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
  primaryDurationMs?: number,
): Promise<OriginProviderExecutionResult> {
  const primaryAttempt = primaryAttemptEvidence(request, "availability-error", primaryError, primaryDurationMs);
  if (groqFirstOrderApplies(request, env)) {
    return failOverFromGroqRoute(request, env, fetchImpl, options, primaryAttempt, () => primaryError);
  }
  return failOverFromCloudflareRoute(request, env, fetchImpl, options, primaryAttempt, () => primaryError);
}

/**
 * The honest primary error while the primary circuit is open and no primary
 * attempt ran in this request: the code that opened the breaker, with the
 * remaining cooldown as Retry-After for a rate limit. Surfaced when every later
 * route is skipped before execution.
 */
function circuitPrimaryError(circuit: OriginPrimaryCircuitState, options: OriginProviderFailoverOptions): OriginProviderError {
  const remainingCooldownSeconds = Math.max(1, Math.ceil((circuit.openUntilMs - dispatcherNowMs(options)) / 1000));
  return circuit.errorCode === "PROVIDER_RATE_LIMITED"
    ? new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, remainingCooldownSeconds, { transportRequestCount: 0 })
    : new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, { transportFailure: "timeout", transportRequestCount: 0 });
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
 *
 * Third route (2026-11-08): Groq (openai/gpt-oss-120b) runs only after both earlier
 * routes are unavailable, and only while GROQ_API_KEY is configured. The route was
 * verified live in the owner's Groq Console before implementation (ZDR enabled
 * globally on the free account; free limits 30 RPM / 1,000 requests per day / 8,000
 * tokens per minute / 200,000 tokens per day; no payment method registered, so
 * exceeding the free limits errors instead of charging). Without the key the route
 * does not exist: the dispatcher never attempts it, records no attempt for it, and
 * behavior is exactly the two-route behavior above — which is the production state
 * until the owner registers the key. With the key, the route is raced against the
 * same total budget as the second route, its executor enforces the 8,000
 * tokens/minute ceiling before sending, and its evidence catalog entry expires on
 * 2026-12-01, after which the route disables itself (fail closed). Inside the
 * route, the executor may rotate once from openai/gpt-oss-120b to
 * openai/gpt-oss-20b (a separate per-model quota bucket with its own catalog
 * evidence) when the primary model fails with a rate-limit or overload error;
 * the route still counts as the single third attempt, and the attempt evidence
 * names the model that actually served. Integrity
 * failures on any route still never switch routes: the third route is reached only
 * from availability failures or pre-execution skips of the routes before it.
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
  if (groqFirstOrderApplies(request, env)) {
    return failOverFromGroqRoute(
      request,
      env,
      fetchImpl,
      options,
      primaryAttempt,
      () => circuitPrimaryError(circuit, options),
    );
  }
  return failOverFromCloudflareRoute(
    request,
    env,
    fetchImpl,
    options,
    primaryAttempt,
    () => circuitPrimaryError(circuit, options),
  );
}

export async function executeOriginProviderWithFailover(
  providerRequest: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  options: OriginProviderFailoverOptions = {},
): Promise<OriginProviderExecutionResult> {
  const primary = options.primaryExecute ?? executeOriginProvider;
  if (providerRequest.requiredTool || (!isOriginCloudflareFailoverEnabled(env) && !isOriginGroqRouteConfigured(env))) {
    return primary(providerRequest, env, fetchImpl);
  }
  const scopedOptions = withTotalBudgetWindow(options);
  const circuit = primaryCircuitOpen(scopedOptions);
  if (circuit) {
    return failOverFromOpenCircuit(providerRequest, env, fetchImpl, scopedOptions, circuit);
  }
  const outcome = await runPrimaryAttempt(primary, providerRequest, env, fetchImpl, scopedOptions);
  if (outcome.kind === "budget-timeout") {
    openPrimaryCircuit(scopedOptions, "PROVIDER_TIMEOUT");
    return failOverFromPrimaryError(providerRequest, primaryBudgetTimeoutError(outcome.transportRequestCount), env, fetchImpl, scopedOptions, outcome.durationMs);
  }
  if (outcome.kind === "error") {
    const error = outcome.error;
    if (error instanceof OriginProviderError && ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
      const openingCode = circuitOpeningCode(error);
      if (openingCode) openPrimaryCircuit(scopedOptions, openingCode);
      return failOverFromPrimaryError(providerRequest, error, env, fetchImpl, scopedOptions, outcome.durationMs);
    }
    throw error;
  }
  closePrimaryCircuit();
  const primaryResult = outcome.result;
  return {
    ...primaryResult,
    attempts: [{
      ...primaryAttemptEvidence(providerRequest, "succeeded", undefined, outcome.durationMs),
      transportRequestCount: primaryResult.transportRequestCount,
    }],
  };
}

/**
 * Streaming variant. Failover here happens strictly before the first downstream
 * byte: if the primary stream fails with an availability error and nothing was
 * delivered, the failover routes run as streams themselves — the Cloudflare and
 * Groq routes forward their fragments progressively under the request's
 * stream-release policy (incremental forwarding, or a single verified release
 * at completion in hold mode), and the composed result's text is exactly what
 * the serving route generated. After any byte is delivered, no switch is
 * attempted, on any route.
 */
export async function executeOriginProviderStreamWithFailover(
  providerRequest: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  options: OriginProviderFailoverOptions = {},
): Promise<OriginProviderExecutionResult> {
  const stream = options.streamExecute ?? executeOriginProviderStream;
  if (providerRequest.requiredTool || (!isOriginCloudflareFailoverEnabled(env) && !isOriginGroqRouteConfigured(env))) {
    return stream(providerRequest, handlers, env, fetchImpl);
  }
  const scopedOptions = withTotalBudgetWindow(options);
  const circuit = primaryCircuitOpen(scopedOptions);
  if (circuit) {
    return failOverStreamFromOpenCircuit(providerRequest, handlers, env, fetchImpl, scopedOptions, circuit);
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
  const streamStartedAtMs = Date.now();
  const attemptController = new AbortController();
  const transport = { count: 0 };
  const boundedFetch = createAttemptBoundedFetch(fetchImpl, attemptController, transport);
  const primaryPromise = stream(providerRequest, trackingHandlers, env, boundedFetch);
  primaryPromise.catch(() => undefined);
  const settled: Promise<
    | { kind: "result"; result: OriginProviderExecutionResult; durationMs: number }
    | { kind: "error"; error: unknown; durationMs: number }
  > = primaryPromise.then(
    (result) => ({ kind: "result" as const, result, durationMs: Date.now() - streamStartedAtMs }),
    (error) => ({ kind: "error" as const, error, durationMs: Date.now() - streamStartedAtMs }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"budget">((resolve) => {
    timer = setTimeout(() => resolve("budget"), primaryBudgetMs(scopedOptions));
  });
  const winner = await Promise.race([settled, budget]);
  if (winner === "budget" && !delivered) {
    abandoned = true;
    attemptController.abort();
    openPrimaryCircuit(scopedOptions, "PROVIDER_TIMEOUT");
    return failOverStreamFromPrimaryError(
      providerRequest,
      handlers,
      primaryBudgetTimeoutError(transport.count),
      env,
      fetchImpl,
      scopedOptions,
      Date.now() - streamStartedAtMs,
    );
  }
  if (timer) clearTimeout(timer);
  const outcome = winner === "budget" ? await settled : winner;
  if (outcome.kind === "error") {
    const error = outcome.error;
    if (!delivered && error instanceof OriginProviderError && ORIGIN_FAILOVER_TRIGGER_CODES.has(error.code)) {
      const openingCode = circuitOpeningCode(error);
      if (openingCode) openPrimaryCircuit(scopedOptions, openingCode);
      return failOverStreamFromPrimaryError(providerRequest, handlers, error, env, fetchImpl, scopedOptions, outcome.durationMs);
    }
    throw error;
  }
  closePrimaryCircuit();
  const primaryResult = outcome.result;
  return {
    ...primaryResult,
    attempts: [{
      ...primaryAttemptEvidence(providerRequest, "succeeded", undefined, outcome.durationMs),
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
 * Whether an attempt's evidence shows its route did not serve: it either
 * failed with an availability error (a failover trigger code), or it was
 * skipped before execution — a named skip reason and exactly zero transport
 * requests, proving nothing was sent. Any other shape (a claimed success, an
 * integrity failure, a skip that sent requests) means the route may have
 * produced an answer, so a later route's success cannot be verified against
 * it.
 */
function attemptDidNotServe(attempt: OriginProviderAttemptEvidence): boolean {
  const isAvailabilityFailure = attempt.outcome === "availability-error"
    && Boolean(attempt.errorCode)
    && ORIGIN_FAILOVER_TRIGGER_CODES.has(attempt.errorCode as OriginProviderErrorCode);
  const isPreExecutionSkip = attempt.outcome === "skipped"
    && typeof attempt.skipReason === "string"
    && attempt.skipReason.length > 0
    && attempt.transportRequestCount === 0;
  return isAvailabilityFailure || isPreExecutionSkip;
}

/**
 * Generalized zero-cost result verification. Results without an `attempts` record are
 * verified by the original single-route assertion, unchanged. Composite failover results
 * must prove that every executed attempt stayed on an approved free route, that the first
 * route stopped only for an availability reason, that the serving route passed its own
 * route-specific verification, and that the transport count equals the sum of attempts.
 * The rule is order-independent (S-1): the serving route is the LAST attempt, every
 * earlier failover attempt must show its route did not serve — an availability failure
 * or a pre-execution skip with zero transport — and each failover route appears at
 * most once. Both orders therefore verify: Cloudflare-then-Groq (the current order)
 * and Groq-then-Cloudflare (Groq-first direct chat), as do the two-attempt shapes
 * where the first failover route tried already served.
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
  if (!Array.isArray(attempts) || attempts.length < 1 || attempts.length > 3) {
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
  const [first] = attempts;
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
  // The serving route is the last attempt. Every failover attempt before it
  // must show its route did not serve (attemptDidNotServe), and each failover
  // route may appear at most once across the whole record: a dispatch tries
  // each route at most once, in one of the two orders. Any other shape —
  // including a "succeeded" middle attempt, which would mean a later route
  // ran after an answer already existed, or the same route recorded twice —
  // is unverified.
  const serving = attempts[attempts.length - 1];
  const seenFailoverProviders = new Set<string>();
  for (const attempt of attempts.slice(1)) {
    if (attempt.providerId !== ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID
      && attempt.providerId !== ORIGIN_GROQ_FREE_PROVIDER_ID) {
      routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
    }
    if (seenFailoverProviders.has(attempt.providerId)) {
      routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
    }
    seenFailoverProviders.add(attempt.providerId);
  }
  for (const attempt of attempts.slice(1, -1)) {
    if (!attemptDidNotServe(attempt)) {
      routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
    }
  }
  if (serving.providerId === ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID) {
    if (serving.outcome !== "succeeded" || serving.modelId !== ORIGIN_CLOUDFLARE_FREE_MODEL) {
      routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
    }
    assertOriginCloudflareExecutionResult(result);
    return;
  }
  // The serving route is Groq. Its attempt may name either catalog model: the
  // primary openai/gpt-oss-120b, or openai/gpt-oss-20b when the route rotated
  // inside itself after the primary model's rate-limit/overload failure; the
  // result's own routing evidence must match the attempt's model exactly.
  if (serving.providerId !== ORIGIN_GROQ_FREE_PROVIDER_ID
    || serving.outcome !== "succeeded"
    || !isOriginGroqFreeModelId(serving.modelId)) {
    routingFailure("許可された無料Provider/Modelの証跡を確認できません。");
  }
  assertOriginGroqExecutionResult(result, serving.modelId as OriginGroqFreeModelId);
}
