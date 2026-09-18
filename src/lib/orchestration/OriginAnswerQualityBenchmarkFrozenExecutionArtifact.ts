import { createHash } from "node:crypto";

import type {
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import type {
  OriginAnswerQualityBenchmarkEnvironmentProof,
} from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  digestOriginAnswerQualityBenchmarkExecutionOnly,
  type OriginAnswerQualityBenchmarkExecutedCase,
  type OriginAnswerQualityBenchmarkExecutionOnlySuccess,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import type {
  OriginAnswerQualityBenchmarkRunProvenance,
} from "./OriginAnswerQualityBenchmarkRunProvenance.js";
import {
  digestOriginAnswerQualityBenchmarkExecutionSession,
  type OriginAnswerQualityBenchmarkFrozenExecutionSession,
} from "./OriginAnswerQualityBenchmarkTwoPhaseSession.js";

export interface OriginAnswerQualityBenchmarkFrozenExecutionArtifactCase {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkExecutedCase["category"];
  readonly caseDigest: string;
  readonly finalAnswerRef: string | null;
  readonly evidenceLedgerRef: string | null;
  readonly verifierResult: OriginAnswerQualityBenchmarkExecutedCase["execution"]["verifierResult"];
  readonly providerRequests: number;
  readonly toolCalls: number;
  readonly latencyMs: number;
  readonly failureCode: string | null;
}

export interface OriginAnswerQualityBenchmarkFrozenExecutionArtifact {
  readonly schemaVersion: "origin.aq-benchmark-frozen-execution-artifact.v1";
  readonly runId: string;
  readonly gitSha: string;
  readonly manifestDigest: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly caseCount: number;
  readonly totalProviderRequests: number;
  readonly totalToolCalls: number;
  readonly totalLatencyMs: number;
  readonly totalCostUsd: 0;
  readonly executionOnlyDigest: string;
  readonly executionSessionDigest: string;
  readonly cases: readonly OriginAnswerQualityBenchmarkFrozenExecutionArtifactCase[];
  readonly artifactDigest: string;
}

export type OriginAnswerQualityBenchmarkFrozenExecutionArtifactResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkFrozenExecutionArtifact }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_FROZEN_ARTIFACT_INVALID_REFERENCE"
        | "AQ_BENCHMARK_FROZEN_ARTIFACT_INVALID_FAILURE_CODE"
        | "AQ_BENCHMARK_FROZEN_ARTIFACT_DIGEST_MISMATCH"
        | "AQ_BENCHMARK_FROZEN_ARTIFACT_CORPUS_MISMATCH"
        | "AQ_BENCHMARK_FROZEN_ARTIFACT_ENVIRONMENT_MISMATCH"
        | "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH";
    };

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;
const FAILURE_CODE = /^[A-Z0-9][A-Z0-9_:-]{0,127}$/;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function validReference(value: string | null): boolean {
  return value === null || SHA256.test(value);
}

function canonicalCase(item: OriginAnswerQualityBenchmarkFrozenExecutionArtifactCase): string {
  return [
    item.caseId,
    item.category,
    item.caseDigest,
    item.finalAnswerRef ?? "",
    item.evidenceLedgerRef ?? "",
    item.verifierResult,
    item.providerRequests,
    item.toolCalls,
    item.latencyMs,
    item.failureCode ?? "",
  ].join("\t");
}

function canonicalArtifact(
  input: Omit<OriginAnswerQualityBenchmarkFrozenExecutionArtifact, "artifactDigest">,
): string {
  return [
    input.schemaVersion,
    input.runId,
    input.gitSha,
    input.manifestDigest,
    input.providerId,
    input.modelId,
    input.startedAt,
    input.completedAt,
    input.caseCount,
    input.totalProviderRequests,
    input.totalToolCalls,
    input.totalLatencyMs,
    input.totalCostUsd,
    input.executionOnlyDigest,
    input.executionSessionDigest,
    [...input.cases].sort((a, b) => a.caseId.localeCompare(b.caseId)).map(canonicalCase).join("\n"),
  ].join("\n");
}

export function digestOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
  input: Omit<OriginAnswerQualityBenchmarkFrozenExecutionArtifact, "artifactDigest">,
): string {
  return sha256(canonicalArtifact(input));
}

export function createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
  frozen: OriginAnswerQualityBenchmarkFrozenExecutionSession,
): OriginAnswerQualityBenchmarkFrozenExecutionArtifactResult {
  if (
    !SHA40.test(frozen.provenance.gitSha)
    || !SHA256.test(frozen.provenance.manifestDigest)
    || !SHA256.test(frozen.execution.executionOnlyDigest)
    || !SHA256.test(frozen.executionSessionDigest)
    || !SAFE_ID.test(frozen.provenance.runId)
    || !SAFE_ID.test(frozen.provenance.providerId)
    || !SAFE_ID.test(frozen.provenance.modelId)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH" };
  }

  const cases: OriginAnswerQualityBenchmarkFrozenExecutionArtifactCase[] = [];
  for (const item of frozen.execution.executedCases) {
    if (
      !validReference(item.execution.finalAnswerRef)
      || !validReference(item.execution.evidenceLedgerRef)
    ) {
      return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_INVALID_REFERENCE" };
    }
    if (
      item.execution.failureCode !== null
      && !FAILURE_CODE.test(item.execution.failureCode)
    ) {
      return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_INVALID_FAILURE_CODE" };
    }
    cases.push(Object.freeze({
      caseId: item.caseId,
      category: item.category,
      caseDigest: item.caseDigest,
      finalAnswerRef: item.execution.finalAnswerRef,
      evidenceLedgerRef: item.execution.evidenceLedgerRef,
      verifierResult: item.execution.verifierResult,
      providerRequests: item.execution.providerRequests,
      toolCalls: item.execution.toolCalls,
      latencyMs: item.execution.latencyMs,
      failureCode: item.execution.failureCode,
    }));
  }

  const base = {
    schemaVersion: "origin.aq-benchmark-frozen-execution-artifact.v1" as const,
    runId: frozen.provenance.runId,
    gitSha: frozen.provenance.gitSha,
    manifestDigest: frozen.provenance.manifestDigest,
    providerId: frozen.provenance.providerId,
    modelId: frozen.provenance.modelId,
    startedAt: frozen.provenance.startedAt,
    completedAt: frozen.provenance.completedAt,
    caseCount: frozen.execution.caseCount,
    totalProviderRequests: frozen.execution.totalProviderRequests,
    totalToolCalls: frozen.execution.totalToolCalls,
    totalLatencyMs: frozen.execution.totalLatencyMs,
    totalCostUsd: 0 as const,
    executionOnlyDigest: frozen.execution.executionOnlyDigest,
    executionSessionDigest: frozen.executionSessionDigest,
    cases: Object.freeze(cases),
  };

  return {
    ok: true,
    value: Object.freeze({
      ...base,
      artifactDigest: digestOriginAnswerQualityBenchmarkFrozenExecutionArtifact(base),
    }),
  };
}

