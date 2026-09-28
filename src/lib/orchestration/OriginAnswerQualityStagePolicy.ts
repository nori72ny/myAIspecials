import type { OriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy.js";

export interface OriginAnswerQualityStageRequirements {
  readonly claimExtractionRequired: boolean;
  readonly claimCoverageReviewRequired: boolean;
  readonly sourceVerificationRequired: boolean;
  readonly independentReviewRequired: boolean;
  readonly tracePersistenceRequired: boolean;
}

export function resolveOriginAnswerQualityStageRequirements(
  policy: OriginAnswerQualityPolicy,
): OriginAnswerQualityStageRequirements {
  const evidenceRequired =
    policy.verificationLevel === "evidence-required"
    || policy.verificationLevel === "independent-review-required";

  const independentReviewRequired =
    policy.verificationLevel === "independent-review-required";

  return Object.freeze({
    claimExtractionRequired: evidenceRequired,
    claimCoverageReviewRequired: independentReviewRequired,
    sourceVerificationRequired: evidenceRequired,
    independentReviewRequired,
    tracePersistenceRequired: evidenceRequired || policy.executiveReasoningRequired,
  });
}
