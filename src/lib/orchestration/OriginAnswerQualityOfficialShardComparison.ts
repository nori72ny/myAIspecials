import { createHash } from "node:crypto";

import {
  probeOriginAnswerQualityBenchmarkEnvironmentForLanes,
} from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  createOriginAnswerQualityBenchmarkCodingCheckoutAdapter,
} from "./OriginAnswerQualityBenchmarkCodingCheckoutAdapter.js";
import {
  createOriginAnswerQualityBenchmarkShardCorpus,
} from "./OriginAnswerQualityBenchmarkShardCorpus.js";
import type {
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import type {
  OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard.js";
import {
  resolveOriginAnswerQualityBenchmarkRequiredLanes,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  getOriginAnswerQualityBenchmarkQuotaCaseBudget,
  type OriginAnswerQualityBenchmarkQuotaShard,
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
  readonly baselineEvaluatorRequests: number;
  readonly candidateEvaluatorRequests: number;
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
      plannedPairedRequestsMax?: number;
      baselineEvaluatorRequests?: number;
      candidateEvaluatorRequests?: number;
      evaluatorRequestsTotal?: number;
    };

export interface OriginAnswerQualityOfficialShardComparisonDependencies {
  readonly probeEnvironment?: typeof probeOriginAnswerQualityBenchmarkEnvironmentForLanes;
  readonly probeCodingCheckout?: (
    target: OriginAnswerQualityOfficialShardTarget,
    env?: NodeJS.ProcessEnv,
    nowMs?: () => number,
  ) => Promise<boolean>;
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

async function probeCodingCheckout(
  target: OriginAnswerQualityOfficialShardTarget,
  env?: NodeJS.ProcessEnv,
  nowMs?: () => number,
): Promise<boolean> {
  try {
    await createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: target.sourceRoot,
      expectedGitSha: target.gitSha,
      env,
      nowMs,
    });
    return true;
  } catch {
    return false;
  }
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
    value.baselineEvaluatorRequests,
    value.candidateEvaluatorRequests,
    value.scorerProvenanceDigest,
    baseline,
    candidate,
  ].join("\n"));
}


