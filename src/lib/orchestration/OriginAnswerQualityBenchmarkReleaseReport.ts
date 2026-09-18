import type {
  OriginAnswerQualityBenchmarkCategory,
  OriginAnswerQualityBenchmarkObservation,
} from "./OriginAnswerQualityBenchmark.js";
import {
  qualifyOriginAnswerQualityBenchmark,
  ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES,
  type OriginAnswerQualityBenchmarkQualificationInput,
} from "./OriginAnswerQualityBenchmarkQualification.js";

export interface OriginAnswerQualityBenchmarkFamilyReport {
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly baselineCaseCount: number;
  readonly candidateCaseCount: number;
  readonly factualSupportDelta: number;
  readonly citationPrecisionDelta: number;
  readonly taskCompletionDelta: number;
  readonly contradictionDetectionDelta: number;
  readonly unsupportedMaterialClaimDelta: number;
  readonly verifierRejectionRateDelta: number;
  readonly repairSuccessRateDelta: number | null;
}

export interface OriginAnswerQualityBenchmarkReleaseReport {
  readonly schemaVersion: "origin.aq-benchmark-release-report.v1";
  readonly qualification: ReturnType<typeof qualifyOriginAnswerQualityBenchmark> extends { ok: true; value: infer T } ? T : never;
  readonly families: readonly OriginAnswerQualityBenchmarkFamilyReport[];
  readonly regressionFamilies: readonly OriginAnswerQualityBenchmarkCategory[];
  readonly targetedImprovementObserved: boolean;
  readonly promotionEligible: boolean;
  readonly blockers: readonly (
    | "UNSUPPORTED_CLAIMS_REGRESSED"
    | "VERIFIER_INTEGRITY_REGRESSED"
    | "CRITICAL_FAMILY_REGRESSION"
    | "NO_TARGETED_IMPROVEMENT"
  )[];
}

export type OriginAnswerQualityBenchmarkReleaseReportResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkReleaseReport }
  | { ok: false; code: "AQ_BENCHMARK_NOT_QUALIFIED" };

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function repairRate(items: readonly OriginAnswerQualityBenchmarkObservation[]): number | null {
  const repair = items.filter((item) => item.repairSucceeded !== undefined);
  if (repair.length === 0) return null;
  return mean(repair.map((item) => item.repairSucceeded ? 1 : 0));
}

function familyReport(
  category: OriginAnswerQualityBenchmarkCategory,
  baseline: readonly OriginAnswerQualityBenchmarkObservation[],
  candidate: readonly OriginAnswerQualityBenchmarkObservation[],
): OriginAnswerQualityBenchmarkFamilyReport {
  const b = baseline.filter((item) => item.category === category);
  const c = candidate.filter((item) => item.category === category);
  const bRepair = repairRate(b);
  const cRepair = repairRate(c);

  return Object.freeze({
    category,
    baselineCaseCount: b.length,
    candidateCaseCount: c.length,
    factualSupportDelta: mean(c.map((item) => item.factualSupportScore)) - mean(b.map((item) => item.factualSupportScore)),
    citationPrecisionDelta: mean(c.map((item) => item.citationPrecisionScore)) - mean(b.map((item) => item.citationPrecisionScore)),
    taskCompletionDelta: mean(c.map((item) => item.taskCompletionScore)) - mean(b.map((item) => item.taskCompletionScore)),
    contradictionDetectionDelta:
      mean(c.map((item) => item.contradictionDetectionScore)) - mean(b.map((item) => item.contradictionDetectionScore)),
    unsupportedMaterialClaimDelta:
      c.reduce((sum, item) => sum + item.unsupportedMaterialClaimCount, 0)
      - b.reduce((sum, item) => sum + item.unsupportedMaterialClaimCount, 0),
    verifierRejectionRateDelta:
      mean(c.map((item) => item.verifierRejectedUnsupportedClaim ? 1 : 0))
      - mean(b.map((item) => item.verifierRejectedUnsupportedClaim ? 1 : 0)),
    repairSuccessRateDelta: bRepair === null || cRepair === null ? null : cRepair - bRepair,
  });
}

function isCriticalRegression(report: OriginAnswerQualityBenchmarkFamilyReport): boolean {
  return report.unsupportedMaterialClaimDelta > 0
    || report.verifierRejectionRateDelta < 0
    || report.factualSupportDelta < 0
    || report.taskCompletionDelta < 0
    || report.citationPrecisionDelta < 0
    || report.contradictionDetectionDelta < 0
    || (report.repairSuccessRateDelta !== null && report.repairSuccessRateDelta < 0);
}

function hasTargetedImprovement(report: OriginAnswerQualityBenchmarkFamilyReport): boolean {
  return report.factualSupportDelta > 0
    || report.citationPrecisionDelta > 0
    || report.taskCompletionDelta > 0
    || report.contradictionDetectionDelta > 0
    || report.unsupportedMaterialClaimDelta < 0
    || report.verifierRejectionRateDelta > 0
    || (report.repairSuccessRateDelta !== null && report.repairSuccessRateDelta > 0);
}

export function buildOriginAnswerQualityBenchmarkReleaseReport(
  input: OriginAnswerQualityBenchmarkQualificationInput,
): OriginAnswerQualityBenchmarkReleaseReportResult {
  const qualification = qualifyOriginAnswerQualityBenchmark(input);
  if (!qualification.ok) return { ok: false, code: "AQ_BENCHMARK_NOT_QUALIFIED" };

  const families = ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES.map((category) =>
    familyReport(category, input.baselineObservations, input.candidateObservations)
  );
  const regressionFamilies = families.filter(isCriticalRegression).map((item) => item.category);
  const targetedImprovementObserved = families.some(hasTargetedImprovement);

  const blockers: OriginAnswerQualityBenchmarkReleaseReport["blockers"][number][] = [];
  if (!qualification.value.hardGates.unsupportedClaimsNotWorse) blockers.push("UNSUPPORTED_CLAIMS_REGRESSED");
  if (!qualification.value.hardGates.verifierRejectionRateNotWorse) blockers.push("VERIFIER_INTEGRITY_REGRESSED");
  if (regressionFamilies.length > 0) blockers.push("CRITICAL_FAMILY_REGRESSION");
  if (!targetedImprovementObserved) blockers.push("NO_TARGETED_IMPROVEMENT");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-release-report.v1",
      qualification: qualification.value,
      families: Object.freeze(families),
      regressionFamilies: Object.freeze(regressionFamilies),
      targetedImprovementObserved,
      promotionEligible: blockers.length === 0,
      blockers: Object.freeze(blockers),
    }),
  };
}
