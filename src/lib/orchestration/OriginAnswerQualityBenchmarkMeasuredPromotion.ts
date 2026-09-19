import type { OriginAnswerQualityBenchmarkCategory } from "./OriginAnswerQualityBenchmark.js";
import {
  buildOriginAnswerQualityBenchmarkReleaseReport,
  type OriginAnswerQualityBenchmarkReleaseReport,
} from "./OriginAnswerQualityBenchmarkReleaseReport.js";
import {
  buildOriginAnswerQualityBenchmarkScorecard,
  compareOriginAnswerQualityBenchmarkScorecards,
  type OriginAnswerQualityBenchmarkMeasuredObservation,
  type OriginAnswerQualityBenchmarkMeasuredScorecard,
  type OriginAnswerQualityBenchmarkScorecardDelta,
} from "./OriginAnswerQualityBenchmarkScorecard.js";
import type { OriginAnswerQualityBenchmarkQualificationInput } from "./OriginAnswerQualityBenchmarkQualification.js";

export type OriginAnswerQualityBenchmarkMeasuredPromotionInput =
  Omit<
    OriginAnswerQualityBenchmarkQualificationInput,
    "baselineObservations" | "candidateObservations"
  > & {
    readonly baselineMeasuredObservations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[];
    readonly candidateMeasuredObservations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[];
  };

export interface OriginAnswerQualityBenchmarkMeasuredPromotionDecision {
  readonly schemaVersion: "origin.aq-benchmark-measured-promotion.v1";
  readonly releaseReport: OriginAnswerQualityBenchmarkReleaseReport;
  readonly baselineScorecard: OriginAnswerQualityBenchmarkMeasuredScorecard;
  readonly candidateScorecard: OriginAnswerQualityBenchmarkMeasuredScorecard;
  readonly scorecardDelta: OriginAnswerQualityBenchmarkScorecardDelta;
  readonly userActionabilityRegressionFamilies: readonly OriginAnswerQualityBenchmarkCategory[];
  readonly promotionEligible: boolean;
  readonly blockers: readonly (
    | "BASE_RELEASE_REPORT_BLOCKED"
    | "VERIFICATION_INTEGRITY_REGRESSED"
    | "FAIL_CLOSED_ACCURACY_REGRESSED"
    | "USER_ACTIONABILITY_REGRESSED"
  )[];
}

export type OriginAnswerQualityBenchmarkMeasuredPromotionResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkMeasuredPromotionDecision }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_RELEASE_REPORT_INVALID"
        | "AQ_BENCHMARK_BASELINE_SCORECARD_INVALID"
        | "AQ_BENCHMARK_CANDIDATE_SCORECARD_INVALID";
    };

export function decideOriginAnswerQualityBenchmarkMeasuredPromotion(
  input: OriginAnswerQualityBenchmarkMeasuredPromotionInput,
): OriginAnswerQualityBenchmarkMeasuredPromotionResult {
  const report = buildOriginAnswerQualityBenchmarkReleaseReport({
    baselineManifest: input.baselineManifest,
    candidateManifest: input.candidateManifest,
    baselineRun: input.baselineRun,
    candidateRun: input.candidateRun,
    baselineObservations: input.baselineMeasuredObservations,
    candidateObservations: input.candidateMeasuredObservations,
  });
  if (!report.ok) return { ok: false, code: "AQ_BENCHMARK_RELEASE_REPORT_INVALID" };

  const baselineScorecard = buildOriginAnswerQualityBenchmarkScorecard(
    input.baselineManifest,
    input.baselineMeasuredObservations,
  );
  if (!baselineScorecard.ok) {
    return { ok: false, code: "AQ_BENCHMARK_BASELINE_SCORECARD_INVALID" };
  }

  const candidateScorecard = buildOriginAnswerQualityBenchmarkScorecard(
    input.candidateManifest,
    input.candidateMeasuredObservations,
  );
  if (!candidateScorecard.ok) {
    return { ok: false, code: "AQ_BENCHMARK_CANDIDATE_SCORECARD_INVALID" };
  }

  const delta = compareOriginAnswerQualityBenchmarkScorecards(
    baselineScorecard.value,
    candidateScorecard.value,
  );

  const userActionabilityRegressionFamilies = Object.entries(
    baselineScorecard.value.perFamily,
  ).flatMap(([category, baselineFamily]) => {
    const candidateFamily = candidateScorecard.value.perFamily[
      category as OriginAnswerQualityBenchmarkCategory
    ];
    if (!candidateFamily) return [category as OriginAnswerQualityBenchmarkCategory];
    return candidateFamily.meanUserActionability < baselineFamily.meanUserActionability
      ? [category as OriginAnswerQualityBenchmarkCategory]
      : [];
  });

  const blockers: OriginAnswerQualityBenchmarkMeasuredPromotionDecision["blockers"][number][] = [];
  if (!report.value.promotionEligible) blockers.push("BASE_RELEASE_REPORT_BLOCKED");
  if (delta.verificationIntegrityRateDelta < 0) blockers.push("VERIFICATION_INTEGRITY_REGRESSED");
  if (delta.failClosedAccuracyDelta !== null && delta.failClosedAccuracyDelta < 0) {
    blockers.push("FAIL_CLOSED_ACCURACY_REGRESSED");
  }
  if (userActionabilityRegressionFamilies.length > 0) {
    blockers.push("USER_ACTIONABILITY_REGRESSED");
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-measured-promotion.v1",
      releaseReport: report.value,
      baselineScorecard: baselineScorecard.value,
      candidateScorecard: candidateScorecard.value,
      scorecardDelta: delta,
      userActionabilityRegressionFamilies: Object.freeze(userActionabilityRegressionFamilies),
      promotionEligible: blockers.length === 0,
      blockers: Object.freeze(blockers),
    }),
  };
}
