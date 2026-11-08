import type { AgentRunHold, AgentRunQuotaLedger, AgentRunRecord } from './agentRunRecord.js';
import type { ToolName } from './toolRegistry.js';

/**
 * Quota gate for durable agent runs (multitask Phase 1, PR 1-D; design
 * §2.4, §9.3, §9.4).
 *
 * Every execution of a persisted run passes through `advanceAgentRun`, so
 * the gate lives there: before a step that consumes a scarce free quota
 * may run, the step's declared charge is checked against the provider's
 * confirmed free limit, using the usage aggregated from the owner's run
 * quota ledgers (`quota_ledger`, the per-run accounting PR-1 defined and
 * PR 1-B journals into). When the charge would exceed the limit, the step
 * is not executed and the run is held instead — reason `quota_exhausted`,
 * resume condition `quota_reset` for that provider — through the same
 * hold mechanism as PR 1-C. Nothing is executed on a guess (fail closed).
 *
 * What a step consumes (design §1.6, §9.1): the agent planner is
 * deterministic and six of the eight tools are local-only, so a run's
 * scarce-quota consumption today is exactly two cost classes:
 * - `search` (web_search_grounding): Tavily credits when the grounded
 *   search layer takes the Tavily route. Charged at the design §9.3
 *   accounting unit of 1 credit per executed step. A step can also be
 *   served by keyless routes (0 credits), so the charge is a deliberate
 *   over-count: the gate may hold earlier than strictly necessary, never
 *   later.
 * - `delegated-job` (code_interpreter): a V14 coding job whose internal
 *   provider consumption is real but UNMEASURED (design §9.1, §9.3). No
 *   numeric charge is invented for it; the interim control the design
 *   prescribes — cap concurrent delegations at 1 — is applied as at most
 *   one delegated step per advance (serialization). Known limitation,
 *   stated plainly: delegated-job consumption is not numerically gated
 *   until it is measured.
 * The model providers (OpenRouter, Cloudflare, Groq) are defined below
 * with their confirmed limits so a future `model:<provider>` cost class
 * (design §2.4) plugs into the same gate without new machinery; no
 * current step charges them, because no current step calls them.
 *
 * Counter drift (design §8.5, §9.4): ledger-based usage can drift from
 * the providers' own counters (chat shares the same accounts and does
 * not write run ledgers), so usage here is a floor with a conservative
 * bias, never an overstatement of remaining capacity:
 * - A record's lifetime ledger is attributed to the window of its last
 *   update. That can only overstate the current window's usage.
 * - Providers whose daily reset boundary is not confirmed in the
 *   evidence use a rolling 24-hour window, which over-counts relative to
 *   any fixed daily reset — the safe direction.
 * - Aggregation reads at most the owner's 100 most recent live records
 *   (the store's list bound); usage in older records is not counted,
 *   which is the one under-count direction and is bounded by record TTL.
 * The `resetAt` carried by a hold is an estimate, exactly as design §8.5
 * frames it: the gate re-evaluates real ledger state on every advance,
 * so an optimistic estimate can only cause a re-hold, never an overrun.
 */

export type AgentRunQuotaWindowKind = 'utc-day' | 'utc-month' | 'rolling-24h';

export interface AgentRunQuotaCounterDefinition {
  /** Confirmed free limit for the window. Never a guessed number. */
  limit: number;
  window: AgentRunQuotaWindowKind;
}

