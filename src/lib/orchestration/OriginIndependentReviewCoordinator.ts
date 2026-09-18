import type { OriginClaimSet } from "./OriginClaimModel.js";
import type { OriginEvidenceLedger } from "./OriginEvidenceLedger.js";
import {
  applyIndependentReviewToVerification,
  runOriginIndependentReview,
  type OriginIndependentReviewer,
  type OriginIndependentReviewResult,
} from "./OriginIndependentReviewer.js";
import { createOriginAnswerReviewDigests } from "./OriginAnswerReviewDigests.js";
import type { OriginVerificationResult } from "./OriginVerifier.js";

export interface OriginIndependentReviewCoordinatorInput {
  readonly answerText: string;
  readonly claimSet: OriginClaimSet;
  readonly evidenceLedger: OriginEvidenceLedger;
  readonly verification: OriginVerificationResult;
  readonly required: boolean;
}

export interface OriginIndependentReviewCoordinatorResult {
  readonly reviewPerformed: boolean;
  readonly review: OriginIndependentReviewResult | null;
  readonly verification: OriginVerificationResult;
  readonly digests: {
    readonly answerDigest: string;
    readonly claimSetDigest: string;
    readonly evidenceLedgerDigest: string;
  };
}

export async function coordinateOriginIndependentReview(
  input: OriginIndependentReviewCoordinatorInput,
  reviewer?: OriginIndependentReviewer,
): Promise<OriginIndependentReviewCoordinatorResult> {
  const digests = createOriginAnswerReviewDigests(
    input.answerText,
    input.claimSet,
    input.evidenceLedger,
  );

  if (!input.required) {
    return Object.freeze({
      reviewPerformed: false,
      review: null,
      verification: input.verification,
      digests,
    });
  }

  const review = await runOriginIndependentReview({
    ...digests,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
    },
  }, reviewer);

  const verification = applyIndependentReviewToVerification(
    input.verification,
    review,
  );

  return Object.freeze({
    reviewPerformed: review.ok,
    review,
    verification,
    digests,
  });
}
