import { buildOriginExecutionPlan } from '../lib/orchestration/OriginExecutionPolicy.js';
import { executeOriginProviderWithFailover } from '../legacy/originProviderFailover.js';
import {
  buildOriginProviderFailureDiagnostic,
  OriginProviderError,
  type OriginGroqCapacityAllocation,
  type OriginProviderAttemptDiagnostic,
  type OriginRateLimitSnapshot,
} from '../legacy/originProviderClient.js';

/**
 * The agent data steps' only model path (agent file-input foundation,
 * F2; design AGENT_FILE_INPUT_DESIGN_2026-11-18 §3.3, J8).
 *
 * A thin adapter over the chat's own failover dispatcher, so an
 * analyzer chunk call inherits exactly the chat's routing: the stopped
 * primary disposition, the Cloudflare → Groq free ZDR routes, the
 * shared total budget, and the S-1 Groq-first switch when it is
 * enabled for a request of this shape. No new provider, endpoint or
 * credential exists on this path, and the plan is built by the same
 * execution-policy builder the research synthesis uses — a plan that
 * cannot prove its free/ZDR evidence fails closed here with the
 * builder's code, before any transport happens.
 *
 * The analyzer's instruction is compact by construction (≤1,700
 * chars), so the same text serves as the route-3 substitute
 * instruction: route 3 receives the compact form instead of a long
 * assembled instruction that would press against its tokens/minute
 * ceiling.
 *
 * Every call through this adapter is an analyzer chunk call, so the
 * request carries the route-3 capacity allocation hint
 * (groqCapacityAllocation): while the D-1 switch
 * (ORIGIN_GROQ_PACING_ALLOCATION_ENABLED) is on, the Groq executor
 * plans these calls onto the rotation model's separate quota bucket
 * and paces them against the per-minute windows — this call kind is
 * the one whose output is verified mechanically downstream, which is
 * what qualifies it for the weaker bucket. With the switch off (the
 * default), the hint is inert and the routing above is inherited
 * exactly, unchanged.
 *
 * Alternating allocation (design CAPACITY_RATE_LIMIT_QUANTIFICATION_
 * 2026-11-22 §2-C): while ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_
 * ENABLED is exactly "true", a call that carries its chunk's
 * deterministic global index alternates the hint by that index —
 * even indexes keep the D-1 hint (rotation bucket first), odd indexes
 * take the primary-first mirror — so a step's first sends spread
 * across both per-minute buckets instead of concentrating on one. The
 * index derives from the approved plan (the step's chunkOffset plus
 * the position inside its range), never from call order or timing,
 * so a resumed step assigns every chunk to the same first bucket it
 * had before the resume. With the switch off (the default), or when
 * a caller supplies no index, every call carries the D-1 hint
 * exactly as before.
 *
 * Failures are returned as provider error codes, never thrown and
 * never paraphrased: the caller (the analyzer tool) turns the code
 * into the step's failure so the run record names the real reason
 * (design §4.2).
 *
 * A failure that comes from a provider error also carries the
 * dispatch's failover attempt evidence (AGORA timeout observability,
 * diagnosis AGENT_AGORA_PROVIDER_TIMEOUT_DIAGNOSIS_2026-11-23 §5.3):
 * until now this adapter returned only the final code, so which route
 * was tried, what each attempt returned and how long it took never
 * reached the step record, and a step timeout could only ever be
 * triaged as "some composite of calls and waits". The evidence is
 * the provider layer's own whitelisted diagnostic shape
 * (buildOriginProviderFailureDiagnostic) — route and model
 * identifiers, outcome, error code, duration, transport count —
 * never a request or response body.
 *
 * A rate-limited failure also carries the provider-stated recovery
 * time (multitask wave 4, design AGENT_QUOTA_HOLD_WAVE4_2026-11-25):
 * the provider layer already observes it — the `Retry-After` header
 * on the error itself and the `x-ratelimit-*` reset seconds in the
 * rate-limit snapshots (the same observations the D-0 capacity
 * ledger records) — but this adapter used to return only the
 * failure code, so the run advancer's rate-limit hold could record
 * nothing but its per-minute floor. `quotaRecoverySeconds` below is
 * that observation, carried through unchanged: a number the
 * provider stated, never one this layer invents.
 */

export const ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_ENABLED_ENV = 'ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_ENABLED' as const;

/** The alternating-allocation switch (design §2-C), in the house
 * style: only the exact string "true" enables it; anything else —
 * including the variable being unregistered — is OFF, and OFF keeps
 * every chunk call on the original D-1 hint. */
export function agentAnalyzerAlternatingAllocationEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_ENABLED_ENV] === 'true';
}

/**
 * The allocation hint for one analyzer chunk call (design §2-C).
 * Without a usable chunk index, or with the alternating switch off,
 * the result is always the original D-1 hint — the pre-measure
 * behavior. With both, the hint alternates deterministically by the
 * chunk's global index: even → rotation bucket first, odd → primary
 * bucket first.
 */
