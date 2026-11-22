import { buildOriginExecutionPlan } from '../lib/orchestration/OriginExecutionPolicy.js';
import { executeOriginProviderWithFailover } from '../legacy/originProviderFailover.js';
import { OriginProviderError } from '../legacy/originProviderClient.js';

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
 * Failures are returned as provider error codes, never thrown and
 * never paraphrased: the caller (the analyzer tool) turns the code
 * into the step's failure so the run record names the real reason
 * (design §4.2).
 */

export type AgentModelCallInput = {
  /** The analysis instruction for this call (system role). */
  instruction: string;
  /** The user-role payload: one data chunk, verbatim. */
  userText: string;
  /** Goal text the execution plan is classified from. */
  goal: string;
};

export type AgentModelCallResult =
  | { ok: true; text: string }
  | { ok: false; code: string };

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
        groqCapacityAllocation: 'agent-analyzer-chunk',
        messages: [{ role: 'user', content: input.userText }],
      }, env);
      const text = typeof result.text === 'string' ? result.text : '';
      if (!text.trim()) return { ok: false, code: 'PROVIDER_INVALID_RESPONSE' };
      return { ok: true, text };
    } catch (error) {
      if (error instanceof OriginProviderError) return { ok: false, code: error.code };
      return { ok: false, code: 'PROVIDER_INTERNAL_ERROR' };
    }
  };
}
