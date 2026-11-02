import {
  classifyOriginCostEvidenceV1,
  isOriginCostZeroVerifiedV1,
  type OriginCostEvidenceV1,
} from "./OriginCostEvidenceV1.js";

export interface OriginAnswerQualityBenchmarkCostEvidenceInput {
  readonly caseId: string;
  readonly evidence: unknown;
}

export interface OriginAnswerQualityBenchmarkCostEvidenceCase {
  readonly caseId: string;
  readonly evidence: OriginCostEvidenceV1;
}

export interface OriginAnswerQualityBenchmarkCostEvidenceSummary {
  readonly schemaVersion: "origin.aq-benchmark-cost-evidence.v1";
  readonly caseCount: number;
  readonly zeroCostVerifiedCount: number;
  readonly policyAllowedCount: number;
  readonly notMeasuredCount: number;
  readonly blockedUnverifiedCount: number;
  readonly status: "ZERO_COST_VERIFIED" | "POLICY_ALLOWED" | "NOT_MEASURED" | "BLOCKED_UNVERIFIED";
}

export interface OriginAnswerQualityBenchmarkCostEvidenceResult {
  readonly cases: readonly OriginAnswerQualityBenchmarkCostEvidenceCase[];
  readonly summary: OriginAnswerQualityBenchmarkCostEvidenceSummary;
}

export type OriginAnswerQualityBenchmarkCostEvidenceBuildResult =
  | { readonly ok: true; readonly value: OriginAnswerQualityBenchmarkCostEvidenceResult }
  | {
      readonly ok: false;
      readonly code:
        | "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH"
        | "AQ_BENCHMARK_COST_EVIDENCE_INVALID_CASE_ID";
      readonly caseId?: string;
    };

function aggregateStatus(
  zeroCostVerifiedCount: number,
  policyAllowedCount: number,
  notMeasuredCount: number,
  blockedUnverifiedCount: number,
): OriginAnswerQualityBenchmarkCostEvidenceSummary["status"] {
  if (blockedUnverifiedCount > 0) return "BLOCKED_UNVERIFIED";
  if (notMeasuredCount > 0) return "NOT_MEASURED";
  if (policyAllowedCount > 0) return "POLICY_ALLOWED";
  return zeroCostVerifiedCount > 0 ? "ZERO_COST_VERIFIED" : "NOT_MEASURED";
}

/**
 * Binds cost evidence to the exact AQ case set without changing quality scores.
 * Serialized claims of ZERO_COST_VERIFIED are downgraded by the shared classifier.
 * This function never creates a numeric cost or a verified receipt.
 */
export function bindOriginAnswerQualityBenchmarkCostEvidence(
  expectedCaseIds: readonly string[],
  inputs: readonly OriginAnswerQualityBenchmarkCostEvidenceInput[],
): OriginAnswerQualityBenchmarkCostEvidenceBuildResult {
  if (
    expectedCaseIds.length === 0
    || inputs.length !== expectedCaseIds.length
  ) {
    return { ok: false, code: "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH" };
  }

  const expected = new Set<string>();
  for (const caseId of expectedCaseIds) {
    if (typeof caseId !== "string" || !caseId.trim() || expected.has(caseId)) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_COST_EVIDENCE_INVALID_CASE_ID",
        caseId,
      };
    }
    expected.add(caseId);
  }

  const seen = new Set<string>();
  const cases: OriginAnswerQualityBenchmarkCostEvidenceCase[] = [];
  let zeroCostVerifiedCount = 0;
  let policyAllowedCount = 0;
  let notMeasuredCount = 0;
  let blockedUnverifiedCount = 0;

  for (const input of inputs) {
    if (
      !input
      || typeof input.caseId !== "string"
      || !expected.has(input.caseId)
      || seen.has(input.caseId)
    ) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH",
        ...(typeof input?.caseId === "string" ? { caseId: input.caseId } : {}),
      };
    }

    seen.add(input.caseId);
    const evidence = isOriginCostZeroVerifiedV1(input.evidence)
      ? input.evidence
      : classifyOriginCostEvidenceV1(input.evidence);

    switch (evidence.status) {
      case "ZERO_COST_VERIFIED":
        zeroCostVerifiedCount += 1;
        break;
      case "POLICY_ALLOWED":
        policyAllowedCount += 1;
        break;
      case "NOT_MEASURED":
        notMeasuredCount += 1;
        break;
      case "BLOCKED_UNVERIFIED":
        blockedUnverifiedCount += 1;
        break;
    }

    cases.push(Object.freeze({
      caseId: input.caseId,
      evidence,
    }));
  }

  if (seen.size !== expected.size) {
    return { ok: false, code: "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH" };
  }

  const summary: OriginAnswerQualityBenchmarkCostEvidenceSummary = Object.freeze({
    schemaVersion: "origin.aq-benchmark-cost-evidence.v1",
    caseCount: cases.length,
    zeroCostVerifiedCount,
    policyAllowedCount,
    notMeasuredCount,
    blockedUnverifiedCount,
    status: aggregateStatus(
      zeroCostVerifiedCount,
      policyAllowedCount,
      notMeasuredCount,
      blockedUnverifiedCount,
    ),
  });

  return {
    ok: true,
    value: Object.freeze({
      cases: Object.freeze(cases),
      summary,
    }),
  };
}
