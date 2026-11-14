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
    const route = identifyGroundedResearchServingRoute(firstResult);
    if (route === null || route === 3) return null;
    if (route === 1) {
      if (!isOriginCloudflareFailoverEnabled(deps.env) || !resolveOriginCloudflareCredentials(deps.env)) {
        return null;
      }
      const planResult = buildOriginCloudflareRoutePlan(
        { ...request.plan, timeoutMs: Math.max(request.plan.timeoutMs, ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS) },
        { cloudflareFreeModelCatalog: deps.cloudflareCatalog, nowMs: deps.nowMs },
      );
      if (!planResult.ok) return null;
      const execute = deps.cloudflareExecute ?? executeOriginCloudflareProvider;
      return execute(
        { plan: planResult.plan, messages: request.messages, systemInstruction: request.systemInstruction },
        deps.env,
        deps.fetchImpl ?? fetch,
        { catalog: deps.cloudflareCatalog, nowMs: deps.nowMs },
      );
    }
    if (!isOriginGroqRouteConfigured(deps.env)) return null;
    const planResult = buildOriginGroqRoutePlan(
      { ...request.plan, timeoutMs: Math.max(request.plan.timeoutMs, ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS) },
      { groqFreeModelCatalog: deps.groqCatalog, nowMs: deps.nowMs },
    );
    if (!planResult.ok) return null;
    const execute = deps.groqExecute ?? executeOriginGroqProvider;
    return execute(
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
