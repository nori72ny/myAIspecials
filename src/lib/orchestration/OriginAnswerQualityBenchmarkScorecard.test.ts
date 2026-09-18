import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  buildOriginAnswerQualityBenchmarkScorecard,
  compareOriginAnswerQualityBenchmarkScorecards,
  type OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard";

function fixture() {
  const cases = Array.from({ length: 4 }, (_, index) => ({
    caseId: `case-${index + 1}`,
    category: "fail-closed" as const,
    caseDigest: `sha256:${index.toString().repeat(64)}`,
  }));
  const result = createOriginAnswerQualityBenchmarkManifest("aq-scorecard", "v1", cases);
  if (!result.ok) throw new Error("invalid manifest");
  return result.value;
}

function observations(latencies = [10, 20, 30, 100]): OriginAnswerQualityBenchmarkMeasuredObservation[] {
  return latencies.map((latencyMs, index) => ({
    caseId: `case-${index + 1}`,
    category: "fail-closed",
    factualSupportScore: 1,
    citationPrecisionScore: 1,
    taskCompletionScore: 1,
    contradictionDetectionScore: 1,
    verifierRejectedUnsupportedClaim: true,
    providerRequests: 0,
    latencyMs,
    costUsd: 0,
    unsupportedMaterialClaimCount: 0,
    verificationIntegrityAccurate: index !== 3,
    failClosedCorrect: index !== 2,
    userActionabilityScore: (index % 4) as 0 | 1 | 2 | 3,
  }));
}

describe("OriginAnswerQualityBenchmarkScorecard", () => {
  it("computes VIR FCA UA and latency distribution from manifest-bound measurements", () => {
    const result = buildOriginAnswerQualityBenchmarkScorecard(fixture(), observations());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.caseCount).toBe(4);
    expect(result.value.verificationIntegrityRate).toBe(0.75);
    expect(result.value.failClosedAccuracy).toBe(0.75);
    expect(result.value.meanUserActionability).toBe(1.5);
    expect(result.value.medianLatencyMs).toBe(20);
    expect(result.value.p95LatencyMs).toBe(100);
    expect(result.value.perFamily["fail-closed"]).toEqual(expect.objectContaining({
      caseCount: 4,
      verificationIntegrityRate: 0.75,
      failClosedAccuracy: 0.75,
    }));
  });

  it("rejects duplicate or category-swapped measurements", () => {
    const manifest = fixture();
    const duplicate = observations();
    duplicate[1] = { ...duplicate[1], caseId: "case-1" };

    expect(buildOriginAnswerQualityBenchmarkScorecard(manifest, duplicate))
      .toEqual({ ok: false, code: "AQ_BENCHMARK_SCORECARD_CASESET_MISMATCH" });
  });

  it("rejects invalid user-actionability measurements", () => {
    const manifest = fixture();
    const invalid = observations();
    invalid[0] = { ...invalid[0], userActionabilityScore: 4 as 3 };

    expect(buildOriginAnswerQualityBenchmarkScorecard(manifest, invalid))
      .toEqual({ ok: false, code: "AQ_BENCHMARK_SCORECARD_INVALID_MEASUREMENT" });
  });

  it("compares measured scorecards without hiding latency changes", () => {
    const manifest = fixture();
    const baseline = buildOriginAnswerQualityBenchmarkScorecard(manifest, observations([10, 20, 30, 100]));
    const candidateObs = observations([10, 20, 40, 120]).map((item) => ({
      ...item,
      verificationIntegrityAccurate: true,
      failClosedCorrect: true,
      userActionabilityScore: 3 as const,
    }));
    const candidate = buildOriginAnswerQualityBenchmarkScorecard(manifest, candidateObs);
    if (!baseline.ok || !candidate.ok) throw new Error("invalid scorecards");

    expect(compareOriginAnswerQualityBenchmarkScorecards(baseline.value, candidate.value))
      .toEqual({
        verificationIntegrityRateDelta: 0.25,
        failClosedAccuracyDelta: 0.25,
        meanUserActionabilityDelta: 1.5,
        medianLatencyMsDelta: 0,
        p95LatencyMsDelta: 20,
      });
  });
});
