import { createHash } from "node:crypto";

import {
  probeOriginAnswerQualityBenchmarkEnvironment,
  type OriginAnswerQualityBenchmarkEnvironmentProof,
} from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  createOriginAnswerQualityBenchmarkShardCorpus,
} from "./OriginAnswerQualityBenchmarkShardCorpus.js";
import type {
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import type {
  OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard.js";
import type {
  OriginAnswerQualityBenchmarkQuotaShard,
} from "./OriginAnswerQualityBenchmarkQuotaPlan.js";
import {
  runOriginAnswerQualityOfficialProviderScoredSession,
  type OriginAnswerQualityOfficialBenchmarkSessionResult,
  type OriginAnswerQualityOfficialProviderScoredSessionInput,
  type OriginAnswerQualityOfficialBenchmarkScorerProvenance,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";

export interface OriginAnswerQualityOfficialShardTarget {
  readonly runId: string;
  readonly gitSha: string;
  readonly baseUrl: string;
  readonly sourceRoot: string;
}

export interface OriginAnswerQualityOfficialShardComparisonInput {
  readonly fullCorpus: OriginAnswerQualityBenchmarkFrozenCorpus;
  readonly shard: OriginAnswerQualityBenchmarkQuotaShard;
  readonly providerId: string;
  readonly modelId: string;
  readonly baseline: OriginAnswerQualityOfficialShardTarget;
  readonly candidate: OriginAnswerQualityOfficialShardTarget;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
  readonly evaluatorPlanningOptions?:
    OriginAnswerQualityOfficialProviderScoredSessionInput["evaluatorPlanningOptions"];
}

export interface OriginAnswerQualityOfficialShardComparison {
  readonly schemaVersion: "origin.aq-official-shard-comparison.v1";
  readonly benchmarkId: string;
  readonly benchmarkVersion: string;
  readonly fullManifestDigest: string;
  readonly shardIndex: number;
  readonly caseIds: readonly string[];
  readonly shardManifestDigest: string;
  readonly plannedPairedRequestsMax: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly baselineGitSha: string;
  readonly candidateGitSha: string;
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly baselineMeasuredDigest: string;
  readonly candidateMeasuredDigest: string;
  readonly baselineRuntimeProviderRequests: number;
  readonly candidateRuntimeProviderRequests: number;
  readonly scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
  readonly scorerProvenanceDigest: string;
  readonly baselineObservations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[];
  readonly candidateObservations: readonly OriginAnswerQualityBenchmarkMeasuredObservation[];
  readonly shardDigest: string;
}

export type OriginAnswerQualityOfficialShardComparisonResult =
  | { ok: true; value: OriginAnswerQualityOfficialShardComparison }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SHARD_COMPARISON_INVALID_INPUT"
        | "AQ_BENCHMARK_SHARD_BASELINE_ENVIRONMENT_INVALID"
        | "AQ_BENCHMARK_SHARD_CANDIDATE_ENVIRONMENT_INVALID"
        | "AQ_BENCHMARK_SHARD_BASELINE_SESSION_FAILED"
        | "AQ_BENCHMARK_SHARD_CANDIDATE_SESSION_FAILED"
        | "AQ_BENCHMARK_SHARD_SCORER_MISMATCH"
        | "AQ_BENCHMARK_SHARD_SESSION_IDENTITY_MISMATCH";
      detail?: string;
    };

export interface OriginAnswerQualityOfficialShardComparisonDependencies {
  readonly probeEnvironment?: typeof probeOriginAnswerQualityBenchmarkEnvironment;
  readonly runSession?: (
    input: OriginAnswerQualityOfficialProviderScoredSessionInput,
  ) => Promise<OriginAnswerQualityOfficialBenchmarkSessionResult>;
}

const SHA40 = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function validTarget(target: OriginAnswerQualityOfficialShardTarget): boolean {
  return SHA40.test(target.gitSha)
    && SAFE_ID.test(target.runId)
    && target.baseUrl.trim().length > 0
    && target.sourceRoot.trim().length > 0;
}

function sessionDetail(
  result: Exclude<OriginAnswerQualityOfficialBenchmarkSessionResult, { ok: true }>,
): string {
  const detail = "detail" in result && typeof result.detail === "string"
    ? result.detail
    : undefined;
  return detail ? `${result.code}:${detail}` : result.code;
}

function sameScorer(
  baseline: {
    scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
    scorerProvenanceDigest: string;
  },
  candidate: {
    scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
    scorerProvenanceDigest: string;
  },
): boolean {
  return baseline.scorerProvenanceDigest === candidate.scorerProvenanceDigest
    && JSON.stringify(baseline.scorerProvenance)
      === JSON.stringify(candidate.scorerProvenance);
}

function canonicalObservation(item: OriginAnswerQualityBenchmarkMeasuredObservation): string {
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

export function digestOriginAnswerQualityOfficialShardComparison(
  value: Omit<OriginAnswerQualityOfficialShardComparison, "shardDigest">,
): string {
  const baseline = [...value.baselineObservations]
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
    .map(canonicalObservation)
    .join("\n");
  const candidate = [...value.candidateObservations]
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
    .map(canonicalObservation)
    .join("\n");

  return sha256([
    value.schemaVersion,
    value.benchmarkId,
    value.benchmarkVersion,
    value.fullManifestDigest,
    value.shardIndex,
    value.caseIds.join(","),
    value.shardManifestDigest,
    value.plannedPairedRequestsMax,
    value.providerId,
    value.modelId,
    value.baselineGitSha,
    value.candidateGitSha,
    value.baselineRunId,
    value.candidateRunId,
    value.baselineMeasuredDigest,
    value.candidateMeasuredDigest,
    value.baselineRuntimeProviderRequests,
    value.candidateRuntimeProviderRequests,
    value.scorerProvenanceDigest,
    baseline,
    candidate,
  ].join("\n"));
}

export async function runOriginAnswerQualityOfficialShardComparison(
  input: OriginAnswerQualityOfficialShardComparisonInput,
  dependencies: OriginAnswerQualityOfficialShardComparisonDependencies = {},
): Promise<OriginAnswerQualityOfficialShardComparisonResult> {
  if (
    !SAFE_ID.test(input.providerId)
    || !SAFE_ID.test(input.modelId)
    || !validTarget(input.baseline)
    || !validTarget(input.candidate)
    || input.baseline.gitSha === input.candidate.gitSha
    || input.baseline.runId === input.candidate.runId
    || !Number.isInteger(input.shard.shardIndex)
    || input.shard.shardIndex < 0
    || !Number.isInteger(input.shard.pairedRequestsMax)
    || input.shard.pairedRequestsMax < 1
    || input.shard.pairedRequestsMax > 50
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_COMPARISON_INVALID_INPUT" };
  }

  const shardCorpus = createOriginAnswerQualityBenchmarkShardCorpus(
    input.fullCorpus,
    input.shard.caseIds,
  );
  if (shardCorpus.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_COMPARISON_INVALID_INPUT",
      detail: shardCorpus.code,
    };
  }

  const probe = dependencies.probeEnvironment
    ?? probeOriginAnswerQualityBenchmarkEnvironment;
  const runSession = dependencies.runSession
    ?? runOriginAnswerQualityOfficialProviderScoredSession;

  const baselineEnvironment = await probe(
    input.baseline.baseUrl,
    input.baseline.gitSha,
    input.fetchImpl,
  );
  if (baselineEnvironment.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_BASELINE_ENVIRONMENT_INVALID",
      detail: baselineEnvironment.code,
    };
  }

  const candidateEnvironment = await probe(
    input.candidate.baseUrl,
    input.candidate.gitSha,
    input.fetchImpl,
  );
  if (candidateEnvironment.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_CANDIDATE_ENVIRONMENT_INVALID",
      detail: candidateEnvironment.code,
    };
  }

  const shared = {
    providerId: input.providerId,
    modelId: input.modelId,
    corpus: shardCorpus.value,
    fetchImpl: input.fetchImpl,
    env: input.env,
    nowMs: input.nowMs,
    evaluatorPlanningOptions: input.evaluatorPlanningOptions,
  };

  const baseline = await runSession({
    runId: input.baseline.runId,
    gitSha: input.baseline.gitSha,
    environmentProof: baselineEnvironment.value,
    sourceRoot: input.baseline.sourceRoot,
    ...shared,
  });
  if (baseline.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_BASELINE_SESSION_FAILED",
      detail: sessionDetail(baseline),
    };
  }

  const candidate = await runSession({
    runId: input.candidate.runId,
    gitSha: input.candidate.gitSha,
    environmentProof: candidateEnvironment.value,
    sourceRoot: input.candidate.sourceRoot,
    ...shared,
  });
  if (candidate.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_CANDIDATE_SESSION_FAILED",
      detail: sessionDetail(candidate),
    };
  }

  if (!sameScorer(baseline.value, candidate.value)) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_SCORER_MISMATCH" };
  }

  const baselineRun = baseline.value.measuredRun.boundRun;
  const candidateRun = candidate.value.measuredRun.boundRun;
  if (
    baselineRun.gitSha !== input.baseline.gitSha
    || candidateRun.gitSha !== input.candidate.gitSha
    || baselineRun.providerId !== input.providerId
    || candidateRun.providerId !== input.providerId
    || baselineRun.modelId !== input.modelId
    || candidateRun.modelId !== input.modelId
    || baselineRun.manifestDigest !== shardCorpus.value.manifest.manifestDigest
    || candidateRun.manifestDigest !== shardCorpus.value.manifest.manifestDigest
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_SESSION_IDENTITY_MISMATCH" };
  }

  const baselineObservations = Object.freeze(
    baseline.value.measuredRun.measuredObservations.map(
      (item) => Object.freeze({ ...item }),
    ),
  );
  const candidateObservations = Object.freeze(
    candidate.value.measuredRun.measuredObservations.map(
      (item) => Object.freeze({ ...item }),
    ),
  );

  const base = {
    schemaVersion: "origin.aq-official-shard-comparison.v1" as const,
    benchmarkId: input.fullCorpus.benchmarkId,
    benchmarkVersion: input.fullCorpus.benchmarkVersion,
    fullManifestDigest: input.fullCorpus.manifest.manifestDigest,
    shardIndex: input.shard.shardIndex,
    caseIds: Object.freeze([...input.shard.caseIds]),
    shardManifestDigest: shardCorpus.value.manifest.manifestDigest,
    plannedPairedRequestsMax: input.shard.pairedRequestsMax,
    providerId: input.providerId,
    modelId: input.modelId,
    baselineGitSha: input.baseline.gitSha,
    candidateGitSha: input.candidate.gitSha,
    baselineRunId: input.baseline.runId,
    candidateRunId: input.candidate.runId,
    baselineMeasuredDigest: baseline.value.measuredRun.measuredDigest,
    candidateMeasuredDigest: candidate.value.measuredRun.measuredDigest,
    baselineRuntimeProviderRequests: baselineObservations.reduce(
      (sum, item) => sum + item.providerRequests,
      0,
    ),
    candidateRuntimeProviderRequests: candidateObservations.reduce(
      (sum, item) => sum + item.providerRequests,
      0,
    ),
    scorerProvenance: Object.freeze({ ...baseline.value.scorerProvenance }),
    scorerProvenanceDigest: baseline.value.scorerProvenanceDigest,
    baselineObservations,
    candidateObservations,
  };

  return {
    ok: true,
    value: Object.freeze({
      ...base,
      shardDigest: digestOriginAnswerQualityOfficialShardComparison(base),
    }),
  };
}
