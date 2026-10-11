import { describe, expect, it } from "vitest";
import { auditOriginAq40CurrentProductionEvidence } from "./OriginAq40CurrentProductionGateV1.js";
import { ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES } from "../lib/orchestration/OriginAnswerQualityBenchmarkQualification.js";
import { createOriginAnswerQualityBenchmarkManifest } from "../lib/orchestration/OriginAnswerQualityBenchmarkManifest.js";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "../lib/orchestration/OriginAnswerQualityBenchmarkRunProvenance.js";
import type { OriginAnswerQualityBenchmarkObservation } from "../lib/orchestration/OriginAnswerQualityBenchmark.js";

const prodSha = "4".repeat(40);
const candidateSha = "b".repeat(40);
const mainSha = "c".repeat(40);

const entries = ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES.flatMap((category, idx) =>
  Array.from({ length: 4 }, (_, j) => ({
    caseId: `aq40-${idx}-${j}`,
    category,
    caseDigest: `sha256:${(idx + j).toString(16).repeat(64)}`,
  })),
);
const manifestResult = createOriginAnswerQualityBenchmarkManifest("aq-post-heldout-public", "v1", entries);
if (!manifestResult.ok) throw new Error("AQ40_TEST_MANIFEST_INVALID");
const manifest = manifestResult.value;

function run(sha: string, id: string) {
  const r = createOriginAnswerQualityBenchmarkRunProvenance({
    runId: id,
    gitSha: sha,
    manifestDigest: manifest.manifestDigest,
    providerId: "openrouter-free",
    modelId: "approved-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-10-10T00:00:00.000Z",
    completedAt: "2026-10-10T00:01:00.000Z",
  }, manifest);
  if (!r.ok) throw new Error("AQ40_TEST_RUN_INVALID");
  return r.value;
}
function observations(): OriginAnswerQualityBenchmarkObservation[] {
  return manifest.cases.map((item) => ({
    caseId: item.caseId,
    category: item.category,
    factualSupportScore: 1,
    citationPrecisionScore: 1,
    taskCompletionScore: 1,
    contradictionDetectionScore: 1,
    verifierRejectedUnsupportedClaim: true,
    providerRequests: item.category === "current-factual" ? 0 : 1,
    latencyMs: 50,
    costUsd: 0,
    unsupportedMaterialClaimCount: 0,
  }));
}
function fixture() {
  return {
    currentProductionSha: prodSha,
    candidateHeadSha: candidateSha,
    currentMainSha: mainSha,
    mergeBaseSha: mainSha,
    candidateBehindMain: 0,
    baselineManifest: manifest,
    candidateManifest: manifest,
    baselineRun: run(prodSha, "baseline"),
    candidateRun: run(candidateSha, "candidate"),
    baselineObservations: observations(),
    candidateObservations: observations(),
  };
}

describe("AQ40 current-production release-readiness diagnostic", () => {
  it("never authorizes Production even with 40 structurally valid pairs", () => {
    expect(auditOriginAq40CurrentProductionEvidence(fixture())).toEqual({
      status: "REVIEW_REQUIRED",
      code: "AQ40_STRUCTURE_ONLY_EXTERNAL_ATTESTATION_REQUIRED",
      measuredPairedCases: 40,
      structuralNoUnsupportedClaimRegression: true,
      productionPromotionAllowed: false,
    });
  });

  it("rejects comparing an old frozen baseline as if it were current Production", () => {
    const input = fixture();
    const output = auditOriginAq40CurrentProductionEvidence({
      ...input,
      baselineRun: run("f".repeat(40), "historical-baseline"),
    });
    expect(output).toMatchObject({
      status: "BLOCKED",
      code: "AQ40_WRONG_PRODUCTION_BASELINE",
      productionPromotionAllowed: false,
    });
  });

  it("rejects a stale/diverged candidate or changed PR head", () => {
    const x = fixture();
    expect(auditOriginAq40CurrentProductionEvidence({ ...x, candidateBehindMain: 1 })).toMatchObject({
      status: "BLOCKED", code: "AQ40_NOT_CURRENT_MAIN_BASED",
    });
    expect(auditOriginAq40CurrentProductionEvidence({ ...x, mergeBaseSha: prodSha })).toMatchObject({
      status: "BLOCKED", code: "AQ40_NOT_CURRENT_MAIN_BASED",
    });
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateRun: run("a".repeat(40), "stale-candidate"),
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_CANDIDATE_HEAD_CHANGED" });
  });

  it("never calls 39 pairs a completed 40-case comparison", () => {
    const x = fixture();
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateObservations: x.candidateObservations.slice(0, 39),
    })).toEqual({
      status: "NOT_MEASURED",
      code: "AQ40_PAIRED_CASES_INCOMPLETE",
      measuredPairedCases: 39,
      productionPromotionAllowed: false,
    });
  });

  it("rejects duplicate cases, swapped categories, and nonzero/unknown cost", () => {
    const x = fixture();
    const duplicates = [...x.candidateObservations];
    duplicates[1] = { ...duplicates[0] };
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateObservations: duplicates,
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_INVALID_EVIDENCE" });

    const categorySwap = [...x.candidateObservations];
    categorySwap[0] = { ...categorySwap[0], category: "citation-precision" };
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateObservations: categorySwap,
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_INVALID_EVIDENCE" });

    const billed = [...x.candidateObservations];
    billed[0] = { ...billed[0], costUsd: Number.MIN_VALUE };
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateObservations: billed,
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_INVALID_EVIDENCE" });

    const unknown = [...x.candidateObservations];
    unknown[0] = { ...unknown[0], costUsd: NaN };
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateObservations: unknown,
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_INVALID_EVIDENCE" });
  });

  it("fails closed when model identity changes or unsupported claims regress", () => {
    const x = fixture();
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateRun: { ...x.candidateRun, modelId: "unapproved-other-model:free" },
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_INVALID_EVIDENCE" });

    const regression = [...x.candidateObservations];
    regression[0] = { ...regression[0], unsupportedMaterialClaimCount: 1 };
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateObservations: regression,
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_INVALID_EVIDENCE" });
  });

  it("rejects fake all-zero request counts as NOT_MEASURED", () => {
    const x = fixture();
    const neverCalled = x.candidateObservations.map((item) => ({ ...item, providerRequests: 0 }));
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateObservations: neverCalled,
    })).toMatchObject({
      status: "NOT_MEASURED", code: "AQ40_NO_ACTUAL_PROVIDER_EXECUTION",
      measuredPairedCases: 0, productionPromotionAllowed: false,
    });
  });

  it("rejects using the same release for baseline, candidate or main", () => {
    const x = fixture();
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateHeadSha: prodSha,
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_IDENTITY_INVALID" });
    expect(auditOriginAq40CurrentProductionEvidence({
      ...x, candidateHeadSha: mainSha,
    })).toMatchObject({ status: "BLOCKED", code: "AQ40_IDENTITY_INVALID" });
  });
});
