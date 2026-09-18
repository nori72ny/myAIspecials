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

export interface OriginAnswerQualityBenchmarkRunnerInput {
  readonly manifest: OriginAnswerQualityBenchmarkManifest;
  readonly cases: readonly OriginAnswerQualityBenchmarkExecutableCase[];
  readonly execute: OriginAnswerQualityBenchmarkCaseExecutor;
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
        | "AQ_BENCHMARK_EXECUTION_FAILED";
      failedCaseId?: string;
    };

const DIGEST = /^sha256:[a-f0-9]{64}$/;

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

export async function runOriginAnswerQualityBenchmark(
  input: OriginAnswerQualityBenchmarkRunnerInput,
): Promise<OriginAnswerQualityBenchmarkRunnerResult> {
  const caseSet = validateCaseSet(input.manifest, input.cases);
  if (caseSet === "set") return { ok: false, code: "AQ_BENCHMARK_EXECUTION_CASESET_MISMATCH" };
  if (caseSet === "digest") return { ok: false, code: "AQ_BENCHMARK_EXECUTION_CASE_DIGEST_MISMATCH" };

  const scoredCases: OriginAnswerQualityBenchmarkScoredCase[] = [];
  let totalProviderRequests = 0;
  let totalToolCalls = 0;
  let totalLatencyMs = 0;

  for (const item of input.cases) {
    let execution: OriginAnswerQualityBenchmarkExecutionEvidence;
    try {
      execution = await input.execute(item);
    } catch {
      return { ok: false, code: "AQ_BENCHMARK_EXECUTION_FAILED", failedCaseId: item.caseId };
    }

    if (!validExecution(item, execution)) {
      return { ok: false, code: "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE", failedCaseId: item.caseId };
    }

    let observation: OriginAnswerQualityBenchmarkObservation;
    try {
      observation = await input.score(item, execution);
    } catch {
      return { ok: false, code: "AQ_BENCHMARK_EXECUTION_FAILED", failedCaseId: item.caseId };
    }

    if (!validScore(item, execution, observation)) {
      return { ok: false, code: "AQ_BENCHMARK_EXECUTION_INVALID_SCORE", failedCaseId: item.caseId };
    }

    scoredCases.push(Object.freeze({ execution: Object.freeze({ ...execution }), observation: Object.freeze({ ...observation }) }));
    totalProviderRequests += execution.providerRequests;
    totalToolCalls += execution.toolCalls;
    totalLatencyMs += execution.latencyMs;
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-execution.v1",
      manifestDigest: input.manifest.manifestDigest,
      caseCount: scoredCases.length,
      scoredCases: Object.freeze(scoredCases),
      totalProviderRequests,
      totalToolCalls,
      totalLatencyMs,
      totalCostUsd: 0,
    }),
  };
}
