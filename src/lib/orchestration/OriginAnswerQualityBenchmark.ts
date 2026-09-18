export type OriginAnswerQualityBenchmarkCategory =
  | "current-factual"
  | "multi-source-comparison"
  | "contradiction-detection"
  | "user-document-reasoning"
  | "professional-advice"
  | "coding-generation"
  | "coding-repair"
  | "artifact-generation"
  | "ambiguity-handling"
  | "fail-closed"
  | "citation-precision";

export interface OriginAnswerQualityBenchmarkObservation {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly factualSupportScore: number;
  readonly citationPrecisionScore: number;
  readonly taskCompletionScore: number;
  readonly contradictionDetectionScore: number;
  readonly verificationIntegrityScore: number;
  readonly failClosedAccuracyScore: number;
  readonly userActionabilityScore: number;
  readonly verifierRejectedUnsupportedClaim: boolean;
  readonly repairSucceeded?: boolean;
  readonly providerRequests: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly unsupportedMaterialClaimCount: number;
}

export interface OriginAnswerQualityBenchmarkAggregate {
  readonly schemaVersion: "origin.aq-benchmark.v1";
  readonly caseCount: number;
  readonly categoryCount: number;
  readonly meanFactualSupport: number;
  readonly meanCitationPrecision: number;
  readonly meanTaskCompletion: number;
  readonly meanContradictionDetection: number;
  readonly meanVerificationIntegrity: number;
  readonly meanFailClosedAccuracy: number;
  readonly meanUserActionability: number;
  readonly unsupportedMaterialClaimCount: number;
  readonly verifierRejectionRate: number;
  readonly repairSuccessRate: number | null;
  readonly totalProviderRequests: number;
  readonly meanLatencyMs: number;
  readonly totalCostUsd: number;
}

export type OriginAnswerQualityBenchmarkResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkAggregate }
  | { ok: false; code: "INVALID_BENCHMARK_OBSERVATION" | "EMPTY_BENCHMARK" };

function boundedScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validObservation(item: OriginAnswerQualityBenchmarkObservation): boolean {
  return item.caseId.trim().length > 0
    && boundedScore(item.factualSupportScore)
    && boundedScore(item.citationPrecisionScore)
    && boundedScore(item.taskCompletionScore)
    && boundedScore(item.contradictionDetectionScore)
    && boundedScore(item.verificationIntegrityScore)
    && boundedScore(item.failClosedAccuracyScore)
    && Number.isInteger(item.userActionabilityScore)
    && item.userActionabilityScore >= 0
    && item.userActionabilityScore <= 3
    && Number.isInteger(item.providerRequests)
    && item.providerRequests >= 0
    && Number.isFinite(item.latencyMs)
    && item.latencyMs >= 0
    && Number.isFinite(item.costUsd)
    && item.costUsd === 0
    && Number.isInteger(item.unsupportedMaterialClaimCount)
    && item.unsupportedMaterialClaimCount >= 0;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}


export function aggregateOriginAnswerQualityBenchmark(
  observations: readonly OriginAnswerQualityBenchmarkObservation[],
): OriginAnswerQualityBenchmarkResult {
  if (observations.length === 0) return { ok: false, code: "EMPTY_BENCHMARK" };
  if (!observations.every(validObservation)) {
    return { ok: false, code: "INVALID_BENCHMARK_OBSERVATION" };
  }

  const repairCases = observations.filter((item) => item.repairSucceeded !== undefined);
  const verifierCases = observations.filter((item) => item.unsupportedMaterialClaimCount > 0);
  const result: OriginAnswerQualityBenchmarkAggregate = {
    schemaVersion: "origin.aq-benchmark.v1",
    caseCount: observations.length,
    categoryCount: new Set(observations.map((item) => item.category)).size,
    meanFactualSupport: mean(observations.map((item) => item.factualSupportScore)),
    meanCitationPrecision: mean(observations.map((item) => item.citationPrecisionScore)),
    meanTaskCompletion: mean(observations.map((item) => item.taskCompletionScore)),
    meanContradictionDetection: mean(observations.map((item) => item.contradictionDetectionScore)),
    meanVerificationIntegrity: mean(observations.map((item) => item.verificationIntegrityScore)),
    meanFailClosedAccuracy: mean(observations.map((item) => item.failClosedAccuracyScore)),
    meanUserActionability: mean(observations.map((item) => item.userActionabilityScore)),
    unsupportedMaterialClaimCount: observations.reduce(
      (sum, item) => sum + item.unsupportedMaterialClaimCount,
      0,
    ),
    verifierRejectionRate: verifierCases.length === 0
      ? 1
      : mean(verifierCases.map((item) => item.verifierRejectedUnsupportedClaim ? 1 : 0)),
    repairSuccessRate: repairCases.length === 0
      ? null
      : mean(repairCases.map((item) => item.repairSucceeded ? 1 : 0)),
    totalProviderRequests: observations.reduce((sum, item) => sum + item.providerRequests, 0),
    meanLatencyMs: mean(observations.map((item) => item.latencyMs)),
    totalCostUsd: observations.reduce((sum, item) => sum + item.costUsd, 0),
  };

  return { ok: true, value: Object.freeze(result) };
}

export interface OriginAnswerQualityBenchmarkDelta {
  readonly factualSupportDelta: number;
  readonly citationPrecisionDelta: number;
  readonly taskCompletionDelta: number;
  readonly contradictionDetectionDelta: number;
  readonly verificationIntegrityDelta: number;
  readonly failClosedAccuracyDelta: number;
  readonly userActionabilityDelta: number;
  readonly unsupportedMaterialClaimDelta: number;
  readonly verifierRejectionRateDelta: number;
  readonly repairSuccessRateDelta: number | null;
  readonly providerRequestDelta: number;
  readonly latencyMsDelta: number;
  readonly totalCostUsdDelta: number;
}

export function compareOriginAnswerQualityBenchmark(
  baseline: OriginAnswerQualityBenchmarkAggregate,
  candidate: OriginAnswerQualityBenchmarkAggregate,
): OriginAnswerQualityBenchmarkDelta {
  const repairSuccessRateDelta = baseline.repairSuccessRate === null || candidate.repairSuccessRate === null
    ? null
    : candidate.repairSuccessRate - baseline.repairSuccessRate;

  return Object.freeze({
    factualSupportDelta: candidate.meanFactualSupport - baseline.meanFactualSupport,
    citationPrecisionDelta: candidate.meanCitationPrecision - baseline.meanCitationPrecision,
    taskCompletionDelta: candidate.meanTaskCompletion - baseline.meanTaskCompletion,
    contradictionDetectionDelta: candidate.meanContradictionDetection - baseline.meanContradictionDetection,
    verificationIntegrityDelta: candidate.meanVerificationIntegrity - baseline.meanVerificationIntegrity,
    failClosedAccuracyDelta: candidate.meanFailClosedAccuracy - baseline.meanFailClosedAccuracy,
    userActionabilityDelta: candidate.meanUserActionability - baseline.meanUserActionability,
    unsupportedMaterialClaimDelta:
      candidate.unsupportedMaterialClaimCount - baseline.unsupportedMaterialClaimCount,
    verifierRejectionRateDelta: candidate.verifierRejectionRate - baseline.verifierRejectionRate,
    repairSuccessRateDelta,
    providerRequestDelta: candidate.totalProviderRequests - baseline.totalProviderRequests,
    latencyMsDelta: candidate.meanLatencyMs - baseline.meanLatencyMs,
    totalCostUsdDelta: candidate.totalCostUsd - baseline.totalCostUsd,
  });
}
