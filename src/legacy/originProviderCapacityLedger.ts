import type { OriginRateLimitSnapshot } from "./originProviderClient.js";

/**
 * Capacity observation foundation (FREE_CAPACITY_EXPANSION_DESIGN_2026-11-22,
 * stage D-0). Observation only: nothing in this module changes routing,
 * allocation, pacing, or any stop line. It exists so later stages can be
 * measured instead of guessed.
 *
 * Three records are kept, all in memory (per process, never persisted):
 *
 * 1. The latest rate-limit snapshot a provider actually reported, per
 *    provider/model. Groq answers carry `x-ratelimit-*` headers; parsing
 *    them here turns "how much is left" from an inference into an
 *    observation (source: "observed").
 * 2. A tracked estimate of the day's Cloudflare Neurons consumption,
 *    accumulated from the usage each composed route-2 result reports for
 *    itself. Per CAPACITY_SPEED_AUDIT_2026-11-17 (W-1) this is a LOWER
 *    bound: a 503 usage-reconciliation failure consumes Neurons the
 *    success-path usage never shows. The estimate is therefore labelled
 *    "estimated" until an account-actual figure is reconciled into it.
 * 3. That reconciliation: when an account-actual used-Neurons figure is
 *    observed (account API / console), `reconcileOriginCloudflareNeurons`
 *    records it together with the correction factor (actual / tracked)
 *    for the current budget day, so the tracked estimate can be read
 *    against reality instead of trusted blindly.
 *
 * The budget day follows the Workers Free reset: 09:00 JST (00:00 UTC) to
 * the next 09:00 JST. The tracked estimate and any reconciliation belong
 * to one budget day and roll over with it.
 *
 * The daily stop line (8,000 tracked Neurons, enforced by the agent quota
 * gate) is NOT moved by this module: while the account-actual cannot be
 * read on a steady basis, the correction stays informational.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * The budget-day key (YYYY-MM-DD) of the Workers Free budget day that
 * contains `nowMs`: the JST calendar date on which the current budget
 * day began (09:00 JST). Before 09:00 JST the budget day is the one that
 * began yesterday.
 */
export function originCapacityBudgetDayKey(nowMs: number): string {
  const jst = new Date(nowMs + JST_OFFSET_MS);
  let year = jst.getUTCFullYear();
  let month = jst.getUTCMonth();
  let day = jst.getUTCDate();
  if (jst.getUTCHours() < 9) {
    const previous = new Date(Date.UTC(year, month, day - 1));
    year = previous.getUTCFullYear();
    month = previous.getUTCMonth();
    day = previous.getUTCDate();
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function parseRateLimitCount(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

const DURATION_UNIT_SECONDS: Readonly<Record<string, number>> = {
  ns: 1e-9,
  us: 1e-6,
  "µs": 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
};

/**
 * Parses a rate-limit reset header into seconds. Groq reports resets as
 * Go-style durations ("2s", "1m30s", "500ms"); a bare number is read as
 * seconds. Anything else is unparsable and yields undefined — a reset is
 * never invented here.
 */
function parseRateLimitResetSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  const component = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;
  let totalSeconds = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = component.exec(trimmed)) !== null) {
    if (match.index !== consumed) return undefined;
    totalSeconds += Number(match[1]) * DURATION_UNIT_SECONDS[match[2]];
    consumed = component.lastIndex;
  }
  if (consumed !== trimmed.length || consumed === 0) return undefined;
  return Number.isFinite(totalSeconds) && totalSeconds >= 0 ? totalSeconds : undefined;
}

/**
 * Reads the rate-limit headers of one provider response into a snapshot.
 * Returns undefined when the response carried no usable rate-limit
 * header at all, so callers can distinguish "not reported" from a
 * reported zero. Only the six `x-ratelimit-*` fields are read; values
 * that do not parse are dropped field by field.
 */
