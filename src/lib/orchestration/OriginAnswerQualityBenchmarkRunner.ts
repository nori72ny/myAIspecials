import { createHash } from "node:crypto";

import type {
  OriginAnswerQualityBenchmarkCategory,
  OriginAnswerQualityBenchmarkObservation,
} from "./OriginAnswerQualityBenchmark.js";
import type {
  OriginAnswerQualityBenchmarkManifest,
} from "./OriginAnswerQualityBenchmarkManifest.js";

export interface OriginAnswerQualityBenchmarkExecutableCase {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly prompt: string;
  readonly caseDigest: string;
}

export interface OriginAnswerQualityBenchmarkExecutionEvidence {
  readonly caseId: string;
  readonly finalAnswerRef: string | null;
  readonly evidenceLedgerRef: string | null;
  readonly verifierResult: "PASS" | "REPAIR_REQUIRED" | "BLOCKED_UNVERIFIED";
  readonly providerRequests: number;
  readonly toolCalls: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly failureCode: string | null;
}

export interface OriginAnswerQualityBenchmarkExecutedCase {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly caseDigest: string;
  readonly execution: OriginAnswerQualityBenchmarkExecutionEvidence;
}

export interface OriginAnswerQualityBenchmarkScoredCase {
  readonly observation: OriginAnswerQualityBenchmarkObservation;
  readonly execution: OriginAnswerQualityBenchmarkExecutionEvidence;
}

export type OriginAnswerQualityBenchmarkCaseExecutor = (
  item: OriginAnswerQualityBenchmarkExecutableCase,
) => Promise<OriginAnswerQualityBenchmarkExecutionEvidence>;

export type OriginAnswerQualityBenchmarkCaseScorer = (
  item: OriginAnswerQualityBenchmarkExecutableCase,
  execution: OriginAnswerQualityBenchmarkExecutionEvidence,
) => Promise<OriginAnswerQualityBenchmarkObservation>;

export interface OriginAnswerQualityBenchmarkExecutionOnlyInput {
  readonly manifest: OriginAnswerQualityBenchmarkManifest;
  readonly cases: readonly OriginAnswerQualityBenchmarkExecutableCase[];
  readonly execute: OriginAnswerQualityBenchmarkCaseExecutor;
}

export interface OriginAnswerQualityBenchmarkExecutionOnlySuccess {
  readonly schemaVersion: "origin.aq-benchmark-execution-only.v1";
  readonly manifestDigest: string;
  readonly caseCount: number;
  readonly executedCases: readonly OriginAnswerQualityBenchmarkExecutedCase[];
  readonly totalProviderRequests: number;
  readonly totalToolCalls: number;
  readonly totalLatencyMs: number;
  readonly totalCostUsd: 0;
  readonly executionOnlyDigest: string;
}

export type OriginAnswerQualityBenchmarkExecutionOnlyResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkExecutionOnlySuccess }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_EXECUTION_CASESET_MISMATCH"
        | "AQ_BENCHMARK_EXECUTION_CASE_DIGEST_MISMATCH"
        | "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE"
        | "AQ_BENCHMARK_EXECUTION_FAILED";
      failedCaseId?: string;
      failureDetail?: string;
    };

export interface OriginAnswerQualityBenchmarkScoringPhaseInput {
  readonly manifest: OriginAnswerQualityBenchmarkManifest;
  readonly cases: readonly OriginAnswerQualityBenchmarkExecutableCase[];
  readonly execution: OriginAnswerQualityBenchmarkExecutionOnlySuccess;
  readonly score: OriginAnswerQualityBenchmarkCaseScorer;
}

export interface OriginAnswerQualityBenchmarkRunnerInput
  extends OriginAnswerQualityBenchmarkExecutionOnlyInput {
  readonly score: OriginAnswerQualityBenchmarkCaseScorer;
}

export interface OriginAnswerQualityBenchmarkRunnerSuccess {
  readonly schemaVersion: "origin.aq-benchmark-execution.v1";
  readonly manifestDigest: string;
  readonly caseCount: number;
  readonly scoredCases: readonly OriginAnswerQualityBenchmarkScoredCase[];
  readonly totalProviderRequests: number;
  readonly totalToolCalls: number;
  readonly totalLatencyMs: number;
  readonly totalCostUsd: 0;
}

export type OriginAnswerQualityBenchmarkRunnerResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkRunnerSuccess }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_EXECUTION_CASESET_MISMATCH"
        | "AQ_BENCHMARK_EXECUTION_CASE_DIGEST_MISMATCH"
        | "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE"
        | "AQ_BENCHMARK_EXECUTION_INVALID_SCORE"
        | "AQ_BENCHMARK_EXECUTION_FAILED"
        | "AQ_BENCHMARK_SCORING_FAILED";
      failedCaseId?: string;
      failureDetail?: string;
    };

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_FAILURE_DETAIL = /^[A-Z][A-Z0-9_:.-]{0,160}$/;

