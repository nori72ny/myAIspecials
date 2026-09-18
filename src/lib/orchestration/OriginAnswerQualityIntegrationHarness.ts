import type { OriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy.js";
import {
  decideOriginAnswerQualityAdmission,
  type OriginAnswerQualityAdmissionDecision,
} from "./OriginAnswerQualityAdmissionController.js";
import {
  createOriginAnswerQualityAuditRecord,
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
