import { createHash } from "node:crypto";

import type { OriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance.js";
import type {
  OriginAnswerQualityBenchmarkRunnerSuccess,
  OriginAnswerQualityBenchmarkScoredCase,
} from "./OriginAnswerQualityBenchmarkRunner.js";

export interface OriginAnswerQualityBenchmarkBoundRun {
  readonly schemaVersion: "origin.aq-benchmark-bound-run.v1";
  readonly runId: string;
  readonly gitSha: string;
  readonly manifestDigest: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly freeOnly: true;
  readonly totalCostUsd: 0;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly caseCount: number;
  readonly totalProviderRequests: number;
  readonly totalToolCalls: number;
  readonly totalLatencyMs: number;
  readonly executionDigest: string;
  readonly scoredCases: readonly OriginAnswerQualityBenchmarkScoredCase[];
}

export type OriginAnswerQualityBenchmarkBoundRunResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkBoundRun }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_RUN_BINDING_MANIFEST_MISMATCH"
        | "AQ_BENCHMARK_RUN_BINDING_COST_MISMATCH"
        | "AQ_BENCHMARK_RUN_BINDING_CASECOUNT_MISMATCH"
        | "AQ_BENCHMARK_RUN_BINDING_TOTALS_MISMATCH";
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalCase(item: OriginAnswerQualityBenchmarkScoredCase): string {
  const o = item.observation;
  const e = item.execution;
  return [
    o.caseId,
    o.category,
    o.factualSupportScore,
    o.citationPrecisionScore,
    o.taskCompletionScore,
    o.contradictionDetectionScore,
    o.verifierRejectedUnsupportedClaim ? 1 : 0,
    o.repairSucceeded === undefined ? "na" : o.repairSucceeded ? 1 : 0,
    o.providerRequests,
    o.latencyMs,
    o.costUsd,
    o.unsupportedMaterialClaimCount,
    e.finalAnswerRef ?? "",
    e.evidenceLedgerRef ?? "",
    e.verifierResult,
    e.providerRequests,
    e.toolCalls,
    e.latencyMs,
    e.costUsd,
    e.failureCode ?? "",
  ].join("\t");
}

export function digestOriginAnswerQualityBenchmarkExecution(
  execution: OriginAnswerQualityBenchmarkRunnerSuccess,
): string {
  const cases = [...execution.scoredCases]
    .sort((a, b) => a.observation.caseId.localeCompare(b.observation.caseId))
    .map(canonicalCase)
    .join("\n");

  return sha256([
    execution.schemaVersion,
    execution.manifestDigest,
    execution.caseCount,
    execution.totalProviderRequests,
    execution.totalToolCalls,
    execution.totalLatencyMs,
    execution.totalCostUsd,
    cases,
  ].join("\n"));
}

export function bindOriginAnswerQualityBenchmarkRun(
  provenance: OriginAnswerQualityBenchmarkRunProvenance,
  execution: OriginAnswerQualityBenchmarkRunnerSuccess,
): OriginAnswerQualityBenchmarkBoundRunResult {
  if (provenance.manifestDigest !== execution.manifestDigest) {
    return { ok: false, code: "AQ_BENCHMARK_RUN_BINDING_MANIFEST_MISMATCH" };
  }
  if (provenance.totalCostUsd !== 0 || execution.totalCostUsd !== 0) {
    return { ok: false, code: "AQ_BENCHMARK_RUN_BINDING_COST_MISMATCH" };
  }
  if (execution.caseCount !== execution.scoredCases.length) {
    return { ok: false, code: "AQ_BENCHMARK_RUN_BINDING_CASECOUNT_MISMATCH" };
  }

  const providerRequests = execution.scoredCases.reduce(
    (sum, item) => sum + item.execution.providerRequests,
    0,
  );
  const toolCalls = execution.scoredCases.reduce(
    (sum, item) => sum + item.execution.toolCalls,
    0,
  );
  const latencyMs = execution.scoredCases.reduce(
    (sum, item) => sum + item.execution.latencyMs,
    0,
  );

  if (
    providerRequests !== execution.totalProviderRequests
    || toolCalls !== execution.totalToolCalls
    || latencyMs !== execution.totalLatencyMs
  ) {
    return { ok: false, code: "AQ_BENCHMARK_RUN_BINDING_TOTALS_MISMATCH" };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-bound-run.v1",
      runId: provenance.runId,
      gitSha: provenance.gitSha,
      manifestDigest: provenance.manifestDigest,
      providerId: provenance.providerId,
      modelId: provenance.modelId,
      freeOnly: true,
      totalCostUsd: 0,
      startedAt: provenance.startedAt,
      completedAt: provenance.completedAt,
      caseCount: execution.caseCount,
      totalProviderRequests: execution.totalProviderRequests,
      totalToolCalls: execution.totalToolCalls,
      totalLatencyMs: execution.totalLatencyMs,
      executionDigest: digestOriginAnswerQualityBenchmarkExecution(execution),
      scoredCases: execution.scoredCases,
    }),
  };
}
