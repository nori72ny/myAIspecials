import type { OriginAnswerQualityBenchmarkCategory } from "./OriginAnswerQualityBenchmark.js";
import type {
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import type {
  OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard.js";

export interface OriginAnswerQualityBenchmarkScoringEvidence {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly finalAnswerRef: string | null;
  readonly evidenceLedgerRef: string | null;
  readonly totalMaterialClaims: number;
  readonly supportedMaterialClaims: number;
  readonly totalRenderedCitations: number;
  readonly supportingRenderedCitations: number;
  readonly citationsRequired: boolean;
  readonly materialContradictionsPresent: number;
  readonly materialContradictionsSurfaced: number;
  readonly deliverableCompleted: boolean;
  readonly verifierRejectedUnsupportedClaim: boolean;
  readonly repairRequired: boolean;
  readonly repairSucceeded?: boolean;
  readonly verificationIntegrityAccurate: boolean;
  readonly failClosedDesigned: boolean;
  readonly failClosedCorrect?: boolean;
  readonly userActionabilityScore: 0 | 1 | 2 | 3;
}

export type OriginAnswerQualityBenchmarkScoringResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkMeasuredObservation }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SCORING_IDENTITY_MISMATCH"
        | "AQ_BENCHMARK_SCORING_EVIDENCE_REF_MISMATCH"
        | "AQ_BENCHMARK_SCORING_INVALID_COUNTS"
        | "AQ_BENCHMARK_SCORING_INVALID_REPAIR"
        | "AQ_BENCHMARK_SCORING_INVALID_FAIL_CLOSED"
        | "AQ_BENCHMARK_SCORING_NON_ZERO_COST";
    };

function validCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

export function scoreOriginAnswerQualityBenchmarkEvidence(
  execution: OriginAnswerQualityBenchmarkExecutionEvidence,
  evidence: OriginAnswerQualityBenchmarkScoringEvidence,
): OriginAnswerQualityBenchmarkScoringResult {
  if (execution.caseId !== evidence.caseId) {
    return { ok: false, code: "AQ_BENCHMARK_SCORING_IDENTITY_MISMATCH" };
  }
  if (
    execution.finalAnswerRef !== evidence.finalAnswerRef
    || execution.evidenceLedgerRef !== evidence.evidenceLedgerRef
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SCORING_EVIDENCE_REF_MISMATCH" };
  }
  if (execution.costUsd !== 0) {
    return { ok: false, code: "AQ_BENCHMARK_SCORING_NON_ZERO_COST" };
  }

  const counts = [
    evidence.totalMaterialClaims,
    evidence.supportedMaterialClaims,
    evidence.totalRenderedCitations,
    evidence.supportingRenderedCitations,
    evidence.materialContradictionsPresent,
    evidence.materialContradictionsSurfaced,
  ];
  if (
    !counts.every(validCount)
    || evidence.supportedMaterialClaims > evidence.totalMaterialClaims
    || evidence.supportingRenderedCitations > evidence.totalRenderedCitations
    || evidence.materialContradictionsSurfaced > evidence.materialContradictionsPresent
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SCORING_INVALID_COUNTS" };
  }

  if (
    evidence.repairRequired !== (evidence.repairSucceeded !== undefined)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SCORING_INVALID_REPAIR" };
  }

  if (
    evidence.failClosedDesigned !== (evidence.failClosedCorrect !== undefined)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SCORING_INVALID_FAIL_CLOSED" };
  }

  const unsupportedMaterialClaimCount =
    evidence.totalMaterialClaims - evidence.supportedMaterialClaims;

  const factualSupportScore = ratio(
    evidence.supportedMaterialClaims,
    evidence.totalMaterialClaims,
    1,
  );
  const citationPrecisionScore = ratio(
    evidence.supportingRenderedCitations,
    evidence.totalRenderedCitations,
    evidence.citationsRequired ? 0 : 1,
  );
  const contradictionDetectionScore = ratio(
    evidence.materialContradictionsSurfaced,
    evidence.materialContradictionsPresent,
    1,
  );

  return {
    ok: true,
    value: Object.freeze({
      caseId: evidence.caseId,
      category: evidence.category,
      factualSupportScore,
      citationPrecisionScore,
      taskCompletionScore: evidence.deliverableCompleted ? 1 : 0,
      contradictionDetectionScore,
      verifierRejectedUnsupportedClaim: evidence.verifierRejectedUnsupportedClaim,
      repairSucceeded: evidence.repairRequired ? evidence.repairSucceeded : undefined,
      providerRequests: execution.providerRequests,
      latencyMs: execution.latencyMs,
      costUsd: 0,
      unsupportedMaterialClaimCount,
      verificationIntegrityAccurate: evidence.verificationIntegrityAccurate,
      failClosedCorrect: evidence.failClosedDesigned ? evidence.failClosedCorrect : undefined,
      userActionabilityScore: evidence.userActionabilityScore,
    }),
  };
}
