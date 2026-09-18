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
const ARTIFACT_KEYS = new Set([
  "schemaVersion",
  "runId",
  "gitSha",
  "manifestDigest",
  "providerId",
  "modelId",
  "startedAt",
  "completedAt",
  "caseCount",
  "totalProviderRequests",
  "totalToolCalls",
  "totalLatencyMs",
  "totalCostUsd",
  "executionOnlyDigest",
  "executionSessionDigest",
  "cases",
  "artifactDigest",
]);
const CASE_KEYS = new Set([
  "caseId",
  "category",
  "caseDigest",
  "finalAnswerRef",
  "evidenceLedgerRef",
  "verifierResult",
  "providerRequests",
  "toolCalls",
  "latencyMs",
  "failureCode",
]);
const CATEGORIES = new Set([
  "current-factual",
  "multi-source-comparison",
  "contradiction-detection",
  "professional-advice",
  "user-document",
  "coding-generation",
  "coding-repair",
  "fail-closed",
  "artifact-generation",
  "multi-turn-context",
]);
const VERIFIER_RESULTS = new Set(["PASS", "REPAIR_REQUIRED", "BLOCKED_UNVERIFIED"]);

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


function exactKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function parseOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
  input: unknown,
): OriginAnswerQualityBenchmarkFrozenExecutionArtifactResult {
  const value = record(input);
  if (!value || !exactKeys(value, ARTIFACT_KEYS)) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH" };
  }
  if (
    value.schemaVersion !== "origin.aq-benchmark-frozen-execution-artifact.v1"
    || typeof value.runId !== "string" || !SAFE_ID.test(value.runId)
    || typeof value.gitSha !== "string" || !SHA40.test(value.gitSha)
    || typeof value.manifestDigest !== "string" || !SHA256.test(value.manifestDigest)
    || typeof value.providerId !== "string" || !SAFE_ID.test(value.providerId)
    || typeof value.modelId !== "string" || !SAFE_ID.test(value.modelId)
    || !validIsoDate(value.startedAt)
    || !validIsoDate(value.completedAt)
    || !nonNegativeInteger(value.caseCount)
    || !nonNegativeInteger(value.totalProviderRequests)
    || !nonNegativeInteger(value.totalToolCalls)
    || !finiteNonNegative(value.totalLatencyMs)
    || value.totalCostUsd !== 0
    || typeof value.executionOnlyDigest !== "string" || !SHA256.test(value.executionOnlyDigest)
    || typeof value.executionSessionDigest !== "string" || !SHA256.test(value.executionSessionDigest)
    || typeof value.artifactDigest !== "string" || !SHA256.test(value.artifactDigest)
    || !Array.isArray(value.cases)
    || value.cases.length !== value.caseCount
  ) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH" };
  }

  const cases: OriginAnswerQualityBenchmarkFrozenExecutionArtifactCase[] = [];
  const seen = new Set<string>();
  for (const raw of value.cases) {
    const item = record(raw);
    if (!item || !exactKeys(item, CASE_KEYS)) {
      return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH" };
    }
    if (
      typeof item.caseId !== "string" || !SAFE_ID.test(item.caseId)
      || seen.has(item.caseId)
      || typeof item.category !== "string" || !CATEGORIES.has(item.category)
      || typeof item.caseDigest !== "string" || !SHA256.test(item.caseDigest)
      || !validReference(typeof item.finalAnswerRef === "string" || item.finalAnswerRef === null ? item.finalAnswerRef : "__invalid__")
      || !validReference(typeof item.evidenceLedgerRef === "string" || item.evidenceLedgerRef === null ? item.evidenceLedgerRef : "__invalid__")
      || typeof item.verifierResult !== "string" || !VERIFIER_RESULTS.has(item.verifierResult)
      || !nonNegativeInteger(item.providerRequests)
      || !nonNegativeInteger(item.toolCalls)
      || !finiteNonNegative(item.latencyMs)
      || !(
        item.failureCode === null
        || (typeof item.failureCode === "string" && FAILURE_CODE.test(item.failureCode))
      )
    ) {
      return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH" };
    }
    seen.add(item.caseId);
    cases.push(Object.freeze({
      caseId: item.caseId,
      category: item.category as OriginAnswerQualityBenchmarkExecutedCase["category"],
      caseDigest: item.caseDigest,
      finalAnswerRef: item.finalAnswerRef as string | null,
      evidenceLedgerRef: item.evidenceLedgerRef as string | null,
      verifierResult: item.verifierResult as OriginAnswerQualityBenchmarkExecutedCase["execution"]["verifierResult"],
      providerRequests: item.providerRequests,
      toolCalls: item.toolCalls,
      latencyMs: item.latencyMs,
      failureCode: item.failureCode as string | null,
    }));
  }

  const parsed: OriginAnswerQualityBenchmarkFrozenExecutionArtifact = Object.freeze({
    schemaVersion: "origin.aq-benchmark-frozen-execution-artifact.v1",
    runId: value.runId,
    gitSha: value.gitSha,
    manifestDigest: value.manifestDigest,
    providerId: value.providerId,
    modelId: value.modelId,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    caseCount: value.caseCount,
    totalProviderRequests: value.totalProviderRequests,
    totalToolCalls: value.totalToolCalls,
    totalLatencyMs: value.totalLatencyMs,
    totalCostUsd: 0,
    executionOnlyDigest: value.executionOnlyDigest,
    executionSessionDigest: value.executionSessionDigest,
    cases: Object.freeze(cases),
    artifactDigest: value.artifactDigest,
  });

  const { artifactDigest, ...withoutDigest } = parsed;
  if (digestOriginAnswerQualityBenchmarkFrozenExecutionArtifact(withoutDigest) !== artifactDigest) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_ARTIFACT_DIGEST_MISMATCH" };
  }
  return { ok: true, value: parsed };
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
