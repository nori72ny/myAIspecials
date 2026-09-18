import type { OriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy.js";
import {
  decideOriginAnswerQualityAdmission,
  type OriginAnswerQualityAdmissionDecision,
} from "./OriginAnswerQualityAdmissionController.js";
import {
  createOriginAnswerQualityAuditRecord,
  type OriginAnswerQualityAuditStage,
  type OriginAnswerQualityAuditStageRecord,
  type OriginAnswerQualityAuditRecord,
} from "./OriginAnswerQualityAuditRecord.js";
import {
  createOriginAnswerQualityReleaseDecision,
  type OriginAnswerQualityReleaseDecisionResult,
} from "./OriginAnswerQualityReleaseDecision.js";
import type { OriginAnswerQualityExecutionUsage } from "./OriginAnswerQualityExecutionBudget.js";
import type { OriginVerificationDecision } from "./OriginVerifier.js";

export interface OriginAnswerQualityIntegrationHarnessInput {
  readonly requestId: string;
  readonly answerDigest: string;
  readonly claimSetDigest?: string;
  readonly evidenceLedgerDigest?: string;
  readonly policy: OriginAnswerQualityPolicy;
  readonly usage: OriginAnswerQualityExecutionUsage;
  readonly claimExtractionCompleted: boolean;
  readonly claimCoverageReviewPassed: boolean;
  readonly sourceVerificationCompleted: boolean;
  readonly verificationDecision: OriginVerificationDecision;
  readonly independentReviewPerformed: boolean;
  readonly tracePersisted: boolean;
  readonly stages: readonly OriginAnswerQualityAuditStageRecord[];
  readonly createdAt: string;
}

export interface OriginAnswerQualityIntegrationHarnessResult {
  readonly admission: OriginAnswerQualityAdmissionDecision;
  readonly audit: OriginAnswerQualityAuditRecord | null;
  readonly release: OriginAnswerQualityReleaseDecisionResult;
}

function hasPassedStage(
  stages: readonly OriginAnswerQualityAuditStageRecord[],
  stage: OriginAnswerQualityAuditStage,
): boolean {
  return stages.some((entry) => entry.stage === stage && entry.status === "passed");
}

function admittedExecutionMatchesAudit(
  input: OriginAnswerQualityIntegrationHarnessInput,
  admission: OriginAnswerQualityAdmissionDecision,
): boolean {
  if (!admission.admitted) return true;

  const requiredStages: OriginAnswerQualityAuditStage[] = ["verifier", "presenter"];

  if (admission.requirements.claimExtractionRequired) {
    requiredStages.push("claim-extraction");
    if (!input.claimSetDigest) return false;
  }

  if (admission.requirements.claimCoverageReviewRequired) {
    requiredStages.push("claim-coverage-review");
  }

  if (admission.requirements.sourceVerificationRequired) {
    requiredStages.push("source-verification");
    if (!input.evidenceLedgerDigest) return false;
  }

  if (admission.requirements.independentReviewRequired) {
    requiredStages.push("independent-review");
  }

  if (admission.requirements.tracePersistenceRequired) {
    requiredStages.push("trace");
  }

  if (input.usage.repairActions > 0) {
    requiredStages.push("repair", "reverification");
  }

  return requiredStages.every((stage) => hasPassedStage(input.stages, stage));
}

export function runOriginAnswerQualityIntegrationHarness(
  input: OriginAnswerQualityIntegrationHarnessInput,
): OriginAnswerQualityIntegrationHarnessResult {
  const admission = decideOriginAnswerQualityAdmission({
    policy: input.policy,
    usage: input.usage,
    claimExtractionCompleted: input.claimExtractionCompleted,
    claimCoverageReviewPassed: input.claimCoverageReviewPassed,
    sourceVerificationCompleted: input.sourceVerificationCompleted,
    verificationDecision: input.verificationDecision,
    independentReviewPerformed: input.independentReviewPerformed,
    tracePersisted: input.tracePersisted,
  });

  if (!admittedExecutionMatchesAudit(input, admission)) {
    return {
      admission,
      audit: null,
      release: { ok: false, code: "AQ_RELEASE_AUDIT_MISMATCH" },
    };
  }

  const auditResult = createOriginAnswerQualityAuditRecord({
    requestId: input.requestId,
    answerDigest: input.answerDigest,
    ...(input.claimSetDigest ? { claimSetDigest: input.claimSetDigest } : {}),
    ...(input.evidenceLedgerDigest ? { evidenceLedgerDigest: input.evidenceLedgerDigest } : {}),
    stages: input.stages,
    blockers: admission.readiness.blockers,
    providerExecutions: input.usage.providerExecutions,
    sourceFetches: input.usage.sourceFetches,
    repairActions: input.usage.repairActions,
    elapsedMs: input.usage.elapsedMs,
    costUsd: input.usage.costUsd as 0,
    createdAt: input.createdAt,
  });

  if (!auditResult.ok) {
    return {
      admission,
      audit: null,
      release: { ok: false, code: "AQ_RELEASE_AUDIT_MISMATCH" },
    };
  }

  return {
    admission,
    audit: auditResult.value,
    release: createOriginAnswerQualityReleaseDecision(
      admission,
      auditResult.value,
    ),
  };
}
