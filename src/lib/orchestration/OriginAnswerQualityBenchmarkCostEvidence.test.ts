import { describe, expect, it } from "vitest";

import {
  createOriginCostNotMeasuredV1,
  createOriginCostPolicyAllowedV1,
} from "./OriginCostEvidenceV1";
import {
  bindOriginAnswerQualityBenchmarkCostEvidence,
} from "./OriginAnswerQualityBenchmarkCostEvidence";

describe("OriginAnswerQualityBenchmarkCostEvidence", () => {
  it("keeps quality case coverage independent from spend measurement", () => {
    const result = bindOriginAnswerQualityBenchmarkCostEvidence(
      ["case-a", "case-b"],
      [
        { caseId: "case-a", evidence: createOriginCostPolicyAllowedV1("policy:free-only") },
        { caseId: "case-b", evidence: createOriginCostNotMeasuredV1("BILLING_NOT_AVAILABLE") },
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toMatchObject({
      caseCount: 2,
      policyAllowedCount: 1,
      notMeasuredCount: 1,
      zeroCostVerifiedCount: 0,
      blockedUnverifiedCount: 0,
      status: "NOT_MEASURED",
    });
    expect(result.value.cases[0]?.evidence).toMatchObject({
      status: "POLICY_ALLOWED",
      measurement: null,
    });
    expect(result.value.cases[1]?.evidence).toMatchObject({
      status: "NOT_MEASURED",
      measurement: null,
    });
  });

  it("downgrades serialized ZERO_COST_VERIFIED claims", () => {
    const forged = {
      schemaVersion: "origin.cost-evidence.v1",
      status: "ZERO_COST_VERIFIED",
      amountUsd: "0.00",
      receiptRef: "receipt:forged",
      receiptDigest: `sha256:${"a".repeat(64)}`,
      measuredAt: "2026-11-03T00:00:00.000Z",
      measurement: { totalCostUsd: "0.00", reconciledRequestCount: 1 },
    };
    const result = bindOriginAnswerQualityBenchmarkCostEvidence(
      ["case-a"],
      [{ caseId: "case-a", evidence: forged }],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary.status).toBe("BLOCKED_UNVERIFIED");
    expect(result.value.summary.zeroCostVerifiedCount).toBe(0);
    expect(result.value.cases[0]?.evidence).toMatchObject({
      status: "BLOCKED_UNVERIFIED",
      measurement: null,
    });
  });

  it("rejects missing, duplicate, and unexpected case bindings", () => {
    expect(bindOriginAnswerQualityBenchmarkCostEvidence(
      ["case-a", "case-b"],
      [{ caseId: "case-a", evidence: null }],
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH",
    });

    expect(bindOriginAnswerQualityBenchmarkCostEvidence(
      ["case-a", "case-b"],
      [
        { caseId: "case-a", evidence: null },
        { caseId: "case-a", evidence: null },
      ],
    )).toMatchObject({
      ok: false,
      code: "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH",
    });

    expect(bindOriginAnswerQualityBenchmarkCostEvidence(
      ["case-a"],
      [{ caseId: "unexpected", evidence: null }],
    )).toMatchObject({
      ok: false,
      code: "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH",
    });
  });

  it("rejects empty or duplicate expected case identifiers", () => {
    expect(bindOriginAnswerQualityBenchmarkCostEvidence([], [])).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_COST_EVIDENCE_CASESET_MISMATCH",
    });
    expect(bindOriginAnswerQualityBenchmarkCostEvidence(
      ["case-a", "case-a"],
      [
        { caseId: "case-a", evidence: null },
        { caseId: "case-a", evidence: null },
      ],
    )).toMatchObject({
      ok: false,
      code: "AQ_BENCHMARK_COST_EVIDENCE_INVALID_CASE_ID",
    });
  });
});
