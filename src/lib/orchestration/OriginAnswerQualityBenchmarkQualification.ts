import {
  aggregateOriginAnswerQualityBenchmark,
  compareOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkAggregate,
  type OriginAnswerQualityBenchmarkCategory,
  type OriginAnswerQualityBenchmarkDelta,
  type OriginAnswerQualityBenchmarkObservation,
} from "./OriginAnswerQualityBenchmark.js";
import {
  assertOriginBenchmarkManifestMatch,
  type OriginAnswerQualityBenchmarkManifest,
} from "./OriginAnswerQualityBenchmarkManifest.js";
import {
  assertOriginBenchmarkComparableRuns,
  type OriginAnswerQualityBenchmarkRunProvenance,
} from "./OriginAnswerQualityBenchmarkRunProvenance.js";

export const ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES = Object.freeze([
  "current-factual",
  "multi-source-comparison",
  "contradiction-detection",
  "user-document-reasoning",
  "professional-advice",
  "coding-generation",
  "coding-repair",
  "artifact-generation",
  "ambiguity-handling",
  "fail-closed",
] as const satisfies readonly OriginAnswerQualityBenchmarkCategory[]);

export interface OriginAnswerQualityBenchmarkQualificationInput {
  readonly baselineManifest: OriginAnswerQualityBenchmarkManifest;
  readonly candidateManifest: OriginAnswerQualityBenchmarkManifest;
  readonly baselineRun: OriginAnswerQualityBenchmarkRunProvenance;
  readonly candidateRun: OriginAnswerQualityBenchmarkRunProvenance;
  readonly baselineObservations: readonly OriginAnswerQualityBenchmarkObservation[];
  readonly candidateObservations: readonly OriginAnswerQualityBenchmarkObservation[];
}

export interface OriginAnswerQualityBenchmarkQualificationReport {
  readonly schemaVersion: "origin.aq-benchmark-qualification.v1";
  readonly baseline: OriginAnswerQualityBenchmarkAggregate;
  readonly candidate: OriginAnswerQualityBenchmarkAggregate;
  readonly delta: OriginAnswerQualityBenchmarkDelta;
  readonly caseCount: 40;
  readonly familyCount: 10;
  readonly hardGates: {
    readonly exactCorpusMatch: true;
    readonly sameProviderAndModel: true;
    readonly zeroCost: true;
    readonly unsupportedClaimsNotWorse: boolean;
    readonly verifierRejectionRateNotWorse: boolean;
  };
}

export type OriginAnswerQualityBenchmarkQualificationResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkQualificationReport }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_MANIFEST_MISMATCH"
        | "AQ_BENCHMARK_RUN_NOT_COMPARABLE"
        | "AQ_BENCHMARK_CORPUS_SHAPE_INVALID"
        | "AQ_BENCHMARK_OBSERVATION_SET_MISMATCH"
        | "AQ_BENCHMARK_AGGREGATION_FAILED";
    };

function validateFrozenCorpusShape(manifest: OriginAnswerQualityBenchmarkManifest): boolean {
  if (manifest.cases.length !== 40) return false;

  const allowed = new Set<string>(ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES);
  const counts = new Map<string, number>();
  for (const item of manifest.cases) {
    if (!allowed.has(item.category)) return false;
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }

  return ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES.every(
    (family) => counts.get(family) === 4,
  );
}

function observationSetMatchesManifest(
  observations: readonly OriginAnswerQualityBenchmarkObservation[],
  manifest: OriginAnswerQualityBenchmarkManifest,
): boolean {
  if (observations.length !== manifest.cases.length) return false;

  const expected = new Map(
    manifest.cases.map((item) => [item.caseId, item.category] as const),
  );
  const seen = new Set<string>();

  for (const item of observations) {
    if (seen.has(item.caseId)) return false;
    seen.add(item.caseId);
    if (expected.get(item.caseId) !== item.category) return false;
  }

  return seen.size === expected.size;
}

export function qualifyOriginAnswerQualityBenchmark(
  input: OriginAnswerQualityBenchmarkQualificationInput,
): OriginAnswerQualityBenchmarkQualificationResult {
  try {
    assertOriginBenchmarkManifestMatch(input.baselineManifest, input.candidateManifest);
  } catch {
    return { ok: false, code: "AQ_BENCHMARK_MANIFEST_MISMATCH" };
  }

  if (!validateFrozenCorpusShape(input.baselineManifest)) {
    return { ok: false, code: "AQ_BENCHMARK_CORPUS_SHAPE_INVALID" };
  }

  try {
    assertOriginBenchmarkComparableRuns(input.baselineRun, input.candidateRun);
  } catch {
    return { ok: false, code: "AQ_BENCHMARK_RUN_NOT_COMPARABLE" };
  }

  if (
    !observationSetMatchesManifest(input.baselineObservations, input.baselineManifest)
    || !observationSetMatchesManifest(input.candidateObservations, input.candidateManifest)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_OBSERVATION_SET_MISMATCH" };
  }

  const baseline = aggregateOriginAnswerQualityBenchmark(input.baselineObservations);
  const candidate = aggregateOriginAnswerQualityBenchmark(input.candidateObservations);
  if (!baseline.ok || !candidate.ok) {
    return { ok: false, code: "AQ_BENCHMARK_AGGREGATION_FAILED" };
  }

  const delta = compareOriginAnswerQualityBenchmark(baseline.value, candidate.value);

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-qualification.v1",
      baseline: baseline.value,
      candidate: candidate.value,
      delta,
      caseCount: 40,
      familyCount: 10,
      hardGates: Object.freeze({
        exactCorpusMatch: true,
        sameProviderAndModel: true,
        zeroCost: true,
        unsupportedClaimsNotWorse: delta.unsupportedMaterialClaimDelta <= 0,
        verifierRejectionRateNotWorse: delta.verifierRejectionRateDelta >= 0,
      }),
    }),
  };
}
