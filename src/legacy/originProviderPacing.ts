import { ORIGIN_GROQ_FREE_PROVIDER_ID } from "../lib/orchestration/OriginExecutionPolicy.js";
import { getOriginCapacityLedgerSnapshot } from "./originProviderCapacityLedger.js";

/**
 * Route-3 pacing and planned allocation (FREE_CAPACITY_EXPANSION_DESIGN_2026-11-22,
 * stage D-1). The design's diagnosis was that the free routes' per-minute
 * windows are managed nowhere between sends: the only tokens/minute check
 * was the single-request pre-send gate inside each executor, so a burst of
 * analyzer chunk calls could exhaust a model's minute window and fail a
 * step that a short wait — or the same send on the sibling model's idle
 * bucket — would have carried through.
 *
 * This module is the preventive side of that fix, in two parts:
 *
 * 1. A per-model rolling-window ledger of estimated send footprints. A
 *    send's footprint is the same conservative estimate the pre-send gate
 *    uses (estimated input tokens plus the completion budget it was
 *    capped to), recorded at the moment the send is decided. Against the
 *    model's tokens/minute ceiling, pacing plans on a safety line of 80%
 *    of the ceiling: a send that fits under the line proceeds at once, a
 *    send that does not fits after the earliest window expiry that makes
 *    room, and the caller waits that long — bounded by a cumulative
 *    per-dispatch ceiling (ORIGIN_PROVIDER_PACING_MAX_WAIT_MS, aligned
 *    with the analyzer retry's per-step ceiling). Past that ceiling the
 *    caller proceeds unpaced: pacing is prevention, never a new hard
 *    gate, so a pathological window degrades to exactly the pre-D-1
 *    behavior (send, and let the provider's answer classify the result).
 *    A single send whose own footprint exceeds the safety line is never
 *    paced at all — the per-request gate already caps it at the real
 *    ceiling, and no amount of waiting would change its size.
 *
 * 2. The D-0 capacity ledger as a correcting input. The window above is
 *    process-local, and production is serverless: sibling processes burn
 *    the same provider window invisibly. When the provider's own latest
 *    report (the rate-limit snapshot D-0 recorded for this model) is
 *    still inside its stated reset horizon, the booked amount it implies
 *    (limit − remaining) is taken as a floor for the window's booked
 *    total. The maximum — never the sum — of the local and observed
 *    figures governs, because the provider's figure already includes
 *    this process's own sends; summing would double-count them. This is
 *    the only use of the observed figure: it can make pacing wait
 *    earlier, never later, and it moves no stop line.
 *
 * Everything here is inert unless the caller engages it. The Groq
 * executor engages pacing and allocation only for requests the agent
 * model-call adapter marked as analyzer chunk calls, and only while
 * ORIGIN_GROQ_PACING_ALLOCATION_ENABLED is exactly "true" (see
 * originGroqProviderClient.ts). Direct chat keeps the previous behavior
 * under every switch state.
 */

/** Kill switch for stage D-1 (pacing + planned allocation on the Groq route). */
export const ORIGIN_GROQ_PACING_ALLOCATION_ENV = "ORIGIN_GROQ_PACING_ALLOCATION_ENABLED" as const;

/** True only for the exact value "true"; every other value keeps D-1 off. */
export function isOriginGroqPacingAllocationEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_GROQ_PACING_ALLOCATION_ENV] === "true";
}

/** The providers' per-minute buckets are rolling 60-second windows. */
export const ORIGIN_PROVIDER_PACING_WINDOW_MS = 60_000;

/**
 * Planning line inside the per-minute ceiling. The footprint estimator
 * (characters/2) tracks Japanese closely but can drift either way on
 * other text, so pacing plans against 80% of the ceiling and leaves the
 * remainder as estimation slack (design §4.3).
 */
export const ORIGIN_PROVIDER_PACING_SAFETY_RATIO = 0.8;

/**
 * Cumulative pacing-wait ceiling for one dispatch, aligned with the
 * analyzer transient retry's per-step ceiling
 * (AGENT_ANALYZER_TRANSIENT_RETRY_MAX_STEP_WAIT_MS). The two budgets are
 * independent by design: pacing waits are preventive (inside a dispatch,
 * before a send that would predictably be rejected), retry waits are
 * reactive (between dispatches, after a failure). Pacing exists to make
 * the retry fire less often; it does not consume the retry's budget, and
 * the retry does not consume pacing's. In the worst case they add, and
 * the sum stays bounded by the run advance's own duration cap — with
 * step artifacts persisted, an over-long step resumes on the next
 * advance instead of losing completed work.
 */
export const ORIGIN_PROVIDER_PACING_MAX_WAIT_MS = 60_000;

interface OriginProviderPacingEntry {
  modelId: string;
  atMs: number;
  tokens: number;
}

const pacingEntries: OriginProviderPacingEntry[] = [];

function prunePacingEntries(nowMs: number): void {
  const cutoff = nowMs - ORIGIN_PROVIDER_PACING_WINDOW_MS;
  for (let index = pacingEntries.length - 1; index >= 0; index -= 1) {
    if (pacingEntries[index].atMs <= cutoff) pacingEntries.splice(index, 1);
  }
}