function safeFailureDetail(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_FAILURE_DETAIL.test(code)) return code;
  }
  return error instanceof Error && SAFE_FAILURE_DETAIL.test(error.message)
    ? error.message
    : undefined;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function digestOriginAnswerQualityBenchmarkCase(
  caseId: string,
  category: OriginAnswerQualityBenchmarkCategory,
  prompt: string,
): string {
  return sha256(`${caseId}\n${category}\n${prompt}`);
}

function validExecution(
  item: OriginAnswerQualityBenchmarkExecutableCase,
  execution: OriginAnswerQualityBenchmarkExecutionEvidence,
): boolean {
  return execution.caseId === item.caseId
    && Number.isInteger(execution.providerRequests)
    && execution.providerRequests >= 0
    && Number.isInteger(execution.toolCalls)
    && execution.toolCalls >= 0
    && Number.isFinite(execution.latencyMs)
    && execution.latencyMs >= 0
    && Number.isFinite(execution.costUsd)
    && execution.costUsd === 0
    && (execution.failureCode === null || execution.failureCode.trim().length > 0);
}

function validScore(
  item: OriginAnswerQualityBenchmarkExecutableCase,
  execution: OriginAnswerQualityBenchmarkExecutionEvidence,
  observation: OriginAnswerQualityBenchmarkObservation,
): boolean {
  return observation.caseId === item.caseId
    && observation.category === item.category
    && observation.providerRequests === execution.providerRequests
    && observation.latencyMs === execution.latencyMs
    && observation.costUsd === execution.costUsd;
}

function validateCaseSet(
  manifest: OriginAnswerQualityBenchmarkManifest,
  cases: readonly OriginAnswerQualityBenchmarkExecutableCase[],
): "ok" | "set" | "digest" {
  if (cases.length !== manifest.cases.length) return "set";

  const expected = new Map(
    manifest.cases.map((item) => [item.caseId, item] as const),
  );
  const seen = new Set<string>();

  for (const item of cases) {
    if (seen.has(item.caseId)) return "set";
    seen.add(item.caseId);

    const manifestCase = expected.get(item.caseId);
    if (!manifestCase || manifestCase.category !== item.category) return "set";
    if (!DIGEST.test(item.caseDigest) || manifestCase.caseDigest !== item.caseDigest) return "digest";
    if (digestOriginAnswerQualityBenchmarkCase(item.caseId, item.category, item.prompt) !== item.caseDigest) {
      return "digest";
    }
  }

  return seen.size === expected.size ? "ok" : "set";
}

function canonicalExecutionCase(item: OriginAnswerQualityBenchmarkExecutedCase): string {
  const e = item.execution;
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
    e.costUsd,
    e.failureCode ?? "",
  ].join("\t");
}

export function digestOriginAnswerQualityBenchmarkExecutionOnly(
  input: Omit<OriginAnswerQualityBenchmarkExecutionOnlySuccess, "executionOnlyDigest">,
): string {
  const cases = [...input.executedCases]
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
    .map(canonicalExecutionCase)
    .join("\n");

  return sha256([
    input.schemaVersion,
    input.manifestDigest,
    input.caseCount,
    input.totalProviderRequests,
    input.totalToolCalls,
    input.totalLatencyMs,
    input.totalCostUsd,
    cases,
  ].join("\n"));
}

export async function runOriginAnswerQualityBenchmarkExecutionOnly(
  input: OriginAnswerQualityBenchmarkExecutionOnlyInput,
): Promise<OriginAnswerQualityBenchmarkExecutionOnlyResult> {
  const caseSet = validateCaseSet(input.manifest, input.cases);
  if (caseSet === "set") return { ok: false, code: "AQ_BENCHMARK_EXECUTION_CASESET_MISMATCH" };
  if (caseSet === "digest") return { ok: false, code: "AQ_BENCHMARK_EXECUTION_CASE_DIGEST_MISMATCH" };

  const executedCases: OriginAnswerQualityBenchmarkExecutedCase[] = [];
  let totalProviderRequests = 0;
  let totalToolCalls = 0;
  let totalLatencyMs = 0;

  for (const item of input.cases) {
    let execution: OriginAnswerQualityBenchmarkExecutionEvidence;
    try {
      execution = await input.execute(item);
    } catch (error) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_EXECUTION_FAILED",
        failedCaseId: item.caseId,
        ...(safeFailureDetail(error) ? { failureDetail: safeFailureDetail(error) } : {}),
      };
    }

    if (!validExecution(item, execution)) {
      return { ok: false, code: "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE", failedCaseId: item.caseId };
    }

    executedCases.push(Object.freeze({
      caseId: item.caseId,
      category: item.category,
      caseDigest: item.caseDigest,
      execution: Object.freeze({ ...execution }),
    }));
    totalProviderRequests += execution.providerRequests;
    totalToolCalls += execution.toolCalls;
    totalLatencyMs += execution.latencyMs;
  }

  const base = {
    schemaVersion: "origin.aq-benchmark-execution-only.v1" as const,
    manifestDigest: input.manifest.manifestDigest,
    caseCount: executedCases.length,
    executedCases: Object.freeze(executedCases),
    totalProviderRequests,
    totalToolCalls,
    totalLatencyMs,
    totalCostUsd: 0 as const,
  };

  return {
    ok: true,
    value: Object.freeze({
      ...base,
      executionOnlyDigest: digestOriginAnswerQualityBenchmarkExecutionOnly(base),
    }),
  };
}

