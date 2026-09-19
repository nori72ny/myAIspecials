import { createHash } from "node:crypto";

import type {
  OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard.js";
import type {
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import {
  assertOriginAnswerQualityBenchmarkQuotaChunkUsage,
  type OriginAnswerQualityBenchmarkQuotaChunkPlan,
} from "./OriginAnswerQualityBenchmarkQuotaChunk.js";

export interface OriginAnswerQualityBenchmarkQuotaChunkCaseResult {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkMeasuredObservation["category"];
  readonly caseDigest: string;
  readonly execution: OriginAnswerQualityBenchmarkExecutionEvidence;
  readonly observation: OriginAnswerQualityBenchmarkMeasuredObservation;
}

export interface OriginAnswerQualityBenchmarkQuotaChunkArtifact {
  readonly schemaVersion: "origin.aq-benchmark-quota-chunk-artifact.v1";
  readonly planDigest: string;
  readonly parentManifestDigest: string;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly gitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly scorerProvenanceDigest: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly runtimeProviderRequests: number;
  readonly evaluatorRequests: number;
  readonly totalRequests: number;
  readonly totalCostUsd: 0;
  readonly cases: readonly OriginAnswerQualityBenchmarkQuotaChunkCaseResult[];
  readonly artifactDigest: string;
}

export type OriginAnswerQualityBenchmarkQuotaChunkArtifactResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkQuotaChunkArtifact }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_CHUNK_ARTIFACT_INVALID"
        | "AQ_BENCHMARK_CHUNK_ARTIFACT_CASESET_MISMATCH"
        | "AQ_BENCHMARK_CHUNK_ARTIFACT_EXECUTION_MISMATCH"
        | "AQ_BENCHMARK_CHUNK_ARTIFACT_OBSERVATION_MISMATCH"
        | "AQ_BENCHMARK_CHUNK_ARTIFACT_REQUEST_BUDGET_EXCEEDED";
    };

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validExecution(
  item: OriginAnswerQualityBenchmarkQuotaChunkCaseResult,
): boolean {
  const execution = item.execution;
  return execution.caseId === item.caseId
    && execution.costUsd === 0
    && Number.isInteger(execution.providerRequests)
    && execution.providerRequests >= 0
    && Number.isInteger(execution.toolCalls)
    && execution.toolCalls >= 0
    && Number.isFinite(execution.latencyMs)
    && execution.latencyMs >= 0
    && (
      execution.finalAnswerRef === null
      || SHA256.test(execution.finalAnswerRef)
    )
    && (
      execution.evidenceLedgerRef === null
      || SHA256.test(execution.evidenceLedgerRef)
    );
}

function validObservation(
  item: OriginAnswerQualityBenchmarkQuotaChunkCaseResult,
): boolean {
  const observation = item.observation;
  return observation.caseId === item.caseId
    && observation.category === item.category
    && observation.providerRequests === item.execution.providerRequests
    && observation.latencyMs === item.execution.latencyMs
    && observation.costUsd === 0
    && Number.isInteger(observation.userActionabilityScore)
    && observation.userActionabilityScore >= 0
    && observation.userActionabilityScore <= 3;
}

function canonicalCase(item: OriginAnswerQualityBenchmarkQuotaChunkCaseResult): string {
  const e = item.execution;
  const o = item.observation;
  return [
    item.caseId,
    item.category,
    item.caseDigest,
    e.finalAnswerRef ?? "",
    e.evidenceLedgerRef ?? "",
    e.verifierResult,
    e.providerRequests,
    e.toolCalls,
    e.latencyMs,
    e.failureCode ?? "",
    o.factualSupportScore,
    o.citationPrecisionScore,
    o.taskCompletionScore,
    o.contradictionDetectionScore,
    o.verifierRejectedUnsupportedClaim ? 1 : 0,
    o.repairSucceeded === undefined ? "na" : o.repairSucceeded ? 1 : 0,
    o.unsupportedMaterialClaimCount,
    o.verificationIntegrityAccurate ? 1 : 0,
    o.failClosedCorrect === undefined ? "na" : o.failClosedCorrect ? 1 : 0,
    o.userActionabilityScore,
  ].join("\t");
}