function provenanceFromArtifact(
  artifact: OriginAnswerQualityBenchmarkFrozenExecutionArtifact,
): OriginAnswerQualityBenchmarkRunProvenance {
  return {
    schemaVersion: "origin.aq-benchmark-run.v1",
    runId: artifact.runId,
    gitSha: artifact.gitSha,
    manifestDigest: artifact.manifestDigest,
    providerId: artifact.providerId,
    modelId: artifact.modelId,
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: artifact.startedAt,
    completedAt: artifact.completedAt,
  };
}

function executionFromArtifact(
  artifact: OriginAnswerQualityBenchmarkFrozenExecutionArtifact,
): OriginAnswerQualityBenchmarkExecutionOnlySuccess {
  const executedCases = artifact.cases.map((item): OriginAnswerQualityBenchmarkExecutedCase =>
    Object.freeze({
      caseId: item.caseId,
      category: item.category,
      caseDigest: item.caseDigest,
      execution: Object.freeze({
        caseId: item.caseId,
        finalAnswerRef: item.finalAnswerRef,
        evidenceLedgerRef: item.evidenceLedgerRef,
        verifierResult: item.verifierResult,
        providerRequests: item.providerRequests,
        toolCalls: item.toolCalls,
        latencyMs: item.latencyMs,
        costUsd: 0,
        failureCode: item.failureCode,
      }),
    })
  );
  return Object.freeze({
    schemaVersion: "origin.aq-benchmark-execution-only.v1",
    manifestDigest: artifact.manifestDigest,
    caseCount: artifact.caseCount,
    executedCases: Object.freeze(executedCases),
    totalProviderRequests: artifact.totalProviderRequests,
    totalToolCalls: artifact.totalToolCalls,
    totalLatencyMs: artifact.totalLatencyMs,
    totalCostUsd: 0,
    executionOnlyDigest: artifact.executionOnlyDigest,
  });
}

export function restoreOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
  artifact: OriginAnswerQualityBenchmarkFrozenExecutionArtifact,
  corpus: OriginAnswerQualityBenchmarkFrozenCorpus,
  environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof,
): OriginAnswerQualityBenchmarkFrozenExecutionArtifactResult | {
  ok: true;
  value: OriginAnswerQualityBenchmarkFrozenExecutionSession;
} {
  const { artifactDigest: _artifactDigest, ...withoutDigest } = artifact;
  if (
    !SHA256.test(artifact.artifactDigest)
    || digestOriginAnswerQualityBenchmarkFrozenExecutionArtifact(withoutDigest)
      !== artifact.artifactDigest
  ) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_DIGEST_MISMATCH" };
  }

  if (
    artifact.manifestDigest !== corpus.manifest.manifestDigest
    || artifact.caseCount !== corpus.cases.length
  ) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_CORPUS_MISMATCH" };
  }

  if (
    environmentProof.expectedGitSha !== artifact.gitSha
    || environmentProof.observedReleaseSha !== artifact.gitSha
    || environmentProof.costUsd !== 0
    || environmentProof.freeOnly !== true
    || environmentProof.paidFallbackEnabled !== false
  ) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_ENVIRONMENT_MISMATCH" };
  }

  const provenance = provenanceFromArtifact(artifact);
  const execution = executionFromArtifact(artifact);

  if (
    digestOriginAnswerQualityBenchmarkExecutionOnly({
      schemaVersion: execution.schemaVersion,
      manifestDigest: execution.manifestDigest,
      caseCount: execution.caseCount,
      executedCases: execution.executedCases,
      totalProviderRequests: execution.totalProviderRequests,
      totalToolCalls: execution.totalToolCalls,
      totalLatencyMs: execution.totalLatencyMs,
      totalCostUsd: 0,
    }) !== artifact.executionOnlyDigest
  ) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH" };
  }

  const base = {
    schemaVersion: "origin.aq-benchmark-frozen-execution-session.v1" as const,
    corpus,
    environmentProof,
    provenance,
    execution,
  };
  const executionSessionDigest = digestOriginAnswerQualityBenchmarkExecutionSession(base);
  if (executionSessionDigest !== artifact.executionSessionDigest) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH" };
  }

  return {
    ok: true,
    value: Object.freeze({
      ...base,
      executionSessionDigest,
    }),
  };
}
