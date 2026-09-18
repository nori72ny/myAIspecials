import { describe, expect, it } from "vitest";

import type { OriginAnswerQualityBenchmarkCategory, OriginAnswerQualityBenchmarkObservation } from "./OriginAnswerQualityBenchmark";
import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  qualifyOriginAnswerQualityBenchmark,
  ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES,
} from "./OriginAnswerQualityBenchmarkQualification";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";

const sha256 = (char: string) => `sha256:${char.repeat(64)}`;

function cases() {
  return ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES.flatMap((category, familyIndex) =>
    Array.from({ length: 4 }, (_, caseIndex) => ({
      caseId: `f${familyIndex + 1}-case-${caseIndex + 1}`,
      category,
      caseDigest: sha256(((familyIndex + caseIndex) % 10).toString()),
    })),
  );
}

function manifest() {
  const result = createOriginAnswerQualityBenchmarkManifest(
    "aq-post-heldout",
    "v1",
    cases(),
  );
  if (!result.ok) throw new Error("manifest fixture invalid");
  return result.value;
}

function run(
  gitSha: string,
  runId: string,
  m: ReturnType<typeof manifest>,
) {
  const result = createOriginAnswerQualityBenchmarkRunProvenance({
    runId,
    gitSha,
    manifestDigest: m.manifestDigest,
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-09-19T00:00:00.000Z",
    completedAt: "2026-09-19T00:10:00.000Z",
  }, m);
  if (!result.ok) throw new Error("run fixture invalid");
  return result.value;
}

function observations(
  m: ReturnType<typeof manifest>,
  unsupportedMaterialClaimCount = 0,
): OriginAnswerQualityBenchmarkObservation[] {
  return m.cases.map((item) => ({
    caseId: item.caseId,
    category: item.category as OriginAnswerQualityBenchmarkCategory,
    factualSupportScore: 1,
    citationPrecisionScore: 1,
    taskCompletionScore: 1,
    contradictionDetectionScore: 1,
    verificationIntegrityScore: 1,
    failClosedAccuracyScore: 1,
    userActionabilityScore: 3,
    verifierRejectedUnsupportedClaim: true,
    repairSucceeded: item.category === "coding-repair" ? true : undefined,
    providerRequests: 1,
    latencyMs: 100,
    costUsd: 0,
    unsupportedMaterialClaimCount,
  }));
}

describe("OriginAnswerQualityBenchmarkQualification", () => {
  it("qualifies only an exact comparable 40-case ten-family benchmark", () => {
    const m = manifest();
    const result = qualifyOriginAnswerQualityBenchmark({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run("a".repeat(40), "baseline", m),
      candidateRun: run("b".repeat(40), "candidate", m),
      baselineObservations: observations(m, 1),
      candidateObservations: observations(m, 0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.caseCount).toBe(40);
    expect(result.value.familyCount).toBe(10);
    expect(result.value.hardGates.exactCorpusMatch).toBe(true);
    expect(result.value.hardGates.sameProviderAndModel).toBe(true);
    expect(result.value.hardGates.zeroCost).toBe(true);
    expect(result.value.hardGates.unsupportedClaimsNotWorse).toBe(true);
  });

  it("rejects a corpus that is not exactly four cases in each of ten families", () => {
    const m = manifest();
    const malformed = {
      ...m,
      cases: m.cases.slice(0, 39),
    };

    const result = qualifyOriginAnswerQualityBenchmark({
      baselineManifest: malformed,
      candidateManifest: malformed,
      baselineRun: { ...run("a".repeat(40), "baseline", m), manifestDigest: malformed.manifestDigest },
      candidateRun: { ...run("b".repeat(40), "candidate", m), manifestDigest: malformed.manifestDigest },
      baselineObservations: observations(m).slice(0, 39),
      candidateObservations: observations(m).slice(0, 39),
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_CORPUS_SHAPE_INVALID" });
  });

  it("rejects missing, duplicate, or category-swapped observations", () => {
    const m = manifest();
    const baseline = observations(m);
    const candidate = observations(m);
    candidate[0] = { ...candidate[0], category: "fail-closed" };

    const result = qualifyOriginAnswerQualityBenchmark({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run("a".repeat(40), "baseline", m),
      candidateRun: run("b".repeat(40), "candidate", m),
      baselineObservations: baseline,
      candidateObservations: candidate,
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_OBSERVATION_SET_MISMATCH" });
  });

  it("rejects before-after runs from different models", () => {
    const m = manifest();
    const candidateRun = {
      ...run("b".repeat(40), "candidate", m),
      modelId: "other/free-model:free",
    };

    const result = qualifyOriginAnswerQualityBenchmark({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run("a".repeat(40), "baseline", m),
      candidateRun,
      baselineObservations: observations(m),
      candidateObservations: observations(m),
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_RUN_NOT_COMPARABLE" });
  });

  it("surfaces unsupported-claim regression as a hard-gate failure", () => {
    const m = manifest();
    const result = qualifyOriginAnswerQualityBenchmark({
      baselineManifest: m,
      candidateManifest: m,
      baselineRun: run("a".repeat(40), "baseline", m),
      candidateRun: run("b".repeat(40), "candidate", m),
      baselineObservations: observations(m, 0),
      candidateObservations: observations(m, 1),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hardGates.unsupportedClaimsNotWorse).toBe(false);
  });
});