export function digestOriginAnswerQualityBenchmarkQuotaChunkArtifact(
  input: Omit<OriginAnswerQualityBenchmarkQuotaChunkArtifact, "artifactDigest">,
): string {
  return sha256([
    input.schemaVersion,
    input.planDigest,
    input.parentManifestDigest,
    input.chunkIndex,
    input.chunkCount,
    input.gitSha,
    input.providerId,
    input.modelId,
    input.scorerProvenanceDigest,
    input.startedAt,
    input.completedAt,
    input.runtimeProviderRequests,
    input.evaluatorRequests,
    input.totalRequests,
    input.totalCostUsd,
    ...[...input.cases]
      .sort((a, b) => a.caseId.localeCompare(b.caseId))
      .map(canonicalCase),
  ].join("\n"));
}

export function createOriginAnswerQualityBenchmarkQuotaChunkArtifact(input: {
  readonly plan: OriginAnswerQualityBenchmarkQuotaChunkPlan;
  readonly gitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly scorerProvenanceDigest: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly evaluatorRequests: number;
  readonly cases: readonly OriginAnswerQualityBenchmarkQuotaChunkCaseResult[];
}): OriginAnswerQualityBenchmarkQuotaChunkArtifactResult {
  if (
    !SHA40.test(input.gitSha)
    || !SAFE_ID.test(input.providerId)
    || !SAFE_ID.test(input.modelId)
    || !SHA256.test(input.scorerProvenanceDigest)
    || !validIso(input.startedAt)
    || !validIso(input.completedAt)
    || Date.parse(input.completedAt) < Date.parse(input.startedAt)
    || input.cases.length !== input.plan.cases.length
  ) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_ARTIFACT_INVALID" };
  }

  const expected = new Map(
    input.plan.cases.map((item) => [item.caseId, item] as const),
  );
  const seen = new Set<string>();
  let runtimeProviderRequests = 0;

  for (const item of input.cases) {
    const planned = expected.get(item.caseId);
    if (
      !planned
      || seen.has(item.caseId)
      || item.category !== planned.category
      || item.caseDigest !== planned.caseDigest
    ) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_ARTIFACT_CASESET_MISMATCH" };
    }
    seen.add(item.caseId);

    if (!validExecution(item)) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_ARTIFACT_EXECUTION_MISMATCH" };
    }
    if (!validObservation(item)) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_ARTIFACT_OBSERVATION_MISMATCH" };
    }
    runtimeProviderRequests += item.execution.providerRequests;
  }

  try {
    assertOriginAnswerQualityBenchmarkQuotaChunkUsage(
      input.plan,
      runtimeProviderRequests,
      input.evaluatorRequests,
    );
  } catch {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_ARTIFACT_REQUEST_BUDGET_EXCEEDED" };
  }

  const base = {
    schemaVersion: "origin.aq-benchmark-quota-chunk-artifact.v1" as const,
    planDigest: input.plan.planDigest,
    parentManifestDigest: input.plan.parentManifestDigest,
    chunkIndex: input.plan.chunkIndex,
    chunkCount: input.plan.chunkCount,
    gitSha: input.gitSha,
    providerId: input.providerId,
    modelId: input.modelId,
    scorerProvenanceDigest: input.scorerProvenanceDigest,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    runtimeProviderRequests,
    evaluatorRequests: input.evaluatorRequests,
    totalRequests: runtimeProviderRequests + input.evaluatorRequests,
    totalCostUsd: 0 as const,
    cases: Object.freeze(input.cases.map((item) => Object.freeze({
      ...item,
      execution: Object.freeze({ ...item.execution }),
      observation: Object.freeze({ ...item.observation }),
    }))),
  };

  return {
    ok: true,
    value: Object.freeze({
      ...base,
      artifactDigest: digestOriginAnswerQualityBenchmarkQuotaChunkArtifact(base),
    }),
  };
}
