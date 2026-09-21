import { createHash } from "node:crypto";

import type { OriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest.js";
import {
  decideOriginAnswerQualityBenchmarkMeasuredPromotion,
  type OriginAnswerQualityBenchmarkMeasuredPromotionDecision,
} from "./OriginAnswerQualityBenchmarkMeasuredPromotion.js";
import type { OriginAnswerQualityBenchmarkMeasuredBoundRun } from "./OriginAnswerQualityBenchmarkMeasuredRunBinding.js";
import type { OriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance.js";

export interface OriginAnswerQualityBenchmarkEvaluationBundle {
  readonly schemaVersion: "origin.aq-benchmark-evaluation-bundle.v1";
  readonly manifestDigest: string;
  readonly baselineGitSha: string;
  readonly candidateGitSha: string;
  readonly baselineExecutionDigest: string;
  readonly candidateExecutionDigest: string;
  readonly baselineMeasuredDigest: string;
  readonly candidateMeasuredDigest: string;
  readonly decision: OriginAnswerQualityBenchmarkMeasuredPromotionDecision;
  readonly bundleDigest: string;
}

export type OriginAnswerQualityBenchmarkEvaluationBundleResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkEvaluationBundle }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_BUNDLE_BASELINE_MANIFEST_MISMATCH"
        | "AQ_BENCHMARK_BUNDLE_CANDIDATE_MANIFEST_MISMATCH"
        | "AQ_BENCHMARK_BUNDLE_PROMOTION_INVALID";
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function provenanceFromBoundRun(
  input: OriginAnswerQualityBenchmarkMeasuredBoundRun,
): OriginAnswerQualityBenchmarkRunProvenance {
  const run = input.boundRun;
  return {
    schemaVersion: "origin.aq-benchmark-run.v1",
    runId: run.runId,
    gitSha: run.gitSha,
    manifestDigest: run.manifestDigest,
    providerId: run.providerId,
    modelId: run.modelId,
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

export function buildOriginAnswerQualityBenchmarkEvaluationBundle(
  baselineManifest: OriginAnswerQualityBenchmarkManifest,
  candidateManifest: OriginAnswerQualityBenchmarkManifest,
  baseline: OriginAnswerQualityBenchmarkMeasuredBoundRun,
  candidate: OriginAnswerQualityBenchmarkMeasuredBoundRun,
): OriginAnswerQualityBenchmarkEvaluationBundleResult {
  if (baseline.boundRun.manifestDigest !== baselineManifest.manifestDigest) {
    return { ok: false, code: "AQ_BENCHMARK_BUNDLE_BASELINE_MANIFEST_MISMATCH" };
  }
  if (candidate.boundRun.manifestDigest !== candidateManifest.manifestDigest) {
    return { ok: false, code: "AQ_BENCHMARK_BUNDLE_CANDIDATE_MANIFEST_MISMATCH" };
  }

  const promotion = decideOriginAnswerQualityBenchmarkMeasuredPromotion({
    baselineManifest,
    candidateManifest,
    baselineRun: provenanceFromBoundRun(baseline),
    candidateRun: provenanceFromBoundRun(candidate),
    baselineMeasuredObservations: baseline.measuredObservations,
    candidateMeasuredObservations: candidate.measuredObservations,
  });

  if (!promotion.ok) {
    return { ok: false, code: "AQ_BENCHMARK_BUNDLE_PROMOTION_INVALID" };
  }

  const canonical = [
    baselineManifest.manifestDigest,
    baseline.boundRun.gitSha,
    candidate.boundRun.gitSha,
    baseline.boundRun.executionDigest,
    candidate.boundRun.executionDigest,
    baseline.measuredDigest,
    candidate.measuredDigest,
    promotion.value.promotionEligible ? "eligible" : "blocked",
    promotion.value.blockers.join(","),
    promotion.value.userActionabilityRegressionFamilies.join(","),
  ].join("\n");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-evaluation-bundle.v1",
      manifestDigest: baselineManifest.manifestDigest,
      baselineGitSha: baseline.boundRun.gitSha,
      candidateGitSha: candidate.boundRun.gitSha,
      baselineExecutionDigest: baseline.boundRun.executionDigest,
      candidateExecutionDigest: candidate.boundRun.executionDigest,
      baselineMeasuredDigest: baseline.measuredDigest,
      candidateMeasuredDigest: candidate.measuredDigest,
      decision: promotion.value,
      bundleDigest: sha256(canonical),
    }),
  };
}
