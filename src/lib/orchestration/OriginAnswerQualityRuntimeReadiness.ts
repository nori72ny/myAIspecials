import type { OriginVerificationDecision } from "./OriginVerifier.js";

export type OriginAnswerQualityReadinessBlocker =
  | "CLAIM_EXTRACTION_INCOMPLETE"
  | "CLAIM_COVERAGE_INCOMPLETE"
  | "SOURCE_VERIFICATION_INCOMPLETE"
  | "VERIFIER_NOT_PASS"
  | "INDEPENDENT_REVIEW_INCOMPLETE"
  | "TRACE_PERSISTENCE_INCOMPLETE"
  | "NON_ZERO_COST";

export interface OriginAnswerQualityRuntimeReadinessInput {
  readonly claimExtractionRequired: boolean;
  readonly claimExtractionCompleted: boolean;
  readonly claimCoverageReviewRequired: boolean;
  readonly claimCoverageReviewPassed: boolean;
  readonly sourceVerificationRequired: boolean;
  readonly sourceVerificationCompleted: boolean;
  readonly verificationDecision: OriginVerificationDecision;
  readonly independentReviewRequired: boolean;
  readonly independentReviewPerformed: boolean;
  readonly tracePersistenceRequired: boolean;
  readonly tracePersisted: boolean;
  readonly totalCostUsd: number;
}

export interface OriginAnswerQualityRuntimeReadiness {
  readonly schemaVersion: "origin.aq-readiness.v1";
  readonly ready: boolean;
  readonly blockers: readonly OriginAnswerQualityReadinessBlocker[];
}

export function evaluateOriginAnswerQualityRuntimeReadiness(
  input: OriginAnswerQualityRuntimeReadinessInput,
): OriginAnswerQualityRuntimeReadiness {
  const blockers: OriginAnswerQualityReadinessBlocker[] = [];

  if (input.claimExtractionRequired && !input.claimExtractionCompleted) {
    blockers.push("CLAIM_EXTRACTION_INCOMPLETE");
  }

  if (input.claimCoverageReviewRequired && !input.claimCoverageReviewPassed) {
    blockers.push("CLAIM_COVERAGE_INCOMPLETE");
  }

  if (input.sourceVerificationRequired && !input.sourceVerificationCompleted) {
    blockers.push("SOURCE_VERIFICATION_INCOMPLETE");
  }

  if (input.verificationDecision !== "PASS") {
    blockers.push("VERIFIER_NOT_PASS");
  }

  if (input.independentReviewRequired && !input.independentReviewPerformed) {
    blockers.push("INDEPENDENT_REVIEW_INCOMPLETE");
  }

  if (input.tracePersistenceRequired && !input.tracePersisted) {
    blockers.push("TRACE_PERSISTENCE_INCOMPLETE");
  }

  if (!Number.isFinite(input.totalCostUsd) || input.totalCostUsd !== 0) {
    blockers.push("NON_ZERO_COST");
  }

  return Object.freeze({
    schemaVersion: "origin.aq-readiness.v1",
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
