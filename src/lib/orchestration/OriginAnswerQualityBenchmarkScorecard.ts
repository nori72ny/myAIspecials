import type {
  OriginAnswerQualityBenchmarkCategory,
  OriginAnswerQualityBenchmarkObservation,
} from "./OriginAnswerQualityBenchmark.js";
import type { OriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest.js";

export interface OriginAnswerQualityBenchmarkMeasuredObservation
  extends OriginAnswerQualityBenchmarkObservation {
  readonly verificationIntegrityAccurate: boolean;
  readonly failClosedCorrect?: boolean;
  readonly userActionabilityScore: 0 | 1 | 2 | 3;
}

export interface OriginAnswerQualityBenchmarkMeasuredScorecard {
  readonly schemaVersion: "origin.aq-benchmark-scorecard.v1";
  readonly caseCount: number;
  readonly verificationIntegrityRate: number;
  readonly failClosedAccuracy: number | null;
  readonly meanUserActionability: number;
  readonly medianLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly perFamily: Readonly<Record<OriginAnswerQualityBenchmarkCategory, {
    readonly caseCount: number;
    readonly verificationIntegrityRate: number;
    readonly failClosedAccuracy: number | null;
    readonly meanUserActionability: number;
    readonly medianLatencyMs: number;
    readonly p95LatencyMs: number;
  }>>;
}

export type OriginAnswerQualityBenchmarkScorecardResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkMeasuredScorecard }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SCORECARD_CASESET_MISMATCH"
        | "AQ_BENCHMARK_SCORECARD_INVALID_MEASUREMENT";
    };

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function validMeasurement(item: OriginAnswerQualityBenchmarkMeasuredObservation): boolean {
  return Number.isInteger(item.userActionabilityScore)
    && item.userActionabilityScore >= 0
    && item.userActionabilityScore <= 3
    && typeof item.verificationIntegrityAccurate === "boolean"
    && (item.failClosedCorrect === undefined || typeof item.failClosedCorrect === "boolean")
    && Number.isFinite(item.latencyMs)
    && item.latencyMs >= 0;
}

function scoreSlice(items: readonly OriginAnswerQualityBenchmarkMeasuredObservation[]) {
  const failClosedItems = items.filter((item) => item.failClosedCorrect !== undefined);
  return Object.freeze({
    caseCount: items.length,
    verificationIntegrityRate: mean(items.map((item) => item.verificationIntegrityAccurate ? 1 : 0)),
    failClosedAccuracy: failClosedItems.length === 0
      ? null
      : mean(failClosedItems.map((item) => item.failClosedCorrect ? 1 : 0)),
    meanUserActionability: mean(items.map((item) => item.userActionabilityScore)),
    medianLatencyMs: percentile(items.map((item) => item.latencyMs), 0.5),
    p95LatencyMs: percentile(items.map((item) => item.latencyMs), 0.95),
  });
}

export function buildOriginAnswerQualityBenchmarkScorecard(
  manifest: OriginAnswerQualityBenchmarkManifest,
  observations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[],
): OriginAnswerQualityBenchmarkScorecardResult {
  if (observations.length !== manifest.cases.length || observations.length === 0) {
    return { ok: false, code: "AQ_BENCHMARK_SCORECARD_CASESET_MISMATCH" };
  }

  const expected = new Map(manifest.cases.map((item) => [item.caseId, item.category] as const));
  const seen = new Set<string>();
  for (const item of observations) {
    if (
      seen.has(item.caseId)
      || expected.get(item.caseId) !== item.category
      || !validMeasurement(item)
    ) {
      return {
        ok: false,
        code: seen.has(item.caseId) || expected.get(item.caseId) !== item.category
          ? "AQ_BENCHMARK_SCORECARD_CASESET_MISMATCH"
          : "AQ_BENCHMARK_SCORECARD_INVALID_MEASUREMENT",
      };
    }
    seen.add(item.caseId);
  }

  const categories = [...new Set(manifest.cases.map((item) => item.category))];
  const perFamily = Object.fromEntries(
    categories.map((category) => [
      category,
      scoreSlice(observations.filter((item) => item.category === category)),
    ]),
  ) as OriginAnswerQualityBenchmarkMeasuredScorecard["perFamily"];

  const total = scoreSlice(observations);

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-scorecard.v1",
      caseCount: observations.length,
      verificationIntegrityRate: total.verificationIntegrityRate,
      failClosedAccuracy: total.failClosedAccuracy,
      meanUserActionability: total.meanUserActionability,
      medianLatencyMs: total.medianLatencyMs,
      p95LatencyMs: total.p95LatencyMs,
      perFamily: Object.freeze(perFamily),
    }),
  };
}

export interface OriginAnswerQualityBenchmarkScorecardDelta {
  readonly verificationIntegrityRateDelta: number;
  readonly failClosedAccuracyDelta: number | null;
  readonly meanUserActionabilityDelta: number;
  readonly medianLatencyMsDelta: number;
  readonly p95LatencyMsDelta: number;
}

export function compareOriginAnswerQualityBenchmarkScorecards(
  baseline: OriginAnswerQualityBenchmarkMeasuredScorecard,
  candidate: OriginAnswerQualityBenchmarkMeasuredScorecard,
): OriginAnswerQualityBenchmarkScorecardDelta {
  return Object.freeze({
    verificationIntegrityRateDelta:
      candidate.verificationIntegrityRate - baseline.verificationIntegrityRate,
    failClosedAccuracyDelta:
      baseline.failClosedAccuracy === null || candidate.failClosedAccuracy === null
        ? null
        : candidate.failClosedAccuracy - baseline.failClosedAccuracy,
    meanUserActionabilityDelta:
      candidate.meanUserActionability - baseline.meanUserActionability,
    medianLatencyMsDelta: candidate.medianLatencyMs - baseline.medianLatencyMs,
    p95LatencyMsDelta: candidate.p95LatencyMs - baseline.p95LatencyMs,
  });
}
