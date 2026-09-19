import { describe, expect, it } from "vitest";

import { scoreOriginAnswerQualityBenchmarkEvidence } from "./OriginAnswerQualityBenchmarkScoring";
import type { OriginAnswerQualityBenchmarkExecutionEvidence } from "./OriginAnswerQualityBenchmarkRunner";

function execution(overrides: Partial<OriginAnswerQualityBenchmarkExecutionEvidence> = {}): OriginAnswerQualityBenchmarkExecutionEvidence {
  return {
    caseId: "case-1",
    finalAnswerRef: "answer:1",
    evidenceLedgerRef: "ledger:1",
    verifierResult: "PASS",
    providerRequests: 2,
    toolCalls: 3,
    latencyMs: 120,
    costUsd: 0,
    failureCode: null,
    ...overrides,
  };
}

describe("OriginAnswerQualityBenchmarkScoring", () => {
  it("derives MCSR, citation precision, contradiction detection and task completion from raw counts", () => {
    const result = scoreOriginAnswerQualityBenchmarkEvidence(execution(), {
      caseId: "case-1",
      category: "multi-source-comparison",
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: "ledger:1",
      totalMaterialClaims: 4,
      supportedMaterialClaims: 3,
      totalRenderedCitations: 5,
      supportingRenderedCitations: 4,
      citationsRequired: true,
      materialContradictionsPresent: 2,
      materialContradictionsSurfaced: 1,
      deliverableCompleted: true,
      verifierRejectedUnsupportedClaim: true,
      repairRequired: false,
      verificationIntegrityAccurate: true,
      failClosedDesigned: false,
      userActionabilityScore: 3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factualSupportScore).toBe(0.75);
    expect(result.value.citationPrecisionScore).toBe(0.8);
    expect(result.value.contradictionDetectionScore).toBe(0.5);
    expect(result.value.taskCompletionScore).toBe(1);
    expect(result.value.unsupportedMaterialClaimCount).toBe(1);
    expect(result.value.providerRequests).toBe(2);
    expect(result.value.latencyMs).toBe(120);
  });

  it("treats empty denominators conservatively when citations are required", () => {
    const result = scoreOriginAnswerQualityBenchmarkEvidence(execution(), {
      caseId: "case-1",
      category: "current-factual",
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: "ledger:1",
      totalMaterialClaims: 0,
      supportedMaterialClaims: 0,
      totalRenderedCitations: 0,
      supportingRenderedCitations: 0,
      citationsRequired: true,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      deliverableCompleted: false,
      verifierRejectedUnsupportedClaim: false,
      repairRequired: false,
      verificationIntegrityAccurate: false,
      failClosedDesigned: false,
      userActionabilityScore: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factualSupportScore).toBe(1);
    expect(result.value.citationPrecisionScore).toBe(0);
    expect(result.value.contradictionDetectionScore).toBe(1);
    expect(result.value.taskCompletionScore).toBe(0);
  });

  it("rejects impossible counts", () => {
    const result = scoreOriginAnswerQualityBenchmarkEvidence(execution(), {
      caseId: "case-1",
      category: "current-factual",
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: "ledger:1",
      totalMaterialClaims: 2,
      supportedMaterialClaims: 3,
      totalRenderedCitations: 1,
      supportingRenderedCitations: 1,
      citationsRequired: true,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      deliverableCompleted: true,
      verifierRejectedUnsupportedClaim: true,
      repairRequired: false,
      verificationIntegrityAccurate: true,
      failClosedDesigned: false,
      userActionabilityScore: 2,
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_SCORING_INVALID_COUNTS" });
  });

  it("requires explicit repair and fail-closed outcomes only when designed", () => {
    expect(scoreOriginAnswerQualityBenchmarkEvidence(execution(), {
      caseId: "case-1",
      category: "coding-repair",
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: "ledger:1",
      totalMaterialClaims: 1,
      supportedMaterialClaims: 1,
      totalRenderedCitations: 0,
      supportingRenderedCitations: 0,
      citationsRequired: false,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      deliverableCompleted: true,
      verifierRejectedUnsupportedClaim: true,
      repairRequired: true,
      verificationIntegrityAccurate: true,
      failClosedDesigned: false,
      userActionabilityScore: 3,
    })).toEqual({ ok: false, code: "AQ_BENCHMARK_SCORING_INVALID_REPAIR" });

    expect(scoreOriginAnswerQualityBenchmarkEvidence(execution(), {
      caseId: "case-1",
      category: "fail-closed",
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: "ledger:1",
      totalMaterialClaims: 0,
      supportedMaterialClaims: 0,
      totalRenderedCitations: 0,
      supportingRenderedCitations: 0,
      citationsRequired: false,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      deliverableCompleted: true,
      verifierRejectedUnsupportedClaim: false,
      repairRequired: false,
      verificationIntegrityAccurate: true,
      failClosedDesigned: true,
      userActionabilityScore: 3,
    })).toEqual({ ok: false, code: "AQ_BENCHMARK_SCORING_INVALID_FAIL_CLOSED" });
  });

  it("fails closed on non-zero execution cost", () => {
    const result = scoreOriginAnswerQualityBenchmarkEvidence(execution({ costUsd: 0.01 }), {
      caseId: "case-1",
      category: "professional-advice",
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: "ledger:1",
      totalMaterialClaims: 0,
      supportedMaterialClaims: 0,
      totalRenderedCitations: 0,
      supportingRenderedCitations: 0,
      citationsRequired: false,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      deliverableCompleted: true,
      verifierRejectedUnsupportedClaim: false,
      repairRequired: false,
      verificationIntegrityAccurate: true,
      failClosedDesigned: false,
      userActionabilityScore: 3,
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_SCORING_NON_ZERO_COST" });
  });
  it("rejects scoring evidence from a different executed answer", () => {
    const result = scoreOriginAnswerQualityBenchmarkEvidence(execution(), {
      caseId: "case-1",
      category: "professional-advice",
      finalAnswerRef: "answer:other",
      evidenceLedgerRef: "ledger:1",
      totalMaterialClaims: 0,
      supportedMaterialClaims: 0,
      totalRenderedCitations: 0,
      supportingRenderedCitations: 0,
      citationsRequired: false,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      deliverableCompleted: true,
      verifierRejectedUnsupportedClaim: false,
      repairRequired: false,
      verificationIntegrityAccurate: true,
      failClosedDesigned: false,
      userActionabilityScore: 3,
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SCORING_EVIDENCE_REF_MISMATCH",
    });
  });

});