export function agentAnalyzerCapacityAllocation(
  chunkIndex: number | undefined,
  env: NodeJS.ProcessEnv,
): OriginGroqCapacityAllocation {
  if (!agentAnalyzerAlternatingAllocationEnabled(env)) return 'agent-analyzer-chunk';
  if (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return 'agent-analyzer-chunk';
  }
  return chunkIndex % 2 === 1 ? 'agent-analyzer-chunk-primary' : 'agent-analyzer-chunk';
}

export type AgentModelCallInput = {
  /** The analysis instruction for this call (system role). */
  instruction: string;
  /** The user-role payload: one data chunk, verbatim. */
  userText: string;
  /** Goal text the execution plan is classified from. */
  goal: string;
  /**
   * The chunk's deterministic global index within its attachment set
   * (the analyzer step's chunkOffset plus the position inside its
   * range — equivalently, the chunk list's own index). Used only to
   * alternate the route-3 allocation hint (design §2-C); absent or
   * invalid values keep the original D-1 hint for the call.
   */
  chunkIndex?: number;
};

/** Which route and model actually served one model call (coverage
 * observability follow-on, diagnosis 2026-11-23): the dispatch's
 * own routing evidence, reduced to the two identifiers. Until now
 * a successful call reported only its text, so which model produced
 * an analyzer step's rows was recorded nowhere and a coverage
 * failure could not be attributed past "the model". Identifiers
 * only — never a request or response body. */
export type AgentModelServing = {
  providerId: string;
  modelId?: string;
};

/** The slug shape every downstream carrier of a serving accepts:
 * the analyzer's execution trace and the run record both validate
 * provider ids against this exact pattern. Routing evidence speaks
 * in provider display names instead ("Cloudflare", "Groq",
 * "OpenRouter"), so a serving reduced without normalization was
 * rejected at every carrier's entrance and the trace never
 * survived into a record (Basel coverage diagnosis 2026-11-24). */
const AGENT_MODEL_PROVIDER_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** Normalizes a provider display name to the slug the serving
 * carriers accept: lowercased, runs of characters outside
 * [a-z0-9-] collapsed to a single hyphen, edge hyphens trimmed. A
 * name that leaves nothing slug-shaped behind contributes no
 * serving at all — the fail-soft direction, as with malformed
 * evidence: an unattributable call is better than a fabricated
 * identifier. */
function providerSlugFromDisplayName(provider: string): string | undefined {
  const slug = provider
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return AGENT_MODEL_PROVIDER_SLUG_PATTERN.test(slug) ? slug : undefined;
}

/** Reduces a dispatch result's routing evidence to the serving
 * identifiers. The provider arrives as the provider layer's
 * display name and is normalized to its slug here, at the one
 * entrance every serving passes through, so the recorded
 * identifiers are the slug vocabulary the rest of the system
 * validates against. Anything that is not an object carrying a
 * non-empty provider string — or whose provider name reduces to
 * no slug — contributes nothing, in the fail-soft style of the
 * attempt evidence below. */
export function servingFromRoutingEvidence(evidence: unknown): AgentModelServing | undefined {
  if (!evidence || typeof evidence !== 'object') return undefined;
  const { provider, servedModel } = evidence as { provider?: unknown; servedModel?: unknown };
  if (typeof provider !== 'string' || provider.length === 0) return undefined;
  const providerId = providerSlugFromDisplayName(provider);
  if (providerId === undefined) return undefined;
  return {
    providerId,
    ...(typeof servedModel === 'string' && servedModel.length > 0 ? { modelId: servedModel } : {}),
  };
}

export type AgentModelCallResult =
  | { ok: true; text: string; serving?: AgentModelServing }
  | {
      ok: false;
      code: string;
      /** The failover attempts of the dispatch that failed, in the
       * provider layer's whitelisted diagnostic shape. Present only
       * when the failure came from a provider error that recorded
       * attempts; a plan-level refusal (no transport happened)
       * carries none. */
      providerAttempts?: readonly OriginProviderAttemptDiagnostic[];
      /** Seconds until the exhausted provider window refills, as
       * stated by the provider itself (Retry-After / rate-limit
       * reset headers), reduced by
       * `quotaRecoverySecondsFromProviderError`. Present only when
       * the failing dispatch actually reported a recovery; absent
       * means "not observed", never "recovers immediately". */
      quotaRecoverySeconds?: number;
    };

/**
 * The failover attempt evidence of a failed dispatch, reduced by the
 * provider layer's own whitelist builder. Returns undefined for
 * anything that is not a provider error, and for a provider error
 * whose dispatch recorded no attempts — the caller then reports the
 * bare code exactly as before this evidence existed.
 */