const SHARD_KEYS = new Set([
  "schemaVersion",
  "benchmarkId",
  "benchmarkVersion",
  "fullManifestDigest",
  "shardIndex",
  "caseIds",
  "shardManifestDigest",
  "plannedPairedRequestsMax",
  "providerId",
  "modelId",
  "baselineGitSha",
  "candidateGitSha",
  "baselineRunId",
  "candidateRunId",
  "baselineMeasuredDigest",
  "candidateMeasuredDigest",
  "baselineRuntimeProviderRequests",
  "candidateRuntimeProviderRequests",
  "baselineEvaluatorRequests",
  "candidateEvaluatorRequests",
  "scorerProvenance",
  "scorerProvenanceDigest",
  "baselineObservations",
  "candidateObservations",
  "shardDigest",
]);
const SCORER_KEYS = new Set([
  "schemaVersion",
  "scorerId",
  "scorerRevision",
  "corpusId",
  "corpusVersion",
]);
const OBSERVATION_REQUIRED_KEYS = new Set([
  "caseId",
  "category",
  "factualSupportScore",
  "citationPrecisionScore",
  "taskCompletionScore",
  "contradictionDetectionScore",
  "verifierRejectedUnsupportedClaim",
  "providerRequests",
  "latencyMs",
  "costUsd",
  "unsupportedMaterialClaimCount",
  "verificationIntegrityAccurate",
  "userActionabilityScore",
]);
const OBSERVATION_ALLOWED_KEYS = new Set([
  ...OBSERVATION_REQUIRED_KEYS,
  "repairSucceeded",
  "failClosedCorrect",
]);
const CATEGORIES = new Set([
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
  "citation-precision",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: Set<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= 0 && value <= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseObservation(
  value: unknown,
): OriginAnswerQualityBenchmarkMeasuredObservation | null {
  const item = record(value);
  if (!item) return null;
  const observationKeys = Object.keys(item);
  if (
    observationKeys.some((key) => !OBSERVATION_ALLOWED_KEYS.has(key))
    || [...OBSERVATION_REQUIRED_KEYS].some((key) => !(key in item))
  ) return null;
  if (
    typeof item.caseId !== "string"
    || !SAFE_ID.test(item.caseId)
    || typeof item.category !== "string"
    || !CATEGORIES.has(item.category)
    || !score(item.factualSupportScore)
    || !score(item.citationPrecisionScore)
    || !score(item.taskCompletionScore)
    || !score(item.contradictionDetectionScore)
    || typeof item.verifierRejectedUnsupportedClaim !== "boolean"
    || !(
      item.repairSucceeded === undefined
      || typeof item.repairSucceeded === "boolean"
    )
    || !nonNegativeInteger(item.providerRequests)
    || typeof item.latencyMs !== "number"
    || !Number.isFinite(item.latencyMs)
    || item.latencyMs < 0
    || item.costUsd !== 0
    || !nonNegativeInteger(item.unsupportedMaterialClaimCount)
    || typeof item.verificationIntegrityAccurate !== "boolean"
    || !(
      item.failClosedCorrect === undefined
      || typeof item.failClosedCorrect === "boolean"
    )
    || !nonNegativeInteger(item.userActionabilityScore)
    || item.userActionabilityScore > 3
  ) return null;

  return Object.freeze({
    caseId: item.caseId,
    category: item.category as OriginAnswerQualityBenchmarkMeasuredObservation["category"],
    factualSupportScore: item.factualSupportScore,
    citationPrecisionScore: item.citationPrecisionScore,
    taskCompletionScore: item.taskCompletionScore,
    contradictionDetectionScore: item.contradictionDetectionScore,
    verifierRejectedUnsupportedClaim: item.verifierRejectedUnsupportedClaim,
    repairSucceeded: item.repairSucceeded as boolean | undefined,
    providerRequests: item.providerRequests,
    latencyMs: item.latencyMs,
    costUsd: 0,
    unsupportedMaterialClaimCount: item.unsupportedMaterialClaimCount,
    verificationIntegrityAccurate: item.verificationIntegrityAccurate,
    failClosedCorrect: item.failClosedCorrect as boolean | undefined,
    userActionabilityScore: item.userActionabilityScore as 0 | 1 | 2 | 3,
  });
}

export type OriginAnswerQualityOfficialShardParseResult =
  | { ok: true; value: OriginAnswerQualityOfficialShardComparison }
  | { ok: false; code: "AQ_BENCHMARK_SHARD_JSON_INVALID" | "AQ_BENCHMARK_SHARD_JSON_DIGEST_MISMATCH" };

export function parseOriginAnswerQualityOfficialShardComparison(
  input: unknown,
): OriginAnswerQualityOfficialShardParseResult {
  const value = record(input);
  if (!value || !exactKeys(value, SHARD_KEYS)) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_JSON_INVALID" };
  }

  const scorer = record(value.scorerProvenance);
  if (!scorer || !exactKeys(scorer, SCORER_KEYS)) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_JSON_INVALID" };
  }

  const caseIds = Array.isArray(value.caseIds)
    ? value.caseIds.filter((item): item is string =>
        typeof item === "string" && SAFE_ID.test(item)
      )
    : [];
  const baseline = Array.isArray(value.baselineObservations)
    ? value.baselineObservations.map(parseObservation)
    : [];
  const candidate = Array.isArray(value.candidateObservations)
    ? value.candidateObservations.map(parseObservation)
    : [];

  if (
    value.schemaVersion !== "origin.aq-official-shard-comparison.v1"
    || value.benchmarkId !== "aq-post-heldout-public"
    || value.benchmarkVersion !== "v1"
    || typeof value.fullManifestDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.fullManifestDigest)
    || !nonNegativeInteger(value.shardIndex)
    || caseIds.length === 0
    || caseIds.length !== (value.caseIds as unknown[]).length
    || new Set(caseIds).size !== caseIds.length
    || typeof value.shardManifestDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.shardManifestDigest)
    || !nonNegativeInteger(value.plannedPairedRequestsMax)
    || value.plannedPairedRequestsMax < 1
    || value.plannedPairedRequestsMax > 50
    || typeof value.providerId !== "string"
    || !SAFE_ID.test(value.providerId)
    || typeof value.modelId !== "string"
    || !SAFE_ID.test(value.modelId)
    || typeof value.baselineGitSha !== "string"
    || !SHA40.test(value.baselineGitSha)
    || typeof value.candidateGitSha !== "string"
    || !SHA40.test(value.candidateGitSha)
    || typeof value.baselineRunId !== "string"
    || !SAFE_ID.test(value.baselineRunId)
    || typeof value.candidateRunId !== "string"
    || !SAFE_ID.test(value.candidateRunId)
    || typeof value.baselineMeasuredDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.baselineMeasuredDigest)
    || typeof value.candidateMeasuredDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.candidateMeasuredDigest)
    || !nonNegativeInteger(value.baselineRuntimeProviderRequests)
    || !nonNegativeInteger(value.candidateRuntimeProviderRequests)
    || !nonNegativeInteger(value.baselineEvaluatorRequests)
    || !nonNegativeInteger(value.candidateEvaluatorRequests)
    || scorer.schemaVersion !== "origin.aq-benchmark-scorer.v1"
    || scorer.scorerId !== "origin-aq-public-deterministic-v1"
    || typeof scorer.scorerRevision !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(scorer.scorerRevision)
    || scorer.corpusId !== "aq-post-heldout-public"
    || scorer.corpusVersion !== "v1"
    || typeof value.scorerProvenanceDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.scorerProvenanceDigest)
    || baseline.length !== caseIds.length
    || candidate.length !== caseIds.length
    || baseline.some((item) => item === null)
    || candidate.some((item) => item === null)
    || typeof value.shardDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.shardDigest)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_JSON_INVALID" };
  }

  const parsed: OriginAnswerQualityOfficialShardComparison = Object.freeze({
    schemaVersion: "origin.aq-official-shard-comparison.v1",
    benchmarkId: "aq-post-heldout-public",
    benchmarkVersion: "v1",
    fullManifestDigest: value.fullManifestDigest,
    shardIndex: value.shardIndex,
    caseIds: Object.freeze(caseIds),
    shardManifestDigest: value.shardManifestDigest,
    plannedPairedRequestsMax: value.plannedPairedRequestsMax,
    providerId: value.providerId,
    modelId: value.modelId,
    baselineGitSha: value.baselineGitSha,
    candidateGitSha: value.candidateGitSha,
    baselineRunId: value.baselineRunId,
    candidateRunId: value.candidateRunId,
    baselineMeasuredDigest: value.baselineMeasuredDigest,
    candidateMeasuredDigest: value.candidateMeasuredDigest,
    baselineRuntimeProviderRequests: value.baselineRuntimeProviderRequests,
    candidateRuntimeProviderRequests: value.candidateRuntimeProviderRequests,
    baselineEvaluatorRequests: value.baselineEvaluatorRequests,
    candidateEvaluatorRequests: value.candidateEvaluatorRequests,
    scorerProvenance: Object.freeze({
      schemaVersion: "origin.aq-benchmark-scorer.v1",
      scorerId: "origin-aq-public-deterministic-v1",
      scorerRevision: scorer.scorerRevision,
      corpusId: "aq-post-heldout-public",
      corpusVersion: "v1",
    }),
    scorerProvenanceDigest: value.scorerProvenanceDigest,
    baselineObservations: Object.freeze(
      baseline as OriginAnswerQualityBenchmarkMeasuredObservation[],
    ),
    candidateObservations: Object.freeze(
      candidate as OriginAnswerQualityBenchmarkMeasuredObservation[],
    ),
    shardDigest: value.shardDigest,
  });

  if (
    digestOriginAnswerQualityOfficialShardComparison(stripShardDigest(parsed))
    !== parsed.shardDigest
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_JSON_DIGEST_MISMATCH" };
  }

  return { ok: true, value: parsed };
}

