import { createHash } from "node:crypto";

import type { OriginAnswerQualityBenchmarkObservation } from "./OriginAnswerQualityBenchmark.js";
import type { OriginAnswerQualityBenchmarkBoundRun } from "./OriginAnswerQualityBenchmarkRunBinding.js";
import type { OriginAnswerQualityBenchmarkMeasuredObservation } from "./OriginAnswerQualityBenchmarkScorecard.js";

export interface OriginAnswerQualityBenchmarkMeasuredBoundRun {
  readonly schemaVersion: "origin.aq-benchmark-measured-bound-run.v1";
  readonly boundRun: OriginAnswerQualityBenchmarkBoundRun;
  readonly measuredObservations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[];
  readonly measuredDigest: string;
}

export type OriginAnswerQualityBenchmarkMeasuredBoundRunResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkMeasuredBoundRun }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_MEASURED_BINDING_CASESET_MISMATCH"
        | "AQ_BENCHMARK_MEASURED_BINDING_BASE_MISMATCH";
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sameBaseObservation(
  base: OriginAnswerQualityBenchmarkObservation,
  measured: OriginAnswerQualityBenchmarkMeasuredObservation,
): boolean {
  return base.caseId === measured.caseId
    && base.category === measured.category
    && base.factualSupportScore === measured.factualSupportScore
    && base.citationPrecisionScore === measured.citationPrecisionScore
    && base.taskCompletionScore === measured.taskCompletionScore
    && base.contradictionDetectionScore === measured.contradictionDetectionScore
    && base.verifierRejectedUnsupportedClaim === measured.verifierRejectedUnsupportedClaim
    && base.repairSucceeded === measured.repairSucceeded
    && base.providerRequests === measured.providerRequests
    && base.latencyMs === measured.latencyMs
    && base.costUsd === measured.costUsd
    && base.unsupportedMaterialClaimCount === measured.unsupportedMaterialClaimCount;
}

function canonicalMeasured(item: OriginAnswerQualityBenchmarkMeasuredObservation): string {
  return [
    item.caseId,
    item.category,
    item.factualSupportScore,
    item.citationPrecisionScore,
    item.taskCompletionScore,
    item.contradictionDetectionScore,
    item.verifierRejectedUnsupportedClaim ? 1 : 0,
    item.repairSucceeded === undefined ? "na" : item.repairSucceeded ? 1 : 0,
    item.providerRequests,
    item.latencyMs,
    item.costUsd,
    item.unsupportedMaterialClaimCount,
    item.verificationIntegrityAccurate ? 1 : 0,
    item.failClosedCorrect === undefined ? "na" : item.failClosedCorrect ? 1 : 0,
    item.userActionabilityScore,
  ].join("\t");
}

export function bindOriginAnswerQualityMeasuredObservations(
  boundRun: OriginAnswerQualityBenchmarkBoundRun,
  measuredObservations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[],
): OriginAnswerQualityBenchmarkMeasuredBoundRunResult {
  if (
    measuredObservations.length !== boundRun.scoredCases.length
    || measuredObservations.length !== boundRun.caseCount
  ) {
    return { ok: false, code: "AQ_BENCHMARK_MEASURED_BINDING_CASESET_MISMATCH" };
  }

  const baseById = new Map(
    boundRun.scoredCases.map((item) => [item.observation.caseId, item.observation] as const),
  );
  const seen = new Set<string>();

  for (const measured of measuredObservations) {
    if (seen.has(measured.caseId)) {
      return { ok: false, code: "AQ_BENCHMARK_MEASURED_BINDING_CASESET_MISMATCH" };
    }
    seen.add(measured.caseId);

    const base = baseById.get(measured.caseId);
    if (!base) {
      return { ok: false, code: "AQ_BENCHMARK_MEASURED_BINDING_CASESET_MISMATCH" };
    }
    if (!sameBaseObservation(base, measured)) {
      return { ok: false, code: "AQ_BENCHMARK_MEASURED_BINDING_BASE_MISMATCH" };
    }
  }

  const canonical = [...measuredObservations]
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
    .map(canonicalMeasured)
    .join("\n");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-measured-bound-run.v1",
      boundRun,
      measuredObservations: Object.freeze(measuredObservations.map((item) => Object.freeze({ ...item }))),
      measuredDigest: sha256(`${boundRun.executionDigest}\n${canonical}`),
    }),
  };
}
