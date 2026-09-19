import { createHash } from "node:crypto";

import {
  aggregateOriginAnswerQualityBenchmark,
  compareOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkAggregate,
  type OriginAnswerQualityBenchmarkDelta,
} from "./OriginAnswerQualityBenchmark.js";
import type {
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import type {
  OriginAnswerQualityBenchmarkQuotaPlan,
} from "./OriginAnswerQualityBenchmarkQuotaPlan.js";
import {
  buildOriginAnswerQualityBenchmarkScorecard,
  compareOriginAnswerQualityBenchmarkScorecards,
  type OriginAnswerQualityBenchmarkMeasuredObservation,
  type OriginAnswerQualityBenchmarkMeasuredScorecard,
  type OriginAnswerQualityBenchmarkScorecardDelta,
} from "./OriginAnswerQualityBenchmarkScorecard.js";
import {
  digestOriginAnswerQualityOfficialShardComparison,
  type OriginAnswerQualityOfficialShardComparison,
} from "./OriginAnswerQualityOfficialShardComparison.js";
import type {
  OriginAnswerQualityOfficialBenchmarkScorerProvenance,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";

export interface OriginAnswerQualityOfficialShardedComparison {
  readonly schemaVersion: "origin.aq-official-sharded-comparison.v1";
  readonly benchmarkId: string;
  readonly benchmarkVersion: string;
  readonly fullManifestDigest: string;
  readonly baselineGitSha: string;
  readonly candidateGitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
  readonly scorerProvenanceDigest: string;
  readonly shardCount: number;
  readonly fullComparisonRequestsMax: number;
  readonly baselineRuntimeProviderRequests: number;
  readonly candidateRuntimeProviderRequests: number;
  readonly baseline: OriginAnswerQualityBenchmarkAggregate;
  readonly candidate: OriginAnswerQualityBenchmarkAggregate;
  readonly delta: OriginAnswerQualityBenchmarkDelta;
  readonly baselineScorecard: OriginAnswerQualityBenchmarkMeasuredScorecard;
  readonly candidateScorecard: OriginAnswerQualityBenchmarkMeasuredScorecard;
  readonly scorecardDelta: OriginAnswerQualityBenchmarkScorecardDelta;
  readonly hardGates: {
    readonly exactCorpusCoverage: true;
    readonly sameProviderAndModel: true;
    readonly sameScorer: true;
    readonly zeroCost: true;
    readonly unsupportedClaimsNotWorse: boolean;
    readonly verifierRejectionRateNotWorse: boolean;
    readonly verificationIntegrityNotWorse: boolean;
    readonly failClosedAccuracyNotWorse: boolean;
  };
  readonly shardDigests: readonly string[];
  readonly aggregateDigest: string;
}

export type OriginAnswerQualityOfficialShardedComparisonResult =
  | { ok: true; value: OriginAnswerQualityOfficialShardedComparison }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SHARDED_INPUT_INVALID"
        | "AQ_BENCHMARK_SHARDED_PLAN_MISMATCH"
        | "AQ_BENCHMARK_SHARDED_SHARD_DIGEST_MISMATCH"
        | "AQ_BENCHMARK_SHARDED_IDENTITY_MISMATCH"
        | "AQ_BENCHMARK_SHARDED_CASESET_MISMATCH"
        | "AQ_BENCHMARK_SHARDED_AGGREGATION_FAILED"
        | "AQ_BENCHMARK_SHARDED_SCORECARD_FAILED";
      detail?: string;
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stripDigest(
  shard: OriginAnswerQualityOfficialShardComparison,
): Omit<OriginAnswerQualityOfficialShardComparison, "shardDigest"> {
  const { shardDigest: _shardDigest, ...rest } = shard;
  return rest;
}

function sameScorer(
  a: OriginAnswerQualityOfficialShardComparison,
  b: OriginAnswerQualityOfficialShardComparison,
): boolean {
  return a.scorerProvenanceDigest === b.scorerProvenanceDigest
    && JSON.stringify(a.scorerProvenance) === JSON.stringify(b.scorerProvenance);
}

function sameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) =>
      value === [...right].sort()[index]
    );
}

