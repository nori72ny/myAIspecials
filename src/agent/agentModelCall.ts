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

export type AgentModelCallResult =
  | { ok: true; text: string }
  | {
      ok: false;
      code: string;
      /** The failover attempts of the dispatch that failed, in the
       * provider layer's whitelisted diagnostic shape. Present only
       * when the failure came from a provider error that recorded
       * attempts; a plan-level refusal (no transport happened)
       * carries none. */
      providerAttempts?: readonly OriginProviderAttemptDiagnostic[];
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
      return { ok: true, text };
    } catch (error) {
      if (error instanceof OriginProviderError) {
        const providerAttempts = failoverAttemptsFromProviderError(error);
        return { ok: false, code: error.code, ...(providerAttempts ? { providerAttempts } : {}) };
      }
      return { ok: false, code: 'PROVIDER_INTERNAL_ERROR' };
    }
  };
}
