import { createHash } from "node:crypto";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  createOriginAnswerQualityFrozenCorpus,
  type OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import {
  createOriginAnswerQualityBenchmarkLaneExecutor,
  type OriginAnswerQualityBenchmarkLaneExecutors,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  bindOriginAnswerQualityMeasuredObservations,
  type OriginAnswerQualityBenchmarkMeasuredBoundRun,
} from "./OriginAnswerQualityBenchmarkMeasuredRunBinding.js";
import { bindOriginAnswerQualityBenchmarkRun } from "./OriginAnswerQualityBenchmarkRunBinding.js";
import {
  createOriginAnswerQualityBenchmarkRunProvenance,
  type OriginAnswerQualityBenchmarkRunProvenance,
} from "./OriginAnswerQualityBenchmarkRunProvenance.js";
import { assertOriginAnswerQualityBenchmarkRuntimeReady } from "./OriginAnswerQualityBenchmarkRuntimeReadiness.js";
import {
  digestOriginAnswerQualityBenchmarkExecutionOnly,
  runOriginAnswerQualityBenchmarkExecutionOnly,
  scoreOriginAnswerQualityBenchmarkExecution,
  type OriginAnswerQualityBenchmarkExecutionOnlySuccess,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import {
  isOriginAnswerQualityBenchmarkSessionEnvironmentProofValid,
  type OriginAnswerQualityBenchmarkScoringEvidenceCollector,
  type OriginAnswerQualityBenchmarkSessionSuccess,
} from "./OriginAnswerQualityBenchmarkSession.js";
import { scoreOriginAnswerQualityBenchmarkEvidence } from "./OriginAnswerQualityBenchmarkScoring.js";
import {
  buildOriginAnswerQualityBenchmarkScorecard,
  type OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard.js";

export interface OriginAnswerQualityBenchmarkExecutionSessionInput {
  readonly runId: string;
  readonly gitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly executors: OriginAnswerQualityBenchmarkLaneExecutors;
  readonly nowMs?: () => number;
  readonly corpus?: OriginAnswerQualityBenchmarkFrozenCorpus;
}

export interface OriginAnswerQualityBenchmarkFrozenExecutionSession {
  readonly schemaVersion: "origin.aq-benchmark-frozen-execution-session.v1";
  readonly corpus: OriginAnswerQualityBenchmarkFrozenCorpus;
  readonly environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly provenance: OriginAnswerQualityBenchmarkRunProvenance;
  readonly execution: OriginAnswerQualityBenchmarkExecutionOnlySuccess;
  readonly executionSessionDigest: string;
}

export type OriginAnswerQualityBenchmarkExecutionSessionResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkFrozenExecutionSession }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SESSION_ENVIRONMENT_PROOF_INVALID"
        | "AQ_BENCHMARK_SESSION_RUNTIME_NOT_READY"
        | "AQ_BENCHMARK_SESSION_EXECUTION_FAILED"
        | "AQ_BENCHMARK_SESSION_PROVENANCE_INVALID";
      detail?: string;
    };

export interface OriginAnswerQualityBenchmarkScoringSessionInput {
  readonly frozen: OriginAnswerQualityBenchmarkFrozenExecutionSession;
  readonly collectScoringEvidence: OriginAnswerQualityBenchmarkScoringEvidenceCollector;
}

export type OriginAnswerQualityBenchmarkScoringSessionResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkSessionSuccess }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_FROZEN_EXECUTION_INVALID"
        | "AQ_BENCHMARK_SESSION_EXECUTION_FAILED"
        | "AQ_BENCHMARK_SESSION_RUN_BINDING_FAILED"
        | "AQ_BENCHMARK_SESSION_SCORECARD_INVALID"
        | "AQ_BENCHMARK_SESSION_MEASURED_BINDING_FAILED";
      detail?: string;
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalEnvironmentProof(proof: OriginAnswerQualityBenchmarkEnvironmentProof): string {
  return [
    proof.schemaVersion,
    proof.baseUrl,
    proof.expectedGitSha,
    proof.observedReleaseSha,
    proof.freeOnly ? 1 : 0,
    proof.costUsd,
    proof.paidFallbackEnabled ? 1 : 0,
    proof.runtimeIds.research,
    proof.runtimeIds.coding,
    proof.runtimeIds.artifact,
    proof.codingReady ? 1 : 0,
  ].join("\t");
}

export function digestOriginAnswerQualityBenchmarkExecutionSession(
  input: Omit<OriginAnswerQualityBenchmarkFrozenExecutionSession, "executionSessionDigest">,
): string {
  return sha256([
    input.schemaVersion,
    input.corpus.manifest.manifestDigest,
    canonicalEnvironmentProof(input.environmentProof),
    input.provenance.runId,
    input.provenance.gitSha,
    input.provenance.providerId,
    input.provenance.modelId,
    input.provenance.startedAt,
    input.provenance.completedAt,
    input.execution.executionOnlyDigest,
  ].join("\n"));
}