export function aggregateOriginAnswerQualityOfficialShards(
  corpus: OriginAnswerQualityBenchmarkFrozenCorpus,
  plan: OriginAnswerQualityBenchmarkQuotaPlan,
  shards: readonly OriginAnswerQualityOfficialShardComparison[],
): OriginAnswerQualityOfficialShardedComparisonResult {
  if (
    corpus.cases.length !== 40
    || plan.benchmarkId !== corpus.benchmarkId
    || plan.benchmarkVersion !== corpus.benchmarkVersion
    || plan.shards.length === 0
    || shards.length !== plan.shards.length
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SHARDED_INPUT_INVALID" };
  }

  const shardByIndex = new Map<number, OriginAnswerQualityOfficialShardComparison>();
  for (const shard of shards) {
    if (shardByIndex.has(shard.shardIndex)) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SHARDED_PLAN_MISMATCH",
        detail: `duplicate:${shard.shardIndex}`,
      };
    }
    shardByIndex.set(shard.shardIndex, shard);
  }

  const ordered: OriginAnswerQualityOfficialShardComparison[] = [];
  for (const planned of plan.shards) {
    const shard = shardByIndex.get(planned.shardIndex);
    if (
      !shard
      || !sameIds(shard.caseIds, planned.caseIds)
      || shard.plannedPairedRequestsMax !== planned.pairedRequestsMax
      || shard.fullManifestDigest !== corpus.manifest.manifestDigest
      || shard.benchmarkId !== corpus.benchmarkId
      || shard.benchmarkVersion !== corpus.benchmarkVersion
    ) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SHARDED_PLAN_MISMATCH",
        detail: String(planned.shardIndex),
      };
    }

    if (
      digestOriginAnswerQualityOfficialShardComparison(stripDigest(shard))
      !== shard.shardDigest
    ) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SHARDED_SHARD_DIGEST_MISMATCH",
        detail: String(shard.shardIndex),
      };
    }
    ordered.push(shard);
  }

  const identity = ordered[0];
  if (!identity) {
    return { ok: false, code: "AQ_BENCHMARK_SHARDED_INPUT_INVALID" };
  }

  for (const shard of ordered) {
    if (
      shard.baselineGitSha !== identity.baselineGitSha
      || shard.candidateGitSha !== identity.candidateGitSha
      || shard.providerId !== identity.providerId
      || shard.modelId !== identity.modelId
      || !sameScorer(identity, shard)
    ) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SHARDED_IDENTITY_MISMATCH",
        detail: String(shard.shardIndex),
      };
    }
  }

  const baselineObservations = ordered.flatMap(
    (shard) => shard.baselineObservations,
  );
  const candidateObservations = ordered.flatMap(
    (shard) => shard.candidateObservations,
  );

  const expected = new Map(
    corpus.cases.map((item) => [item.caseId, item.category] as const),
  );
  const validate = (
    observations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[],
  ): boolean => {
    if (observations.length !== corpus.cases.length) return false;
    const seen = new Set<string>();
    for (const item of observations) {
      if (
        seen.has(item.caseId)
        || expected.get(item.caseId) !== item.category
        || item.costUsd !== 0
      ) return false;
      seen.add(item.caseId);
    }
    return seen.size === expected.size;
  };

  if (!validate(baselineObservations) || !validate(candidateObservations)) {
    return { ok: false, code: "AQ_BENCHMARK_SHARDED_CASESET_MISMATCH" };
  }

  const baseline = aggregateOriginAnswerQualityBenchmark(baselineObservations);
  const candidate = aggregateOriginAnswerQualityBenchmark(candidateObservations);
  if (baseline.ok === false || candidate.ok === false) {
    return { ok: false, code: "AQ_BENCHMARK_SHARDED_AGGREGATION_FAILED" };
  }
  const delta = compareOriginAnswerQualityBenchmark(
    baseline.value,
    candidate.value,
  );

  const baselineScorecard = buildOriginAnswerQualityBenchmarkScorecard(
    corpus.manifest,
    baselineObservations,
  );
  const candidateScorecard = buildOriginAnswerQualityBenchmarkScorecard(
    corpus.manifest,
    candidateObservations,
  );
  if (baselineScorecard.ok === false || candidateScorecard.ok === false) {
    return { ok: false, code: "AQ_BENCHMARK_SHARDED_SCORECARD_FAILED" };
  }
  const scorecardDelta = compareOriginAnswerQualityBenchmarkScorecards(
    baselineScorecard.value,
    candidateScorecard.value,
  );

  const failClosedAccuracyNotWorse =
    scorecardDelta.failClosedAccuracyDelta === null
      ? baselineScorecard.value.failClosedAccuracy
        === candidateScorecard.value.failClosedAccuracy
      : scorecardDelta.failClosedAccuracyDelta >= 0;

  const shardDigests = Object.freeze(ordered.map((shard) => shard.shardDigest));
  const canonical = [
    "origin.aq-official-sharded-comparison.v1",
    corpus.benchmarkId,
    corpus.benchmarkVersion,
    corpus.manifest.manifestDigest,
    identity.baselineGitSha,
    identity.candidateGitSha,
    identity.providerId,
    identity.modelId,
    identity.scorerProvenanceDigest,
    plan.fullComparisonRequestsMax,
    ...shardDigests,
  ].join("\n");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-official-sharded-comparison.v1",
      benchmarkId: corpus.benchmarkId,
      benchmarkVersion: corpus.benchmarkVersion,
      fullManifestDigest: corpus.manifest.manifestDigest,
      baselineGitSha: identity.baselineGitSha,
      candidateGitSha: identity.candidateGitSha,
      providerId: identity.providerId,
      modelId: identity.modelId,
      scorerProvenance: Object.freeze({ ...identity.scorerProvenance }),
      scorerProvenanceDigest: identity.scorerProvenanceDigest,
      shardCount: ordered.length,
      fullComparisonRequestsMax: plan.fullComparisonRequestsMax,
      baselineRuntimeProviderRequests: baselineObservations.reduce(
        (sum, item) => sum + item.providerRequests,
        0,
      ),
      candidateRuntimeProviderRequests: candidateObservations.reduce(
        (sum, item) => sum + item.providerRequests,
        0,
      ),
      baseline: baseline.value,
      candidate: candidate.value,
      delta,
      baselineScorecard: baselineScorecard.value,
      candidateScorecard: candidateScorecard.value,
      scorecardDelta,
      hardGates: Object.freeze({
        exactCorpusCoverage: true as const,
        sameProviderAndModel: true as const,
        sameScorer: true as const,
        zeroCost: true as const,
        unsupportedClaimsNotWorse: delta.unsupportedMaterialClaimDelta <= 0,
        verifierRejectionRateNotWorse: delta.verifierRejectionRateDelta >= 0,
        verificationIntegrityNotWorse:
          scorecardDelta.verificationIntegrityRateDelta >= 0,
        failClosedAccuracyNotWorse,
      }),
      shardDigests,
      aggregateDigest: sha256(canonical),
    }),
  };
}