/**
 * Records one send's estimated footprint against its model's rolling
 * window. Called at the moment the send is decided (after pacing has
 * cleared it), so failed and rejected sends book the window too — the
 * burst that precedes a rate-limit rejection is exactly what the window
 * exists to model. Non-positive or non-finite footprints record nothing.
 */
export function recordOriginProviderPacingSend(
  modelId: string,
  estimatedTokens: number,
  atMs: number = Date.now(),
): void {
  if (!modelId || !Number.isFinite(estimatedTokens) || estimatedTokens <= 0 || !Number.isFinite(atMs)) return;
  pacingEntries.push({ modelId, atMs, tokens: Math.round(estimatedTokens) });
  prunePacingEntries(atMs);
}

interface PacingWindowSlice {
  expiresAtMs: number;
  tokens: number;
}

function localWindowSlices(modelId: string, nowMs: number): PacingWindowSlice[] {
  const cutoff = nowMs - ORIGIN_PROVIDER_PACING_WINDOW_MS;
  return pacingEntries
    .filter((entry) => entry.modelId === modelId && entry.atMs > cutoff)
    .map((entry) => ({ expiresAtMs: entry.atMs + ORIGIN_PROVIDER_PACING_WINDOW_MS, tokens: entry.tokens }));
}

/**
 * The booked amount the provider itself reported for this model, when
 * the D-0 ledger holds a snapshot whose reset horizon is still ahead.
 * The snapshot's booked figure (limit − remaining) is a single amount
 * that stands until the provider's stated reset (or one window from the
 * observation when no reset was reported), then drops to zero — the
 * same expiry shape as a local entry, so the two compose.
 */
function observedWindowSlice(modelId: string, nowMs: number): PacingWindowSlice | null {
  const ledger = getOriginCapacityLedgerSnapshot(nowMs);
  const entry = ledger.rateLimits.find(
    (candidate) => candidate.providerId === ORIGIN_GROQ_FREE_PROVIDER_ID && candidate.modelId === modelId,
  );
  if (!entry || entry.observedAtMs > nowMs) return null;
  const { limitTokens, remainingTokens, resetTokensSeconds } = entry.snapshot;
  if (limitTokens === undefined || remainingTokens === undefined || limitTokens <= 0) return null;
  const tokens = Math.max(0, limitTokens - remainingTokens);
  if (tokens <= 0) return null;
  const expiresAtMs = entry.observedAtMs
    + (resetTokensSeconds !== undefined ? resetTokensSeconds * 1000 : ORIGIN_PROVIDER_PACING_WINDOW_MS);
  if (expiresAtMs <= nowMs) return null;
  return { expiresAtMs, tokens };
}

export type OriginProviderPacingDecision =
  | { action: "send" }
  | { action: "wait"; waitMs: number };

/**
 * Decides whether one send of `estimatedTokens` against `modelId` fits
 * the model's per-minute window now, under the safety line, or after
 * the earliest expiry that makes room. Pure with respect to the two
 * ledgers' current contents and `nowMs`; the caller owns waiting and
 * the cumulative wait budget.
 */
export function evaluateOriginProviderPacing(input: {
  modelId: string;
  estimatedTokens: number;
  limitTokensPerMinute: number;
  nowMs: number;
}): OriginProviderPacingDecision {
  const { modelId, estimatedTokens, limitTokensPerMinute, nowMs } = input;
  if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0
    || !Number.isFinite(limitTokensPerMinute) || limitTokensPerMinute <= 0) {
    return { action: "send" };
  }
  const safetyLine = Math.floor(limitTokensPerMinute * ORIGIN_PROVIDER_PACING_SAFETY_RATIO);
  // A single send larger than the safety line is governed by the
  // executor's per-request gate (which caps it at the real ceiling);
  // waiting cannot shrink it, so pacing never holds it.
  if (estimatedTokens > safetyLine) return { action: "send" };
  const locals = localWindowSlices(modelId, nowMs);
  const observed = observedWindowSlice(modelId, nowMs);
  const bookedAt = (atMs: number): number => Math.max(
    locals.reduce((sum, slice) => sum + (slice.expiresAtMs > atMs ? slice.tokens : 0), 0),
    observed && observed.expiresAtMs > atMs ? observed.tokens : 0,
  );
  if (bookedAt(nowMs) + estimatedTokens <= safetyLine) return { action: "send" };
  const candidates = [...new Set([
    ...locals.map((slice) => slice.expiresAtMs),
    ...(observed ? [observed.expiresAtMs] : []),
  ])].filter((expiresAtMs) => expiresAtMs > nowMs).sort((a, b) => a - b);
  for (const candidate of candidates) {
    if (bookedAt(candidate) + estimatedTokens <= safetyLine) {
      return { action: "wait", waitMs: candidate - nowMs };
    }
  }
  // No expiry makes room (defensive: with the single-send exemption
  // above, the post-expiry window is empty and always fits). Proceed
  // rather than wait forever.
  return { action: "send" };
}

/** Test seam: clears every recorded pacing entry. */
export function resetOriginProviderPacingForTests(): void {
  pacingEntries.length = 0;
}