function frozenSessionValid(
  frozen: OriginAnswerQualityBenchmarkFrozenExecutionSession,
): boolean {
  if (
    frozen.schemaVersion !== "origin.aq-benchmark-frozen-execution-session.v1"
    || frozen.provenance.gitSha !== frozen.environmentProof.expectedGitSha
    || frozen.provenance.gitSha !== frozen.environmentProof.observedReleaseSha
    || frozen.provenance.manifestDigest !== frozen.corpus.manifest.manifestDigest
    || frozen.execution.manifestDigest !== frozen.corpus.manifest.manifestDigest
    || frozen.provenance.totalCostUsd !== 0
    || frozen.execution.totalCostUsd !== 0
  ) return false;

  const executionOnlyDigest = digestOriginAnswerQualityBenchmarkExecutionOnly({
    schemaVersion: frozen.execution.schemaVersion,
    manifestDigest: frozen.execution.manifestDigest,
    caseCount: frozen.execution.caseCount,
    executedCases: frozen.execution.executedCases,
    totalProviderRequests: frozen.execution.totalProviderRequests,
    totalToolCalls: frozen.execution.totalToolCalls,
    totalLatencyMs: frozen.execution.totalLatencyMs,
    totalCostUsd: 0,
  });
  if (executionOnlyDigest !== frozen.execution.executionOnlyDigest) return false;

  const expected = digestOriginAnswerQualityBenchmarkExecutionSession({
    schemaVersion: frozen.schemaVersion,
    corpus: frozen.corpus,
    environmentProof: frozen.environmentProof,
    provenance: frozen.provenance,
    execution: frozen.execution,
  });
  return expected === frozen.executionSessionDigest;
}

export async function runOriginAnswerQualityBenchmarkExecutionSession(
  input: OriginAnswerQualityBenchmarkExecutionSessionInput,
): Promise<OriginAnswerQualityBenchmarkExecutionSessionResult> {
  if (!isOriginAnswerQualityBenchmarkSessionEnvironmentProofValid(
    input.environmentProof,
    input.gitSha,
  )) {
    return { ok: false, code: "AQ_BENCHMARK_SESSION_ENVIRONMENT_PROOF_INVALID" };
  }

  try {
    assertOriginAnswerQualityBenchmarkRuntimeReady(input.executors);
  } catch (error) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_RUNTIME_NOT_READY",
      detail: error instanceof Error ? error.message : undefined,
    };
  }

  const corpus = input.corpus ?? createOriginAnswerQualityFrozenCorpus();
  const nowMs = input.nowMs ?? Date.now;
  const startedAtMs = nowMs();

  const execution = await runOriginAnswerQualityBenchmarkExecutionOnly({
    manifest: corpus.manifest,
    cases: corpus.cases,
    execute: createOriginAnswerQualityBenchmarkLaneExecutor(input.executors),
  });
  if (execution.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED",
      detail: execution.failedCaseId
        ? `${execution.code}:${execution.failedCaseId}`
        : execution.code,
    };
  }

  const provenance = createOriginAnswerQualityBenchmarkRunProvenance({
    runId: input.runId,
    gitSha: input.gitSha,
    manifestDigest: corpus.manifest.manifestDigest,
    providerId: input.providerId,
    modelId: input.modelId,
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(nowMs()).toISOString(),
  }, corpus.manifest);
  if (provenance.ok === false) {
    return { ok: false, code: "AQ_BENCHMARK_SESSION_PROVENANCE_INVALID" };
  }

  const base = {
    schemaVersion: "origin.aq-benchmark-frozen-execution-session.v1" as const,
    corpus,
    environmentProof: input.environmentProof,
    provenance: provenance.value,
    execution: execution.value,
  };

  return {
    ok: true,
    value: Object.freeze({
      ...base,
      executionSessionDigest: digestOriginAnswerQualityBenchmarkExecutionSession(base),
    }),
  };
}

export async function scoreOriginAnswerQualityBenchmarkExecutionSession(
  input: OriginAnswerQualityBenchmarkScoringSessionInput,
): Promise<OriginAnswerQualityBenchmarkScoringSessionResult> {
  if (!frozenSessionValid(input.frozen)) {
    return { ok: false, code: "AQ_BENCHMARK_FROZEN_EXECUTION_INVALID" };
  }

  const measuredById = new Map<string, OriginAnswerQualityBenchmarkMeasuredObservation>();
  const scored = await scoreOriginAnswerQualityBenchmarkExecution({
    manifest: input.frozen.corpus.manifest,
    cases: input.frozen.corpus.cases,
    execution: input.frozen.execution,
    score: async (item, evidence) => {
      const rawEvidence = await input.collectScoringEvidence(item, evidence);
      const measured = scoreOriginAnswerQualityBenchmarkEvidence(evidence, rawEvidence);
      if (measured.ok === false) throw new Error(measured.code);
      measuredById.set(item.caseId, measured.value);
      return measured.value;
    },
  });
  if (scored.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED",
      detail: scored.failedCaseId ? `${scored.code}:${scored.failedCaseId}` : scored.code,
    };
  }

  const boundRun = bindOriginAnswerQualityBenchmarkRun(
    input.frozen.provenance,
    scored.value,
  );
  if (boundRun.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_RUN_BINDING_FAILED",
      detail: boundRun.code,
    };
  }

  const measuredObservations = input.frozen.corpus.cases
    .map((item) => measuredById.get(item.caseId))
    .filter((item): item is OriginAnswerQualityBenchmarkMeasuredObservation => item !== undefined);

  const scorecard = buildOriginAnswerQualityBenchmarkScorecard(
    input.frozen.corpus.manifest,
    measuredObservations,
  );
  if (scorecard.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_SCORECARD_INVALID",
      detail: scorecard.code,
    };
  }

  const measuredRun: { ok: true; value: OriginAnswerQualityBenchmarkMeasuredBoundRun } | ReturnType<typeof bindOriginAnswerQualityMeasuredObservations> =
    bindOriginAnswerQualityMeasuredObservations(boundRun.value, measuredObservations);
  if (measuredRun.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_MEASURED_BINDING_FAILED",
      detail: measuredRun.code,
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-session.v1",
      corpus: input.frozen.corpus,
      measuredRun: measuredRun.value,
    }),
  };
}
