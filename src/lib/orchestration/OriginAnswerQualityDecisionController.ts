import type { OriginVerificationResult } from "./OriginVerifier.js";
import { buildOriginRepairPlan, type OriginRepairPlan } from "./OriginRepairPlanner.js";
import {
  presentOriginVerification,
  type OriginVerificationPresentation,
} from "./OriginVerificationPresenter.js";

export interface OriginAnswerQualityDecision {
  readonly verification: OriginVerificationResult;
  readonly repairPlan: OriginRepairPlan;
  readonly presentation: OriginVerificationPresentation;
}

export function decideOriginAnswerQuality(
  verification: OriginVerificationResult,
  options: {
    language: "ja" | "en";
    independentReviewRequired: boolean;
    independentReviewPerformed: boolean;
  },
): OriginAnswerQualityDecision {
  const repairPlan = buildOriginRepairPlan(verification);
  const presentation = presentOriginVerification(verification, options);

  if (verification.decision === "PASS" && repairPlan.required) {
    throw new Error("AQ_DECISION_INVARIANT_BROKEN");
  }

  if (verification.decision === "BLOCKED_UNVERIFIED" && presentation.status === "passed") {
    throw new Error("AQ_DECISION_INVARIANT_BROKEN");
  }

  if (repairPlan.blocked && presentation.status === "passed") {
    throw new Error("AQ_DECISION_INVARIANT_BROKEN");
  }

  return Object.freeze({
    verification,
    repairPlan,
    presentation,
  });
}