export function parseOriginRateLimitHeaders(headers: Headers | null | undefined): OriginRateLimitSnapshot | undefined {
  if (!headers || typeof headers.get !== "function") return undefined;
  const snapshot: OriginRateLimitSnapshot = {};
  const limitRequests = parseRateLimitCount(headers.get("x-ratelimit-limit-requests"));
  if (limitRequests !== undefined) snapshot.limitRequests = limitRequests;
  const remainingRequests = parseRateLimitCount(headers.get("x-ratelimit-remaining-requests"));
  if (remainingRequests !== undefined) snapshot.remainingRequests = remainingRequests;
  const limitTokens = parseRateLimitCount(headers.get("x-ratelimit-limit-tokens"));
  if (limitTokens !== undefined) snapshot.limitTokens = limitTokens;
  const remainingTokens = parseRateLimitCount(headers.get("x-ratelimit-remaining-tokens"));
  if (remainingTokens !== undefined) snapshot.remainingTokens = remainingTokens;
  const resetRequestsSeconds = parseRateLimitResetSeconds(headers.get("x-ratelimit-reset-requests"));
  if (resetRequestsSeconds !== undefined) snapshot.resetRequestsSeconds = resetRequestsSeconds;
  const resetTokensSeconds = parseRateLimitResetSeconds(headers.get("x-ratelimit-reset-tokens"));
  if (resetTokensSeconds !== undefined) snapshot.resetTokensSeconds = resetTokensSeconds;
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

export interface OriginCapacityRateLimitEntry {
  providerId: string;
  modelId: string;
  snapshot: OriginRateLimitSnapshot;
  /** True when the response that carried this snapshot was itself a rate-limit rejection. */
  limitHit: boolean;
  observedAtMs: number;
  source: "observed";
}

export interface OriginCloudflareCapacityLedger {
  budgetDay: string;
  /** Lower-bound estimate accumulated from composed results' own usage (W-1). */
  trackedEstimateNeurons: number;
  /** Account-actual used Neurons for the budget day, when one was reconciled in. */
  accountActualNeurons?: number;
  /** accountActual / trackedEstimate at reconciliation time, when derivable. */
  correctionFactor?: number;
  reconciledAtMs?: number;
  /** "observed" once an account-actual figure has been reconciled for this budget day. */
  source: "observed" | "estimated";
}

export interface OriginCapacityLedgerSnapshot {
  rateLimits: readonly OriginCapacityRateLimitEntry[];
  cloudflareNeurons: OriginCloudflareCapacityLedger;
}

const rateLimitEntries = new Map<string, OriginCapacityRateLimitEntry>();

interface CloudflareLedgerState {
  budgetDay: string;
  trackedEstimateNeurons: number;
  accountActualNeurons?: number;
  correctionFactor?: number;
  reconciledAtMs?: number;
}

let cloudflareState: CloudflareLedgerState | null = null;

function cloudflareStateFor(nowMs: number): CloudflareLedgerState {
  const budgetDay = originCapacityBudgetDayKey(nowMs);
  if (!cloudflareState || cloudflareState.budgetDay !== budgetDay) {
    cloudflareState = { budgetDay, trackedEstimateNeurons: 0 };
  }
  return cloudflareState;
}

/** Records the rate-limit snapshot one provider response reported, per provider/model. */
export function recordOriginRateLimitObservation(input: {
  providerId: string;
  modelId: string;
  snapshot: OriginRateLimitSnapshot;
  limitHit: boolean;
  observedAtMs?: number;
}): void {
  // An empty snapshot carries no observation (the parser only produces a
  // snapshot when at least one field was reported); recording one would
  // leave a contentless entry that looks like evidence.
  if (!input.snapshot || Object.keys(input.snapshot).length === 0) return;
  const observedAtMs = input.observedAtMs ?? Date.now();
  rateLimitEntries.set(`${input.providerId}\n${input.modelId}`, {
    providerId: input.providerId,
    modelId: input.modelId,
    snapshot: input.snapshot,
    limitHit: input.limitHit,
    observedAtMs,
    source: "observed",
  });
}

/**
 * Adds one composed route-2 result's own Neurons to the tracked estimate
 * for the current budget day. Non-positive or non-finite values are
 * ignored: a result that reported no usage says nothing about
 * consumption (and per W-1 the true figure is higher, never lower).
 */
export function recordOriginCloudflareNeuronEstimate(neurons: number, observedAtMs: number = Date.now()): void {
  if (!Number.isFinite(neurons) || neurons <= 0) return;
  const state = cloudflareStateFor(observedAtMs);
  state.trackedEstimateNeurons += Math.round(neurons);
}

/**
 * Reconciles an account-actual used-Neurons figure into the ledger for
 * the current budget day and returns the resulting ledger view. The
 * correction factor is recorded when the tracked estimate is positive;
 * with no tracked estimate yet there is nothing to correct against, so
 * the factor stays unrecorded rather than invented.
 */
export function reconcileOriginCloudflareNeurons(
  accountActualNeurons: number,
  observedAtMs: number = Date.now(),
): OriginCloudflareCapacityLedger {
  if (!Number.isSafeInteger(accountActualNeurons) || accountActualNeurons < 0) {
    return getOriginCapacityLedgerSnapshot(observedAtMs).cloudflareNeurons;
  }
  const state = cloudflareStateFor(observedAtMs);
  state.accountActualNeurons = accountActualNeurons;
  state.reconciledAtMs = observedAtMs;
  state.correctionFactor = state.trackedEstimateNeurons > 0
    ? accountActualNeurons / state.trackedEstimateNeurons
    : undefined;
  return getOriginCapacityLedgerSnapshot(observedAtMs).cloudflareNeurons;
}

/** The current ledger: latest observed rate limits per provider/model, plus the Cloudflare Neurons view for the current budget day. */
export function getOriginCapacityLedgerSnapshot(nowMs: number = Date.now()): OriginCapacityLedgerSnapshot {
  const state = cloudflareStateFor(nowMs);
  const cloudflareNeurons: OriginCloudflareCapacityLedger = {
    budgetDay: state.budgetDay,
    trackedEstimateNeurons: state.trackedEstimateNeurons,
    ...(state.accountActualNeurons !== undefined ? { accountActualNeurons: state.accountActualNeurons } : {}),
    ...(state.correctionFactor !== undefined ? { correctionFactor: state.correctionFactor } : {}),
    ...(state.reconciledAtMs !== undefined ? { reconciledAtMs: state.reconciledAtMs } : {}),
    source: state.reconciledAtMs !== undefined ? "observed" : "estimated",
  };
  const rateLimits = [...rateLimitEntries.values()].sort((a, b) =>
    a.providerId === b.providerId ? a.modelId.localeCompare(b.modelId) : a.providerId.localeCompare(b.providerId));
  return { rateLimits, cloudflareNeurons };
}

/** Test seam: clears every recorded observation and the tracked estimate. */
export function resetOriginCapacityLedgerForTests(): void {
  rateLimitEntries.clear();
  cloudflareState = null;
}
