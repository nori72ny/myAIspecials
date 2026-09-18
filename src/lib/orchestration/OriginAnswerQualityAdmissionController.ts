import type { OriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy.js";
import {
  checkOriginAnswerQualityExecutionBudget,
  type OriginAnswerQualityExecutionBudget,
  type OriginAnswerQualityExecutionUsage,
} from "./OriginAnswerQualityExecutionBudget.js";
import {
  evaluateOriginAnswerQualityRuntimeReadiness,
  type OriginAnswerQualityRuntimeReadiness,
} from "./OriginAnswerQualityRuntimeReadiness.js";
import {
  resolveOriginAnswerQualityStageRequirements,
  type OriginAnswerQualityStageRequirements,
} from "./OriginAnswerQualityStagePolicy.js";
import type { OriginVerificationDecision } from "./OriginVerifier.js";
import {
  readOriginAnswerQualityExecutionUsage,
  type OriginAnswerQualityUsageMeter,
} from "./OriginAnswerQualityUsageMeter.js";

export interface OriginAnswerQualityAdmissionInput {
  readonly policy: OriginAnswerQualityPolicy;
  readonly usage: OriginAnswerQualityExecutionUsage;
  readonly claimExtractionCompleted: boolean;
  readonly claimCoverageReviewPassed: boolean;
  readonly sourceVerificationCompleted: boolean;
  readonly verificationDecision: OriginVerificationDecision;
  readonly independentReviewPerformed: boolean;
  readonly tracePersisted: boolean;
}

export interface OriginAnswerQualityAdmissionDecision {
  readonly schemaVersion: "origin.aq-admission.v1";
  readonly admitted: boolean;
  readonly requirements: OriginAnswerQualityStageRequirements;
  readonly readiness: OriginAnswerQualityRuntimeReadiness;
  readonly budget:
    | { readonly ok: true }
    | { readonly ok: false; readonly code: string };
}

export function decideOriginAnswerQualityAdmission(
  input: OriginAnswerQualityAdmissionInput,
  budget?: OriginAnswerQualityExecutionBudget,
): OriginAnswerQualityAdmissionDecision {
  const requirements = resolveOriginAnswerQualityStageRequirements(input.policy);
  const budgetResult = checkOriginAnswerQualityExecutionBudget(input.usage, budget);

  const readiness = evaluateOriginAnswerQualityRuntimeReadiness({
    claimExtractionRequired: requirements.claimExtractionRequired,
    claimExtractionCompleted: input.claimExtractionCompleted,
    claimCoverageReviewRequired: requirements.claimCoverageReviewRequired,
    claimCoverageReviewPassed: input.claimCoverageReviewPassed,
    sourceVerificationRequired: requirements.sourceVerificationRequired,
    sourceVerificationCompleted: input.sourceVerificationCompleted,
    verificationDecision: input.verificationDecision,
    independentReviewRequired: requirements.independentReviewRequired,
    independentReviewPerformed: input.independentReviewPerformed,
    tracePersistenceRequired: requirements.tracePersistenceRequired,
    tracePersisted: input.tracePersisted,
    totalCostUsd: input.usage.costUsd,
  });

  return Object.freeze({
    schemaVersion: "origin.aq-admission.v1",
    admitted: budgetResult.ok && readiness.ready,
    requirements,
    readiness,
    budget: budgetResult,
  });
}


export function decideOriginAnswerQualityAdmissionFromMeter(
  input: Omit<OriginAnswerQualityAdmissionInput, "usage">,
  meter: OriginAnswerQualityUsageMeter,
  nowMs: number,
  budget?: OriginAnswerQualityExecutionBudget,
): OriginAnswerQualityAdmissionDecision {
  return decideOriginAnswerQualityAdmission(
    {
      ...input,
      usage: readOriginAnswerQualityExecutionUsage(meter, nowMs),
    },
    budget,
  );
}