function stripShardDigest(
  shard: OriginAnswerQualityOfficialShardComparison,
): Omit<OriginAnswerQualityOfficialShardComparison, "shardDigest"> {
  const { shardDigest: _shardDigest, ...rest } = shard;
  return rest;
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
    ?? probeOriginAnswerQualityBenchmarkEnvironmentForLanes;
  const runSession = dependencies.runSession
    ?? runOriginAnswerQualityOfficialProviderScoredSession;

  const requiredLanes = resolveOriginAnswerQualityBenchmarkRequiredLanes(
    shardCorpus.value.cases,
  );

  const requiresCoding = requiredLanes.includes("coding");
  const checkCodingCheckout = dependencies.probeCodingCheckout ?? probeCodingCheckout;
  let baselineCodingCheckoutReady: boolean | undefined;
  let candidateCodingCheckoutReady: boolean | undefined;
  if (requiresCoding) {
    baselineCodingCheckoutReady = await checkCodingCheckout(
      input.baseline,
      input.env,
      input.nowMs,
    );
    if (!baselineCodingCheckoutReady) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SHARD_BASELINE_ENVIRONMENT_INVALID",
        detail: "AQ_BENCHMARK_ENV_CODING_NOT_READY",
      };
    }
    candidateCodingCheckoutReady = await checkCodingCheckout(
      input.candidate,
      input.env,
      input.nowMs,
    );
    if (!candidateCodingCheckoutReady) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SHARD_CANDIDATE_ENVIRONMENT_INVALID",
        detail: "AQ_BENCHMARK_ENV_CODING_NOT_READY",
      };
    }
  }

  const baselineEnvironment = await probe(
    input.baseline.baseUrl,
    input.baseline.gitSha,
    requiredLanes,
    input.fetchImpl,
    requiresCoding
      ? { codingReadiness: "checkout", codingCheckoutReady: baselineCodingCheckoutReady }
      : undefined,
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
    requiredLanes,
    input.fetchImpl,
    requiresCoding
      ? { codingReadiness: "checkout", codingCheckoutReady: candidateCodingCheckoutReady }
      : undefined,
  );
  if (candidateEnvironment.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_CANDIDATE_ENVIRONMENT_INVALID",
      detail: candidateEnvironment.code,
    };
  }

  const executionRequestsPairedMax = shardCorpus.value.cases.reduce(
    (sum, item) => sum
      + 2 * getOriginAnswerQualityBenchmarkQuotaCaseBudget(item)
        .executionRequestsPerRuntimeMax,
    0,
  );
  const evaluatorRequestsPairedMax =
    input.shard.pairedRequestsMax - executionRequestsPairedMax;
  if (evaluatorRequestsPairedMax < 0) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_COMPARISON_INVALID_INPUT" };
  }

  let evaluatorRequests = 0;
  const beforeEvaluatorRequest = () => {
    if (evaluatorRequests >= evaluatorRequestsPairedMax) {
      throw new Error("AQ_BENCHMARK_SHARD_EVALUATOR_REQUEST_BUDGET_EXCEEDED");
    }
    evaluatorRequests += 1;
  };

  const budgetByCaseId = new Map(
    input.fullCorpus.cases.map((item) => [
      item.caseId,
      getOriginAnswerQualityBenchmarkQuotaCaseBudget(item),
    ] as const),
  );
  const shardBudgets = input.shard.caseIds.map((caseId) => budgetByCaseId.get(caseId));
  if (shardBudgets.some((item) => item === undefined)) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_COMPARISON_INVALID_INPUT",
      detail: "AQ_BENCHMARK_SHARD_CASE_BUDGET_MISSING",
    };
  }
  const evaluatorRequestsPerSideMax = shardBudgets.reduce(
    (sum, item) => sum + item!.scorerRequestsPerRuntimeMax,
    0,
  );
  let baselineEvaluatorRequests = 0;
  let candidateEvaluatorRequests = 0;

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
    ...shared,
    runId: input.baseline.runId,
    gitSha: input.baseline.gitSha,
    environmentProof: baselineEnvironment.value,
    sourceRoot: input.baseline.sourceRoot,
    beforeEvaluatorRequest: () => {
      if (baselineEvaluatorRequests >= evaluatorRequestsPerSideMax) {
        throw new Error("AQ_BENCHMARK_SHARD_EVALUATOR_BUDGET_EXCEEDED");
      }
      beforeEvaluatorRequest();
      baselineEvaluatorRequests += 1;
    },
  });
  if (baseline.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_BASELINE_SESSION_FAILED",
      detail: sessionDetail(baseline),
      plannedPairedRequestsMax: input.shard.pairedRequestsMax,
      baselineEvaluatorRequests,
      candidateEvaluatorRequests,
      evaluatorRequestsTotal: evaluatorRequests,
    };
  }

  const candidate = await runSession({
    ...shared,
    runId: input.candidate.runId,
    gitSha: input.candidate.gitSha,
    environmentProof: candidateEnvironment.value,
    sourceRoot: input.candidate.sourceRoot,
    beforeEvaluatorRequest: () => {
      if (candidateEvaluatorRequests >= evaluatorRequestsPerSideMax) {
        throw new Error("AQ_BENCHMARK_SHARD_EVALUATOR_BUDGET_EXCEEDED");
      }
      beforeEvaluatorRequest();
      candidateEvaluatorRequests += 1;
    },
  });
  if (candidate.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_CANDIDATE_SESSION_FAILED",
      detail: sessionDetail(candidate),
      plannedPairedRequestsMax: input.shard.pairedRequestsMax,
      baselineEvaluatorRequests,
      candidateEvaluatorRequests,
      evaluatorRequestsTotal: evaluatorRequests,
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
  const baselineRuntimeProviderRequests = baselineObservations.reduce(
    (sum, item) => sum + item.providerRequests,
    0,
  );
  const candidateRuntimeProviderRequests = candidateObservations.reduce(
    (sum, item) => sum + item.providerRequests,
    0,
  );
  const measuredPairedRequests =
    baselineRuntimeProviderRequests
    + candidateRuntimeProviderRequests
    + baselineEvaluatorRequests
    + candidateEvaluatorRequests;
  if (measuredPairedRequests > input.shard.pairedRequestsMax) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SHARD_SESSION_IDENTITY_MISMATCH",
      detail: "AQ_BENCHMARK_SHARD_REQUEST_BUDGET_EXCEEDED",
    };
  }

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
    baselineRuntimeProviderRequests,
    candidateRuntimeProviderRequests,
    baselineEvaluatorRequests,
    candidateEvaluatorRequests,
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
