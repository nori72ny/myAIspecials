import { buildOriginExecutionPlan } from '../lib/orchestration/OriginExecutionPolicy.js';
import { executeOriginProviderWithFailover } from '../legacy/originProviderFailover.js';
import {
  buildOriginProviderFailureDiagnostic,
  OriginProviderError,
  type OriginGroqCapacityAllocation,
  type OriginProviderAttemptDiagnostic,
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
 * A failure also carries the final error's own diagnostic detail
 * from the same builder — how the last route's completion ended
 * (finishReason) and how many of its completion tokens went to
 * reasoning (usageReasoningTokens) (Basel failure diagnosis
 * 2026-11-26, 案C): until now the executor read only the attempt
 * list out of the diagnostic and discarded exactly these two
 * fields, so an empty-body failure could not be told apart as
 * "length — the reasoning ate the budget" versus "stop, but
 * empty" after the fact.
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

/**
 * Whether a model call is one analyzer chunk call, identified by a
 * usable chunk index — the same validity rule the allocation hint
 * above applies. The analyzer's chunk calls (and their parse-repair
 * retries) always carry the chunk's global index; the reconciler's
 * calls never do. The executor marks chunk calls with
 * `analyzerChunkRequest` so the provider routes can apply the
 * completion-budget floor (design AGENT_BASEL_BUDGET_FLOOR_DESIGN_
 * 2026-11-27).
 */
export function isAgentAnalyzerChunkCall(chunkIndex: number | undefined): boolean {
  return typeof chunkIndex === 'number' && Number.isInteger(chunkIndex) && chunkIndex >= 0;
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
   * range — equivalently, the chunk list's own index). Used to
   * alternate the route-3 allocation hint (design §2-C) and to mark
   * the dispatch as an analyzer chunk call for the completion-budget
   * floor (design AGENT_BASEL_BUDGET_FLOOR_DESIGN_2026-11-27);
   * absent or invalid values keep the original D-1 hint for the
   * call and carry no budget mark — the reconciler's calls, which
   * pass no chunk index, are exactly that shape.
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

/**
 * The final provider failure's own diagnostic detail (Basel
 * failure diagnosis 2026-11-26, 案C): how the last route's
 * completion ended and how many of its completion tokens went
 * to reasoning. The values arrive pre-whitelisted from the
 * provider layer's diagnostic builder — a closed finish-reason
 * vocabulary and a bounded token count — never a request or
 * response body. Observability only: no caller may branch on
 * it, exactly like the attempt evidence and the timings.
 */
export type AgentModelProviderFailureDetail = {
  finishReason?: string;
  usageReasoningTokens?: number;
};

/**
 * The cap on the dispatch timings one step's result carries (D7
 * countermeasure A): an analyzer step dispatches at most 2 chunks
 * × 2 logical calls (first + parse repair) × 3 transient-retry
 * dispatches = 12, a reconciler step at most 2 × 3 = 6. The run
 * record enforces the same bound on its side
 * (MAX_AGENT_RUN_LIVE_MODEL_CALLS); this cap only keeps the tool
 * result itself small.
 */
export const MAX_AGENT_MODEL_CALL_TIMINGS_PER_STEP = 12;

/**
 * One dispatch's timing evidence (D7 countermeasure A, diagnosis
 * AGENT_D7_DIAGNOSIS_2026-11-25 §5/§6): the route and model the
 * dispatch is attributable to, whether it succeeded or failed
 * (with the failure's code), and the dispatch's measured
 * wall-clock duration. Until now a successful dispatch reported
 * only its text and a failed one only its final code plus — on the
 * provider-error path — its failover attempts, so how long a
 * step's provider calls took could never be separated from
 * ORIGIN-side waiting. Identifiers, a closed outcome, a code and
 * a duration only — never a request or response body, exactly
 * like the serving and attempt evidence above.
 */
export type AgentModelCallTiming = {
  providerId: string;
  modelId?: string;
  outcome: 'succeeded' | 'failed';
  errorCode?: string;
  durationMs: number;
};

/**
 * Reduces one dispatch's evidence to its timing entry. A success
 * is attributed to its serving; a failure to the last failover
 * attempt that was actually dispatched (outcome not `skipped`) —
 * the attempt that determined the dispatch's outcome, the same
 * reduction the analyzer's execution trace applies to a failed
 * dispatch's servings (D8). A dispatch with neither (a plan-level
 * refusal, a non-provider error, an injected double) contributes
 * no entry: no entry at all is better than a fabricated
 * identifier, in the fail-soft style of the serving reduction.
 */
export function modelCallTimingFromDispatch(input: {
  serving?: AgentModelServing;
  providerAttempts?: readonly OriginProviderAttemptDiagnostic[];
  code?: string;
  durationMs: number;
}): AgentModelCallTiming | undefined {
  const durationMs = Number.isFinite(input.durationMs)
    ? Math.max(0, Math.floor(input.durationMs))
    : 0;
  if (input.serving) {
    return {
      providerId: input.serving.providerId,
      ...(input.serving.modelId ? { modelId: input.serving.modelId } : {}),
      outcome: input.code === undefined ? 'succeeded' : 'failed',
      ...(input.code !== undefined ? { errorCode: input.code } : {}),
      durationMs,
    };
  }
  const attempts = input.providerAttempts ?? [];
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (!attempt || attempt.outcome === 'skipped') continue;
    if (typeof attempt.providerId !== 'string' || attempt.providerId.length === 0) continue;
    return {
      providerId: attempt.providerId,
      ...(typeof attempt.modelId === 'string' && attempt.modelId.length > 0 ? { modelId: attempt.modelId } : {}),
      outcome: 'failed',
      ...(input.code !== undefined ? { errorCode: input.code } : {}),
      durationMs,
    };
  }
  return undefined;
}

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
  | {
      ok: true;
      text: string;
      serving?: AgentModelServing;
      /** The dispatch's timing evidence (D7 countermeasure A).
       * Present when the dispatch is attributable to a route;
       * observability only — no caller may branch on it. */
      timing?: AgentModelCallTiming;
    }
  | {
      ok: false;
      code: string;
      /** The failover attempts of the dispatch that failed, in the
       * provider layer's whitelisted diagnostic shape. Present only
       * when the failure came from a provider error that recorded
       * attempts; a plan-level refusal (no transport happened)
       * carries none. */
      providerAttempts?: readonly OriginProviderAttemptDiagnostic[];
      /** The final failure's diagnostic detail (案C): how the
       * last route's completion ended and how much of it went
       * to reasoning. Present only when the failure came from a
       * provider error whose diagnostic carried either field;
       * a plan-level refusal (no transport happened) carries
       * none. */
      providerFailureDetail?: AgentModelProviderFailureDetail;
      /** The dispatch's timing evidence (D7 countermeasure A):
       * present when the failure is attributable to a route — a
       * provider error with dispatched attempts, or an invalid
       * response from a known serving. A plan-level refusal (no
       * transport happened) carries none. */
      timing?: AgentModelCallTiming;
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
 * The final failure's diagnostic detail (案C), reduced by the
 * same whitelist builder as the attempt evidence above: the
 * finish reason and the reasoning-token count of the error the
 * dispatch surfaced. Returns undefined for anything that is not
 * a provider error, and for a provider error whose diagnostic
 * carried neither field — the caller then reports the failure
 * exactly as before this evidence existed.
 */
export function providerFailureDetailFromProviderError(
  error: unknown,
): AgentModelProviderFailureDetail | undefined {
  if (!(error instanceof OriginProviderError)) return undefined;
  const diagnostic = buildOriginProviderFailureDiagnostic(error);
  const detail: AgentModelProviderFailureDetail = {};
  if (diagnostic.finishReason) detail.finishReason = diagnostic.finishReason;
  if (diagnostic.usageReasoningTokens !== undefined) detail.usageReasoningTokens = diagnostic.usageReasoningTokens;
  return Object.keys(detail).length > 0 ? detail : undefined;
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
    // Dispatch timing (D7 countermeasure A): the measured span is
    // the failover dispatch itself — the provider call the step
    // waited on. Plan building before it is ORIGIN-side work and
    // stays outside the span, which is exactly the separation the
    // timing exists to make.
    const dispatchStartedAt = Date.now();
    try {
      const result = await executeOriginProviderWithFailover({
        plan: planned.plan,
        systemInstruction: input.instruction,
        groqSystemInstruction: input.instruction,
        groqCapacityAllocation: agentAnalyzerCapacityAllocation(input.chunkIndex, env),
        // Analyzer chunk calls — identified by the same usable chunk
        // index the allocation hint keys on — carry the budget-floor
        // mark (design AGENT_BASEL_BUDGET_FLOOR_DESIGN_2026-11-27);
        // calls without one (the reconciler) stay unmarked and keep
        // the task-type budget exactly.
        ...(isAgentAnalyzerChunkCall(input.chunkIndex) ? { analyzerChunkRequest: true } : {}),
        messages: [{ role: 'user', content: input.userText }],
      }, env);
      const durationMs = Date.now() - dispatchStartedAt;
      const text = typeof result.text === 'string' ? result.text : '';
      const serving = servingFromRoutingEvidence(result.routingEvidence);
      if (!text.trim()) {
        const timing = modelCallTimingFromDispatch({ serving, code: 'PROVIDER_INVALID_RESPONSE', durationMs });
        return { ok: false, code: 'PROVIDER_INVALID_RESPONSE', ...(timing ? { timing } : {}) };
      }
      const timing = modelCallTimingFromDispatch({ serving, durationMs });
      return { ok: true, text, ...(serving ? { serving } : {}), ...(timing ? { timing } : {}) };
    } catch (error) {
      if (error instanceof OriginProviderError) {
        const providerAttempts = failoverAttemptsFromProviderError(error);
        const providerFailureDetail = providerFailureDetailFromProviderError(error);
        const timing = modelCallTimingFromDispatch({
          providerAttempts,
          code: error.code,
          durationMs: Date.now() - dispatchStartedAt,
        });
        return {
          ok: false,
          code: error.code,
          ...(providerAttempts ? { providerAttempts } : {}),
          ...(providerFailureDetail ? { providerFailureDetail } : {}),
          ...(timing ? { timing } : {}),
        };
      }
      return { ok: false, code: 'PROVIDER_INTERNAL_ERROR' };
    }
  };
}
