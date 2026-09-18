import type { OriginBatchAnswerSourceVerificationSummary } from "./OriginBatchAnswerSourceVerification.js";
import {
  appendOriginAnswerQualityUsageEvent,
  type OriginAnswerQualityUsageMeter,
} from "./OriginAnswerQualityUsageMeter.js";

export function recordOriginBatchVerificationUsage(
  meter: OriginAnswerQualityUsageMeter,
  summary: OriginBatchAnswerSourceVerificationSummary,
): OriginAnswerQualityUsageMeter {
  let next = meter;

  for (let index = 0; index < summary.sourceFetches; index += 1) {
    next = appendOriginAnswerQualityUsageEvent(next, { type: "source-fetch" });
  }

  for (let index = 0; index < summary.assessorExecutions; index += 1) {
    next = appendOriginAnswerQualityUsageEvent(next, {
      type: "provider-execution",
      costUsd: 0,
    });
  }

  return next;
}
