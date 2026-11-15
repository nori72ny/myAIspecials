/**
 * Route advancement for the records path's fresh retry (design §10,
 * R-PR-5).
 *
 * The records synthesis runs through the failover dispatcher, so its
 * result has already consumed whichever routes it needed. Re-running
 * the same dispatch for the retry would start again at route 1 — the
 * route that just produced unusable records — so the retry instead
 * executes directly on the route AFTER the one that served the
 * initial result: route 1 → the Cloudflare route, route 2 → the Groq
 * route, route 3 → no next route exists and the retry does not fire.
 *
 * This module owns the three pieces both grounded routers share:
 * identifying the serving route from a result, building the
 * `executeRetry` callback the records helper consumes, and the $0
 * assertion that understands every result shape the records path can
 * now consume (failover composites, bare route-1 results, and the
 * retry's bare route-2/route-3 results). The failover dispatcher
 * itself is untouched: route execution here mirrors its route
 * runners (same route-plan builders, same timeout raise, same
 * executor options) minus the dispatcher's total-budget race — the
 * records helper's own time gate (§10) is the retry's budget
 * discipline, and the route executors keep their internal caps.
 */
import {
  buildOriginCloudflareRoutePlan,
  buildOriginGroqRoutePlan,
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
  ORIGIN_GROQ_FREE_PROVIDER_ID,
  ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
  type OriginExecutionPlanFailureCode,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginCloudflareFreeModelEvidence } from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import type { OriginGroqFreeModelEvidence } from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import type {
  OriginFetch,
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "./originProviderClient.js";
import {
  assertOriginCloudflareExecutionResult,
  executeOriginCloudflareProvider,
  isOriginCloudflareFailoverEnabled,
  resolveOriginCloudflareCredentials,
} from "./originCloudflareProviderClient.js";
import {
  assertOriginGroqExecutionResult,
  executeOriginGroqProvider,
  isOriginGroqRouteConfigured,
} from "./originGroqProviderClient.js";
import {
  assertOriginZeroCostExecutionResultWithFailover,
  ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS,
} from "./originProviderFailover.js";

/** The dispatcher's fixed route order: 1 OpenRouter, 2 Cloudflare, 3 Groq. */
export type GroundedResearchServingRoute = 1 | 2 | 3;

/**
 * Which route served a synthesis result (design §10's advancement
 * input). The composite `attempts` record is authoritative — its
 * last succeeded attempt is the serving route; the single-route
 * `routingEvidence` (attempt number, then provider name) covers bare
 * results, including the retry's own route-2/route-3 results. Null
 * when neither identifies a route in the fixed order: the caller
 * treats that as "no next route" and the retry does not fire, which
 * matches reality whenever the failover routes are not configured
 * (a bare route-1 result without usable evidence has no derivable
 * successor worth assuming).
 */
export function identifyGroundedResearchServingRoute(
  result: OriginProviderExecutionResult,
): GroundedResearchServingRoute | null {
  const attempts = result.attempts ?? [];
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt.outcome !== "succeeded") continue;
    if (attempt.providerId === ORIGIN_OPENROUTER_FREE_PROVIDER_ID) return 1;
    if (attempt.providerId === ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID) return 2;
    if (attempt.providerId === ORIGIN_GROQ_FREE_PROVIDER_ID) return 3;
    return null;
  }
  const evidence = result.routingEvidence;
  if (evidence.attempt === 1 || evidence.attempt === 2 || evidence.attempt === 3) {
    return evidence.attempt;
  }
  if (evidence.provider === "OpenRouter") return 1;
  if (evidence.provider === "Cloudflare") return 2;
  if (evidence.provider === "Groq") return 3;
  return null;
}

export interface GroundedResearchRecordsRetryRouteDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl?: OriginFetch;
  /** Evidence-freshness clock handed to the route-plan builders and executors. */
  nowMs?: number;
  cloudflareCatalog?: readonly OriginCloudflareFreeModelEvidence[];
  groqCatalog?: readonly OriginGroqFreeModelEvidence[];
  /** Test seams, mirroring OriginProviderFailoverOptions. */
  cloudflareExecute?: typeof executeOriginCloudflareProvider;
  groqExecute?: typeof executeOriginGroqProvider;
}

/**
 * Which derivation stage produced a no-next-route skip (R-PR-8d,
 * RPR8_DESIGN_2026-11-15 §8d). Until this PR every stage below
 * collapsed into the records helper's single "no-next-route" skip
 * reason, so a production log line could not distinguish a request
 * the final route had already served (a legitimate skip — no next
 * route exists) from a derivation that failed on an earlier route.
 * The plan-failure variants carry the route-plan builder's failure
 * code after the colon (FREE_MODEL_EVIDENCE_STALE /
 * FREE_MODEL_CATALOG_INVALID in practice).
 */
export type GroundedResearchRecordsRetrySkipDetail =
  | "route-unidentifiable"
  | "final-route"
  | "cloudflare-not-enabled"
  | "cloudflare-not-credentialed"
  | "groq-not-configured"
  | `cloudflare-plan-failed:${OriginExecutionPlanFailureCode}`
  | `groq-plan-failed:${OriginExecutionPlanFailureCode}`;

/**
 * The detailed no-next-route outcome: instead of a bare null, the
 * detailed executor returns this carrier naming the stage that
 * produced the skip. The records helper records the detail in its
 * stage metrics next to the standing "no-next-route" reason
 * (R-PR-8d); every other consumer keeps the bare-null contract.
 */
export interface GroundedResearchRecordsRetrySkip {
  skipDetail: GroundedResearchRecordsRetrySkipDetail;
}

type GroundedResearchRecordsRetryDerivation =
  | { kind: "executed"; result: OriginProviderExecutionResult }
  | { kind: "skipped"; skipDetail: GroundedResearchRecordsRetrySkipDetail };

/**
 * The derivation both executor factories share: identify the serving
 * route, derive the NEXT route's plan, and execute the same request
 * on that route. Each early exit names its stage (R-PR-8d) instead of
 * collapsing into a bare null; execution errors propagate to the
 * caller, which contains them in the retry layer (design §10).
 */
async function deriveGroundedResearchRecordsRetryExecution(
  deps: GroundedResearchRecordsRetryRouteDeps,
  request: OriginProviderExecutionRequest,
  firstResult: OriginProviderExecutionResult,
): Promise<GroundedResearchRecordsRetryDerivation> {
  const route = identifyGroundedResearchServingRoute(firstResult);
  if (route === null) return { kind: "skipped", skipDetail: "route-unidentifiable" };
  if (route === 3) return { kind: "skipped", skipDetail: "final-route" };
  if (route === 1) {
    if (!isOriginCloudflareFailoverEnabled(deps.env)) {
      return { kind: "skipped", skipDetail: "cloudflare-not-enabled" };
    }
    if (!resolveOriginCloudflareCredentials(deps.env)) {
      return { kind: "skipped", skipDetail: "cloudflare-not-credentialed" };
    }
    const planResult = buildOriginCloudflareRoutePlan(
      { ...request.plan, timeoutMs: Math.max(request.plan.timeoutMs, ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS) },
      { cloudflareFreeModelCatalog: deps.cloudflareCatalog, nowMs: deps.nowMs },
    );
    if (planResult.ok === false) return { kind: "skipped", skipDetail: `cloudflare-plan-failed:${planResult.code}` };
    const execute = deps.cloudflareExecute ?? executeOriginCloudflareProvider;
    const result = await execute(
      { plan: planResult.plan, messages: request.messages, systemInstruction: request.systemInstruction },
      deps.env,
      deps.fetchImpl ?? fetch,
      { catalog: deps.cloudflareCatalog, nowMs: deps.nowMs },
    );
    return { kind: "executed", result };
  }
  if (!isOriginGroqRouteConfigured(deps.env)) {
    return { kind: "skipped", skipDetail: "groq-not-configured" };
  }
  const planResult = buildOriginGroqRoutePlan(
    { ...request.plan, timeoutMs: Math.max(request.plan.timeoutMs, ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS) },
    { groqFreeModelCatalog: deps.groqCatalog, nowMs: deps.nowMs },
  );
  if (planResult.ok === false) return { kind: "skipped", skipDetail: `groq-plan-failed:${planResult.code}` };
  const execute = deps.groqExecute ?? executeOriginGroqProvider;
  const result = await execute(
    {
      plan: planResult.plan,
      messages: request.messages,
      systemInstruction: request.systemInstruction,
      groqSystemInstruction: request.groqSystemInstruction,
    },
    deps.env,
    deps.fetchImpl ?? fetch,
    { catalog: deps.groqCatalog, nowMs: deps.nowMs },
  );
  return { kind: "executed", result };
}

