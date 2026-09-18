import { describe, expect, it } from "vitest";

import type {
  OriginAnswerQualityBenchmarkObservation,
} from "./OriginAnswerQualityBenchmark";
import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  decideOriginAnswerQualityBenchmarkMeasuredPromotion,
} from "./OriginAnswerQualityBenchmarkMeasuredPromotion";
import {
  ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES,
} from "./OriginAnswerQualityBenchmarkQualification";
import {
  createOriginAnswerQualityBenchmarkRunProvenance,
} from "./OriginAnswerQualityBenchmarkRunProvenance";
import type {
  OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard";

function manifest() {
  const cases = ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES.flatMap((category, familyIndex) =>
    Array.from({ length: 4 }, (_, index) => ({
      caseId: `${category}-${index + 1}`,
      category,
      caseDigest: `sha256:${((familyIndex + index) % 10).toString().repeat(64)}`,
    })),
  );
  const result = createOriginAnswerQualityBenchmarkManifest("aq-post-heldout", "v1", cases);
  if (!result.ok) throw new Error("invalid manifest");
  return result.value;
}

function run(m: ReturnType<typeof manifest>, sha: string, runId: string) {
  const result = createOriginAnswerQualityBenchmarkRunProvenance({
    runId,
    gitSha: sha,
    manifestDigest: m.manifestDigest,
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-09-19T00:00:00.000Z",
    completedAt: "2026-09-19T00:10:00.000Z",
  }, m);
  if (!result.ok) throw new Error("invalid run");
  return result.value;
}

function baseObservations(m: ReturnType<typeof manifest>): OriginAnswerQualityBenchmarkObservation[] {
  return m.cases.map((item) => ({
    caseId: item.caseId,
    category: item.category,
    factualSupportScore: 0.8,
    citationPrecisionScore: 0.8,
    taskCompletionScore: 0.8,
    contradictionDetectionScore: 0.8,
    verifierRejectedUnsupportedClaim: true,
    repairSucceeded: item.category === "coding-repair" ? true : undefined,
    providerRequests: 1,
    latencyMs: 100,
    costUsd: 0,
    unsupportedMaterialClaimCount: 0,
  }));
}

function measured(
  base: readonly OriginAnswerQualityBenchmarkObservation[],
  mutate?: (item: OriginAnswerQualityBenchmarkMeasuredObservation) => OriginAnswerQualityBenchmarkMeasuredObservation,
): OriginAnswerQualityBenchmarkMeasuredObservation[] {
  return base.map((item) => {
    const value: OriginAnswerQualityBenchmarkMeasuredObservation = {
      ...item,
      verificationIntegrityAccurate: true,
      failClosedCorrect: item.category === "fail-closed" ? true : undefined,
      userActionabilityScore: 2,
    };
    return mutate ? mutate(value) : value;
  });
}

describe("OriginAnswerQualityBenchmarkMeasuredPromotion", () => {
  it("allows promotion when base report passes and VIR/FCA/UA do not regress", () => {
    const m = manifest();
    const baseline = baseObservations(m);
    const candidate = baseline.map((item) =>
      item.category === "current-factual"
        ? { ...item, factualSupportScore: 0.9 }
        : item
    );

    const result = decideOriginAnswerQualityBenchmarkMeasuredPromotion({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
      baselineMeasuredObservations: measured(baseline),
      candidateMeasuredObservations: measured(candidate),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promotionEligible).toBe(true);
    expect(result.value.blockers).toEqual([]);
  });

  it("blocks a VIR regression even when base quality improves", () => {
    const m = manifest();
    const baseline = baseObservations(m);
    const candidate = baseline.map((item) =>
      item.category === "current-factual"
        ? { ...item, factualSupportScore: 0.9 }
        : item
    );
    const candidateMeasured = measured(candidate, (item) =>
      item.caseId === "current-factual-1"
        ? { ...item, verificationIntegrityAccurate: false }
        : item
    );

    const result = decideOriginAnswerQualityBenchmarkMeasuredPromotion({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
      baselineMeasuredObservations: measured(baseline),
      candidateMeasuredObservations: candidateMeasured,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promotionEligible).toBe(false);
    expect(result.value.blockers).toContain("VERIFICATION_INTEGRITY_REGRESSED");
  });

  it("blocks fail-closed accuracy regression", () => {
    const m = manifest();
    const baseline = baseObservations(m);
    const candidate = baseline.map((item) =>
      item.category === "current-factual"
        ? { ...item, factualSupportScore: 0.9 }
        : item
    );
    const candidateMeasured = measured(candidate, (item) =>
      item.caseId === "fail-closed-1"
        ? { ...item, failClosedCorrect: false }
        : item
    );

    const result = decideOriginAnswerQualityBenchmarkMeasuredPromotion({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
      baselineMeasuredObservations: measured(baseline),
      candidateMeasuredObservations: candidateMeasured,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blockers).toContain("FAIL_CLOSED_ACCURACY_REGRESSED");
  });

  it("blocks per-family user actionability regression", () => {
    const m = manifest();
    const baseline = baseObservations(m);
    const candidate = baseline.map((item) =>
      item.category === "current-factual"
        ? { ...item, factualSupportScore: 0.9 }
        : item
    );
    const candidateMeasured = measured(candidate, (item) =>
      item.category === "professional-advice"
        ? { ...item, userActionabilityScore: 1 }
        : item
    );

    const result = decideOriginAnswerQualityBenchmarkMeasuredPromotion({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
      baselineMeasuredObservations: measured(baseline),
      candidateMeasuredObservations: candidateMeasured,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blockers).toContain("USER_ACTIONABILITY_REGRESSED");
    expect(result.value.userActionabilityRegressionFamilies).toContain("professional-advice");
  });
});
