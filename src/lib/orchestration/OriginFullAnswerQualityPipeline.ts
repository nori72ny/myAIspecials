import type { OriginClaimSet } from "./OriginClaimModel.js";
import type { OriginEvidenceLedger } from "./OriginEvidenceLedger.js";
import {
  coordinateOriginIndependentReview,
  type OriginIndependentReviewCoordinatorResult,
} from "./OriginIndependentReviewCoordinator.js";
import type { OriginIndependentReviewer } from "./OriginIndependentReviewer.js";
import {
  runOriginAnswerQualityOrchestrator,
  type OriginAnswerQualityOrchestratorResult,
  type OriginReverificationExecutor,
} from "./OriginAnswerQualityOrchestrator.js";
import {
  decideOriginAnswerQuality,
  type OriginAnswerQualityDecision,
} from "./OriginAnswerQualityDecisionController.js";
import type {
  OriginRepairExecutionContext,
  OriginRepairExecutor,
} from "./OriginRepairExecutor.js";
import type { OriginVerificationResult } from "./OriginVerifier.js";

export interface OriginFullAnswerQualityPipelineInput {
  readonly answerText: string;
  readonly claimSet: OriginClaimSet;
  readonly evidenceLedger: OriginEvidenceLedger;
  readonly verification: OriginVerificationResult;
  readonly language: "ja" | "en";
  readonly independentReviewRequired: boolean;
}

export interface OriginFullAnswerQualityPipelineResult {
  readonly orchestration: OriginAnswerQualityOrchestratorResult;
  readonly independentReview: OriginIndependentReviewCoordinatorResult | null;
  readonly final: OriginAnswerQualityDecision;
}

export async function runOriginFullAnswerQualityPipeline(
  input: OriginFullAnswerQualityPipelineInput,
  repairExecutor: OriginRepairExecutor,
  repairContext: OriginRepairExecutionContext,
  reverify?: OriginReverificationExecutor,
  reviewer?: OriginIndependentReviewer,
): Promise<OriginFullAnswerQualityPipelineResult> {
  const orchestration = await runOriginAnswerQualityOrchestrator({
    verification: input.verification,
    language: input.language,
    independentReviewRequired: false,
    independentReviewPerformed: false,
  }, repairExecutor, repairContext, reverify);

  if (orchestration.final.verification.decision !== "PASS") {
    const final = decideOriginAnswerQuality(orchestration.final.verification, {
      language: input.language,
      independentReviewRequired: input.independentReviewRequired,
      independentReviewPerformed: false,
    });

    return Object.freeze({
      orchestration,
      independentReview: null,
      final,
    });
  }

  const independentReview = await coordinateOriginIndependentReview({
    answerText: input.answerText,
    claimSet: input.claimSet,
    evidenceLedger: input.evidenceLedger,
    verification: orchestration.final.verification,
    required: input.independentReviewRequired,
  }, reviewer);

  const final = decideOriginAnswerQuality(independentReview.verification, {
    language: input.language,
    independentReviewRequired: input.independentReviewRequired,
    independentReviewPerformed: independentReview.reviewPerformed,
  });

  return Object.freeze({
    orchestration,
    independentReview,
    final,
  });
}
