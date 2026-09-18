import { describe, expect, it } from "vitest";

import type { OriginAnswerQualityBenchmarkObservation } from "./OriginAnswerQualityBenchmark";
import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import { ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES } from "./OriginAnswerQualityBenchmarkQualification";
import { buildOriginAnswerQualityBenchmarkReleaseReport } from "./OriginAnswerQualityBenchmarkReleaseReport";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";

function makeManifest() {
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

function run(m: ReturnType<typeof makeManifest>, sha: string, runId: string) {
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

function observations(
  m: ReturnType<typeof makeManifest>,
  mutate?: (item: OriginAnswerQualityBenchmarkObservation) => OriginAnswerQualityBenchmarkObservation,
) {
  return m.cases.map((item) => {
    const base: OriginAnswerQualityBenchmarkObservation = {
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
    };
    return mutate ? mutate(base) : base;
  });
}

describe("OriginAnswerQualityBenchmarkReleaseReport", () => {
  it("marks promotion eligible when at least one dimension improves and no family regresses", () => {
    const m = makeManifest();
    const baseline = observations(m);
    const candidate = observations(m, (item) =>
      item.category === "current-factual"
        ? { ...item, factualSupportScore: 0.9 }
        : item
    );

    const result = buildOriginAnswerQualityBenchmarkReleaseReport({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promotionEligible).toBe(true);
    expect(result.value.blockers).toEqual([]);
    expect(result.value.targetedImprovementObserved).toBe(true);
    expect(result.value.regressionFamilies).toEqual([]);
  });

  it("blocks promotion when a family regresses even if another family improves", () => {
    const m = makeManifest();
    const baseline = observations(m);
    const candidate = observations(m, (item) => {
      if (item.category === "current-factual") return { ...item, factualSupportScore: 0.9 };
      if (item.category === "professional-advice") return { ...item, taskCompletionScore: 0.7 };
      return item;
    });

    const result = buildOriginAnswerQualityBenchmarkReleaseReport({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promotionEligible).toBe(false);
    expect(result.value.blockers).toContain("CRITICAL_FAMILY_REGRESSION");
    expect(result.value.regressionFamilies).toContain("professional-advice");
  });

  it("blocks promotion when there is no measurable targeted improvement", () => {
    const m = makeManifest();
    const baseline = observations(m);
    const candidate = observations(m);

    const result = buildOriginAnswerQualityBenchmarkReleaseReport({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promotionEligible).toBe(false);
    expect(result.value.blockers).toEqual(["NO_TARGETED_IMPROVEMENT"]);
  });

  it("blocks unsupported-claim regression explicitly", () => {
    const m = makeManifest();
    const baseline = observations(m);
    const candidate = observations(m, (item) =>
      item.category === "multi-source-comparison"
        ? { ...item, unsupportedMaterialClaimCount: 1 }
        : item
    );

    const result = buildOriginAnswerQualityBenchmarkReleaseReport({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run(m, "a".repeat(40), "baseline"),
      candidateRun: run(m, "b".repeat(40), "candidate"),
      baselineObservations: baseline,
      candidateObservations: candidate,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promotionEligible).toBe(false);
    expect(result.value.blockers).toContain("UNSUPPORTED_CLAIMS_REGRESSED");
    expect(result.value.blockers).toContain("CRITICAL_FAMILY_REGRESSION");
  });
});