export function failoverAttemptsFromProviderError(
  error: unknown,
): readonly OriginProviderAttemptDiagnostic[] | undefined {
  if (!(error instanceof OriginProviderError)) return undefined;
  const { failoverAttempts } = buildOriginProviderFailureDiagnostic(error);
  return failoverAttempts.length > 0 ? failoverAttempts : undefined;
}

/**
 * The reset seconds of one rate-limit snapshot's EXHAUSTED
 * dimensions: a dimension's reset counts only when the same
 * snapshot reports that dimension's remaining amount as exactly 0.
 * A reset for a dimension that still has room describes a window
 * that is not the binding one, and a snapshot that reports no
 * remaining amount proves no exhaustion — neither may stand in for
 * the recovery of a quota that actually ran out.
 */
function exhaustedDimensionResetSeconds(snapshot: OriginRateLimitSnapshot | undefined): number | undefined {
  if (!snapshot) return undefined;
  let recovery: number | undefined;
  const consider = (seconds: number | undefined) => {
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      recovery = recovery === undefined ? seconds : Math.max(recovery, seconds);
    }
  };
  if (snapshot.remainingRequests === 0) consider(snapshot.resetRequestsSeconds);
  if (snapshot.remainingTokens === 0) consider(snapshot.resetTokensSeconds);
  return recovery;
}

/**
 * The provider-stated recovery time of a failed dispatch, in whole
 * seconds (rounded up: a fractional statement still means the
 * window is closed for that fraction). Sources, all observed by
 * the provider layer on this very dispatch — nothing is estimated
 * here:
 * - the error's own `Retry-After` (`retryAfterSeconds`);
 * - the failure diagnostic's own rate-limit snapshot, for its
 *   exhausted dimensions;
 * - each failover attempt that hit a rate limit (flagged
 *   `rateLimitHit` or coded PROVIDER_RATE_LIMITED), for its
 *   exhausted dimensions.
 * The recovery of a multi-route dispatch is the LONGEST of these:
 * the dispatch failed because every route was unavailable, so the
 * quota is usable again only when the last of the exhausted
 * windows refills. Returns undefined when nothing was observed.
 */
export function quotaRecoverySecondsFromProviderError(error: unknown): number | undefined {
  if (!(error instanceof OriginProviderError)) return undefined;
  let recovery: number | undefined;
  const consider = (seconds: number | undefined) => {
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      recovery = recovery === undefined ? seconds : Math.max(recovery, seconds);
    }
  };
  consider(error.retryAfterSeconds);
  const diagnostic = buildOriginProviderFailureDiagnostic(error);
  consider(exhaustedDimensionResetSeconds(diagnostic.rateLimit));
  for (const attempt of diagnostic.failoverAttempts) {
    if (attempt.rateLimitHit !== true && attempt.errorCode !== 'PROVIDER_RATE_LIMITED') continue;
    consider(exhaustedDimensionResetSeconds(attempt.rateLimit));
  }
  return recovery === undefined ? undefined : Math.ceil(recovery);
}

/** The injectable seam the tools consume; production wiring leaves it
 * unset and the real failover-backed executor below is used. */
export type AgentModelExecutor = (input: AgentModelCallInput) => Promise<AgentModelCallResult>;

export function createAgentModelExecutor(env: NodeJS.ProcessEnv): AgentModelExecutor {
  return async (input: AgentModelCallInput): Promise<AgentModelCallResult> => {
    const planned = buildOriginExecutionPlan(
      { goal: input.goal, requiresCodeChanges: false, requiresFreshResearch: false, containsSecrets: false },
      { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) },
      undefined,
      { nowMs: Date.now() },
    );
    if (planned.ok !== true) return { ok: false, code: planned.code };
    try {
      const result = await executeOriginProviderWithFailover({
        plan: planned.plan,
        systemInstruction: input.instruction,
        groqSystemInstruction: input.instruction,
        groqCapacityAllocation: agentAnalyzerCapacityAllocation(input.chunkIndex, env),
        messages: [{ role: 'user', content: input.userText }],
      }, env);
      const text = typeof result.text === 'string' ? result.text : '';
      if (!text.trim()) return { ok: false, code: 'PROVIDER_INVALID_RESPONSE' };
      const serving = servingFromRoutingEvidence(result.routingEvidence);
      return { ok: true, text, ...(serving ? { serving } : {}) };
    } catch (error) {
      if (error instanceof OriginProviderError) {
        const providerAttempts = failoverAttemptsFromProviderError(error);
        const quotaRecoverySeconds = quotaRecoverySecondsFromProviderError(error);
        return {
          ok: false,
          code: error.code,
          ...(providerAttempts ? { providerAttempts } : {}),
          ...(quotaRecoverySeconds !== undefined ? { quotaRecoverySeconds } : {}),
        };
      }
      return { ok: false, code: 'PROVIDER_INTERNAL_ERROR' };
    }
  };
}