function validateFrozenExecution(
  manifest: OriginAnswerQualityBenchmarkManifest,
  cases: readonly OriginAnswerQualityBenchmarkExecutableCase[],
  execution: OriginAnswerQualityBenchmarkExecutionOnlySuccess,
): boolean {
  if (
    execution.schemaVersion !== "origin.aq-benchmark-execution-only.v1"
    || execution.manifestDigest !== manifest.manifestDigest
    || execution.caseCount !== cases.length
    || execution.executedCases.length !== cases.length
    || execution.totalCostUsd !== 0
  ) return false;

  const recomputed = digestOriginAnswerQualityBenchmarkExecutionOnly({
    schemaVersion: execution.schemaVersion,
    manifestDigest: execution.manifestDigest,
    caseCount: execution.caseCount,
    executedCases: execution.executedCases,
    totalProviderRequests: execution.totalProviderRequests,
    totalToolCalls: execution.totalToolCalls,
    totalLatencyMs: execution.totalLatencyMs,
    totalCostUsd: 0,
  });
  if (recomputed !== execution.executionOnlyDigest) return false;

  const byId = new Map(execution.executedCases.map((item) => [item.caseId, item] as const));
  return cases.every((item) => {
    const executed = byId.get(item.caseId);
    return executed !== undefined
      && executed.category === item.category
      && executed.caseDigest === item.caseDigest
      && validExecution(item, executed.execution);
  });
}

export async function scoreOriginAnswerQualityBenchmarkExecution(
  input: OriginAnswerQualityBenchmarkScoringPhaseInput,
): Promise<OriginAnswerQualityBenchmarkRunnerResult> {
  const caseSet = validateCaseSet(input.manifest, input.cases);
  if (caseSet === "set") return { ok: false, code: "AQ_BENCHMARK_EXECUTION_CASESET_MISMATCH" };
  if (caseSet === "digest") return { ok: false, code: "AQ_BENCHMARK_EXECUTION_CASE_DIGEST_MISMATCH" };
  if (!validateFrozenExecution(input.manifest, input.cases, input.execution)) {
    return { ok: false, code: "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE" };
  }

  const executionById = new Map(
    input.execution.executedCases.map((item) => [item.caseId, item.execution] as const),
  );
  const scoredCases: OriginAnswerQualityBenchmarkScoredCase[] = [];

  for (const item of input.cases) {
    const execution = executionById.get(item.caseId);
    if (!execution) {
      return { ok: false, code: "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE", failedCaseId: item.caseId };
    }

    let observation: OriginAnswerQualityBenchmarkObservation;
    try {
      observation = await input.score(item, execution);
    } catch (error) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SCORING_FAILED",
        failedCaseId: item.caseId,
        ...(safeFailureDetail(error) ? { failureDetail: safeFailureDetail(error) } : {}),
      };
    }

    if (!validScore(item, execution, observation)) {
      return { ok: false, code: "AQ_BENCHMARK_EXECUTION_INVALID_SCORE", failedCaseId: item.caseId };
    }

    scoredCases.push(Object.freeze({
      execution: Object.freeze({ ...execution }),
      observation: Object.freeze({ ...observation }),
    }));
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-execution.v1",
      manifestDigest: input.execution.manifestDigest,
      caseCount: scoredCases.length,
      scoredCases: Object.freeze(scoredCases),
      totalProviderRequests: input.execution.totalProviderRequests,
      totalToolCalls: input.execution.totalToolCalls,
      totalLatencyMs: input.execution.totalLatencyMs,
      totalCostUsd: 0,
    }),
  };
}

export async function runOriginAnswerQualityBenchmark(
  input: OriginAnswerQualityBenchmarkRunnerInput,
): Promise<OriginAnswerQualityBenchmarkRunnerResult> {
  const execution = await runOriginAnswerQualityBenchmarkExecutionOnly({
    manifest: input.manifest,
    cases: input.cases,
    execute: input.execute,
  });
  if (execution.ok === false) return execution;

  return scoreOriginAnswerQualityBenchmarkExecution({
    manifest: input.manifest,
    cases: input.cases,
    execution: execution.value,
    score: input.score,
  });
}
