import { describe, expect, it } from "vitest";

import {
  aggregateOriginAnswerQualityBenchmark,
  compareOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkObservation,
} from "./OriginAnswerQualityBenchmark";

const base: OriginAnswerQualityBenchmarkObservation = {
  caseId: "case-1",
  category: "current-factual",
  factualSupportScore: 0.8,
  citationPrecisionScore: 0.9,
  taskCompletionScore: 0.8,
  contradictionDetectionScore: 0.7,
  verifierRejectedUnsupportedClaim: true,
  providerRequests: 2,
  latencyMs: 1_000,
  costUsd: 0,
  unsupportedMaterialClaimCount: 1,
};

describe("OriginAnswerQualityBenchmark", () => {
  it("aggregates raw metrics without creating a winner score", () => {
    const result = aggregateOriginAnswerQualityBenchmark([
      base,
      {
        ...base,
        caseId: "case-2",
        category: "coding-repair",
        factualSupportScore: 1,
        citationPrecisionScore: 1,
        taskCompletionScore: 1,
        contradictionDetectionScore: 0.9,
        repairSucceeded: true,
        providerRequests: 3,
        latencyMs: 2_000,
        unsupportedMaterialClaimCount: 0,
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      caseCount: 2,
      categoryCount: 2,
      unsupportedMaterialClaimCount: 1,
      totalProviderRequests: 5,
      totalCostUsd: 0,
      repairSuccessRate: 1,
    });
    expect(result.value).not.toHaveProperty("overallScore");
    expect(result.value).not.toHaveProperty("winner");
  });

  it("rejects non-zero cost to preserve the ORIGIN free-only benchmark boundary", () => {
    expect(aggregateOriginAnswerQualityBenchmark([
      { ...base, costUsd: 0.01 },
    ])).toEqual({ ok: false, code: "INVALID_BENCHMARK_OBSERVATION" });
  });

  it("rejects out-of-range scores and empty benchmarks", () => {
    expect(aggregateOriginAnswerQualityBenchmark([]))
      .toEqual({ ok: false, code: "EMPTY_BENCHMARK" });
    expect(aggregateOriginAnswerQualityBenchmark([
      { ...base, factualSupportScore: 1.1 },
    ])).toEqual({ ok: false, code: "INVALID_BENCHMARK_OBSERVATION" });
  });

  it("reports raw before/after deltas rather than an evaluative verdict", () => {
    const baseline = aggregateOriginAnswerQualityBenchmark([base]);
    const candidate = aggregateOriginAnswerQualityBenchmark([
      {
        ...base,
        factualSupportScore: 0.9,
        unsupportedMaterialClaimCount: 0,
        providerRequests: 3,
        latencyMs: 1_200,
      },
    ]);
    if (!baseline.ok || !candidate.ok) throw new Error("invalid fixture");

    const delta = compareOriginAnswerQualityBenchmark(baseline.value, candidate.value);
    expect(delta.factualSupportDelta).toBeCloseTo(0.1);
    expect(delta.unsupportedMaterialClaimDelta).toBe(-1);
    expect(delta.providerRequestDelta).toBe(1);
    expect(delta.latencyMsDelta).toBe(200);
    expect(delta.totalCostUsdDelta).toBe(0);
  });
});