export interface AgentRunQuotaProviderDefinition {
  counters: Readonly<Record<string, AgentRunQuotaCounterDefinition>>;
}

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Confirmed free limits, each traceable to the evidence catalogs:
 * - tavily: free cap 1,000 credits/month with ORIGIN's own operative
 *   self-cap of 800 (src/search/originSearchProviderCatalog.ts, verified
 *   2026-11-07; basic search = 1 credit). The gate enforces the self-cap.
 * - openrouter: 50 requests/day at account level for the free models
 *   (design §0/§9; failed attempts consume it too). The daily reset
 *   boundary is not independently confirmed, so the window rolls.
 * - cloudflare: 10,000 Neurons/day per account on Workers Free
 *   (src/lib/orchestration/OriginCloudflareFreeModelCatalog.ts, official
 *   docs rechecked 2026-11-06). The pool resets at UTC midnight
 *   (09:00 JST), so the window is the UTC calendar day.
 * - groq: 1,000 requests/day and 200,000 tokens/day for
 *   openai/gpt-oss-120b (src/lib/orchestration/OriginGroqFreeModelCatalog.ts,
 *   verified live in the owner's console 2026-11-08). The 8,000
 *   tokens/minute rate ceiling is enforced by the Groq executor itself
 *   and is not a window quota, so it is not defined here. The daily
 *   reset boundary is not in the console evidence, so windows roll.
 */
export const AGENT_RUN_QUOTA_PROVIDERS: Readonly<Record<string, AgentRunQuotaProviderDefinition>> = Object.freeze({
  tavily: Object.freeze({
    counters: Object.freeze({
      credits: Object.freeze({ limit: 800, window: 'utc-month' as const }),
    }),
  }),
  openrouter: Object.freeze({
    counters: Object.freeze({
      requests: Object.freeze({ limit: 50, window: 'rolling-24h' as const }),
    }),
  }),
  cloudflare: Object.freeze({
    counters: Object.freeze({
      neurons: Object.freeze({ limit: 10_000, window: 'utc-day' as const }),
    }),
  }),
  groq: Object.freeze({
    counters: Object.freeze({
      requests: Object.freeze({ limit: 1_000, window: 'rolling-24h' as const }),
      tokens: Object.freeze({ limit: 200_000, window: 'rolling-24h' as const }),
    }),
  }),
});

/** Design §9.3 interim control for unmeasured delegated jobs: serialize. */
export const AGENT_RUN_MAX_DELEGATED_STEPS_PER_ADVANCE = 1;

export type AgentRunStepCostClass = 'local' | 'search' | 'delegated-job';

/** The design §2.4 cost-class declaration for every agent tool. */
export function agentRunStepCostClass(toolName: ToolName): AgentRunStepCostClass {
  switch (toolName) {
    case 'web_search_grounding':
      return 'search';
    case 'code_interpreter':
      return 'delegated-job';
    default:
      return 'local';
  }
}

export interface AgentRunQuotaCharge {
  provider: string;
  counter: string;
  units: number;
}

/**
 * The numeric charge a step declares against a provider quota, or null
 * when the step declares none. Only `search` declares one today (see the
 * module header for why, and for why `delegated-job` deliberately does
 * not invent a number).
 */
export function agentRunStepQuotaCharge(toolName: ToolName): AgentRunQuotaCharge | null {
  if (agentRunStepCostClass(toolName) === 'search') {
    return { provider: 'tavily', counter: 'credits', units: 1 };
  }
  return null;
}

/** The accounting window for a quota counter at an instant. */
export function agentRunQuotaWindow(kind: AgentRunQuotaWindowKind, now: number): { startsAt: number; resetsAt: number } {
  const date = new Date(now);
  switch (kind) {
    case 'utc-day': {
      const startsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      return { startsAt, resetsAt: startsAt + ROLLING_WINDOW_MS };
    }
    case 'utc-month': {
      const startsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
      const resetsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      return { startsAt, resetsAt };
    }
    case 'rolling-24h':
      // No fixed reset instant exists for a rolling window; `resetsAt`
      // here is only the window's own end. A blocked charge computes its
      // real estimate from the oldest contributing record instead.
      return { startsAt: now - ROLLING_WINDOW_MS, resetsAt: now };
  }
}

export interface AgentRunQuotaUsageSnapshot {
  /** Windowed usage per provider/counter, in quota-ledger shape. */
  usage: AgentRunQuotaLedger;
  /** Oldest `updatedAt` among the records contributing to each provider. */
  oldestContributionAt: Readonly<Record<string, number>>;
}

/**
 * Aggregates windowed quota usage from run records' lifetime ledgers.
 * A record contributes its full ledger to a counter's window when its
 * last update falls inside that window (see the module header for why
 * this attribution is conservative).
 */
export function snapshotAgentRunQuotaUsage(
  records: readonly AgentRunRecord[],
  now: number,
): AgentRunQuotaUsageSnapshot {
  const usage: AgentRunQuotaLedger = {};
  const oldestContributionAt: Record<string, number> = {};
  for (const [provider, definition] of Object.entries(AGENT_RUN_QUOTA_PROVIDERS)) {
    for (const [counter, counterDefinition] of Object.entries(definition.counters)) {
      const { startsAt } = agentRunQuotaWindow(counterDefinition.window, now);
      let total = 0;
      let oldest: number | undefined;
      for (const record of records) {
        const amount = record.quotaLedger[provider]?.[counter];
        if (typeof amount !== 'number' || amount <= 0) continue;
        if (record.updatedAt < startsAt) continue;
        total += amount;
        if (oldest === undefined || record.updatedAt < oldest) oldest = record.updatedAt;
      }
      if (total > 0) {
        (usage[provider] ??= {})[counter] = total;
        if (oldest !== undefined && (oldestContributionAt[provider] === undefined || oldest < oldestContributionAt[provider])) {
          oldestContributionAt[provider] = oldest;
        }
      }
    }
  }
  return { usage, oldestContributionAt };
}

export type AgentRunQuotaGateDecision =
  | { allowed: true }
  | {
      allowed: false;
      provider: string;
      counter: string;
      limit: number;
      /** Window usage + session charges + the charge being evaluated. */
      projected: number;
      /** Estimated instant the window frees capacity (design §8.5). */
      resetAt: number;
    };

/**
 * Decides whether one declared charge fits the provider's window:
 * aggregated window usage plus the charges already journaled during this
 * advance, plus the charge itself, must stay within the confirmed limit.
 * Charges against providers/counters the gate does not define are not
 * gated (the declarations above only ever produce defined ones).
 */
export function evaluateAgentRunQuotaCharge(input: {
  charge: AgentRunQuotaCharge;
  snapshot: AgentRunQuotaUsageSnapshot;
  sessionCharges?: AgentRunQuotaLedger;
  now: number;
}): AgentRunQuotaGateDecision {
  const { charge, snapshot, now } = input;
  const definition = AGENT_RUN_QUOTA_PROVIDERS[charge.provider]?.counters[charge.counter];
  if (!definition) return { allowed: true };
  const window = agentRunQuotaWindow(definition.window, now);
  const used = (snapshot.usage[charge.provider]?.[charge.counter] ?? 0)
    + (input.sessionCharges?.[charge.provider]?.[charge.counter] ?? 0);
  const projected = used + charge.units;
  if (projected <= definition.limit) return { allowed: true };
  const resetAt = definition.window === 'rolling-24h'
    ? (snapshot.oldestContributionAt[charge.provider] ?? now) + ROLLING_WINDOW_MS
    : window.resetsAt;
  return {
    allowed: false,
    provider: charge.provider,
    counter: charge.counter,
    limit: definition.limit,
    projected,
    resetAt,
  };
}

/**
 * The 1-C hold a quota-blocked run is parked with (design §8.3 entry 4).
 * `priorResumeAttempts` is the count the record carries from its most
 * recent hold episode (design §8.6, PR 1-G): a run that was resumed and
 * fell back to a quota hold counts that as one more failed resume
 * attempt, while a run held for the first time starts at 0.
 */
export function agentRunQuotaHold(
  decision: Extract<AgentRunQuotaGateDecision, { allowed: false }>,
  now: number,
  priorResumeAttempts?: number | null,
): AgentRunHold {
  return {
    reason: 'quota_exhausted',
    resumeCondition: { kind: 'quota_reset', provider: decision.provider, resetAt: decision.resetAt },
    heldSince: now,
    resumeAttempts: priorResumeAttempts === null || priorResumeAttempts === undefined ? 0 : priorResumeAttempts + 1,
  };
}

/** Adds one executed step's charge to a working copy of a run ledger. */
export function addAgentRunQuotaCharge(ledger: AgentRunQuotaLedger, charge: AgentRunQuotaCharge): AgentRunQuotaLedger {
  return {
    ...ledger,
    [charge.provider]: {
      ...(ledger[charge.provider] ?? {}),
      [charge.counter]: (ledger[charge.provider]?.[charge.counter] ?? 0) + charge.units,
    },
  };
}