/**
 * Builds the records helper's `executeRetry` callback: given the
 * initial records request and its result, derive the NEXT route's
 * plan from the request's plan and execute the same request on that
 * route. Returns null — the helper's no-next-route skip — when the
 * initial execution already reached route 3, when its route cannot
 * be identified, when the next route is not configured in this
 * environment, or when the next route's plan cannot be derived (for
 * example stale free-model evidence: the route executors would
 * refuse it as well, so no execution is spent finding out). Execution
 * errors propagate to the helper, which contains them in the retry
 * layer (design §10).
 */
export function createGroundedResearchRecordsRetryExecutor(
  deps: GroundedResearchRecordsRetryRouteDeps,
): (
  request: OriginProviderExecutionRequest,
  firstResult: OriginProviderExecutionResult,
) => Promise<OriginProviderExecutionResult | null> {
  return async (request, firstResult) => {
    const derivation = await deriveGroundedResearchRecordsRetryExecution(deps, request, firstResult);
    return derivation.kind === "executed" ? derivation.result : null;
  };
}

/**
 * The detailed variant the grounded routers wire (R-PR-8d): same
 * derivation and execution as
 * `createGroundedResearchRecordsRetryExecutor`, but a no-next-route
 * outcome returns the skip carrier naming the derivation stage
 * instead of a bare null, so the records helper can record WHICH
 * stage skipped in its stage metrics. Execution errors propagate
 * exactly as in the bare variant.
 */
export function createGroundedResearchRecordsRetryExecutorWithDetail(
  deps: GroundedResearchRecordsRetryRouteDeps,
): (
  request: OriginProviderExecutionRequest,
  firstResult: OriginProviderExecutionResult,
) => Promise<OriginProviderExecutionResult | GroundedResearchRecordsRetrySkip> {
  return async (request, firstResult) => {
    const derivation = await deriveGroundedResearchRecordsRetryExecution(deps, request, firstResult);
    return derivation.kind === "executed" ? derivation.result : { skipDetail: derivation.skipDetail };
  };
}

/**
 * The $0 assertion for every result shape the records path consumes.
 * Failover composites and bare route-1 results go through the
 * standing failover assertion, exactly as before this PR. The
 * retry's bare route-2/route-3 results carry no `attempts` and would
 * fail that assertion's route-1 identity checks, so they are verified
 * by their own route's assertion instead — the same per-route
 * verification the dispatcher applies inside a composite. Used at
 * the records call sites only; every other caller keeps the standing
 * assertion.
 */
export function assertGroundedResearchRecordsZeroCost(
  result: OriginProviderExecutionResult,
  expectedPrimaryModel: string,
): void {
  if (result.attempts === undefined) {
    if (result.routingEvidence.provider === "Cloudflare") {
      assertOriginCloudflareExecutionResult(result);
      return;
    }
    if (result.routingEvidence.provider === "Groq") {
      assertOriginGroqExecutionResult(result);
      return;
    }
  }
  assertOriginZeroCostExecutionResultWithFailover(result, expectedPrimaryModel);
}
