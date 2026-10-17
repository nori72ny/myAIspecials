import type { OriginAnswerQualityExecutionUsage } from "./OriginAnswerQualityExecutionBudget.js";

export type OriginAnswerQualityUsageEvent =
  | { readonly type: "provider-execution"; readonly costUsd: number }
  | { readonly type: "source-fetch" }
  | { readonly type: "repair-action" };

export interface OriginAnswerQualityUsageMeter {
  readonly startedAtMs: number;
  readonly events: readonly OriginAnswerQualityUsageEvent[];
}

export function createOriginAnswerQualityUsageMeter(
  startedAtMs: number,
): OriginAnswerQualityUsageMeter {
  if (!Number.isFinite(startedAtMs) || startedAtMs < 0) {
    throw new Error("AQ_USAGE_METER_INVALID_START");
  }

  return Object.freeze({
    startedAtMs,
    events: Object.freeze([]),
  });
}

export function appendOriginAnswerQualityUsageEvent(
  meter: OriginAnswerQualityUsageMeter,
  event: OriginAnswerQualityUsageEvent,
): OriginAnswerQualityUsageMeter {
  if (
    event.type === "provider-execution"
    && (!Number.isFinite(event.costUsd) || event.costUsd < 0)
  ) {
    throw new Error("AQ_USAGE_METER_INVALID_EVENT");
  }

  return Object.freeze({
    startedAtMs: meter.startedAtMs,
    events: Object.freeze([...meter.events, Object.freeze({ ...event })]),
  });
}

export function readOriginAnswerQualityExecutionUsage(
  meter: OriginAnswerQualityUsageMeter,
  nowMs: number,
): OriginAnswerQualityExecutionUsage {
  if (!Number.isFinite(nowMs) || nowMs < meter.startedAtMs) {
    throw new Error("AQ_USAGE_METER_INVALID_TIME");
  }

  let providerExecutions = 0;
  let sourceFetches = 0;
  let repairActions = 0;
  let costUsd = 0;

  for (const event of meter.events) {
    if (event.type === "provider-execution") {
      providerExecutions += 1;
      costUsd += event.costUsd;
    } else if (event.type === "source-fetch") {
      sourceFetches += 1;
    } else {
      repairActions += 1;
    }
  }

  return Object.freeze({
    providerExecutions,
    sourceFetches,
    repairActions,
    elapsedMs: nowMs - meter.startedAtMs,
    costUsd,
  });
}
