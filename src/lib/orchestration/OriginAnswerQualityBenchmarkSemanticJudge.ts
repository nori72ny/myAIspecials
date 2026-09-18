import { createHash } from "node:crypto";

import type {
  OriginAnswerQualityBenchmarkExecutableCase,
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner.js";

export interface OriginAnswerQualityBenchmarkSemanticJudgeRequest {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkExecutableCase["category"];
  readonly prompt: string;
  readonly promptDigest: string;
  readonly finalAnswerRef: string;
  readonly evidenceLedgerRef: string;
  readonly answerText: string;
  readonly execution: {
    readonly verifierResult: OriginAnswerQualityBenchmarkExecutionEvidence["verifierResult"];
    readonly providerRequests: number;
    readonly toolCalls: number;
    readonly failureCode: string | null;
  };
  readonly deterministicEvidence: {
    readonly totalMaterialClaims: number;
    readonly supportedMaterialClaims: number;
    readonly totalRenderedCitations: number;
    readonly supportingRenderedCitations: number;
  };
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginAnswerQualityBenchmarkSemanticJudgeRecord {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkExecutableCase["category"];
  readonly promptDigest: string;
  readonly finalAnswerRef: string;
  readonly evidenceLedgerRef: string;
  readonly materialContradictionsPresent: number;
  readonly materialContradictionsSurfaced: number;
  readonly deliverableCompleted: boolean;
  readonly verifierRejectedUnsupportedClaim: boolean;
  readonly verificationIntegrityAccurate: boolean;
  readonly failClosedCorrect?: boolean;
  readonly userActionabilityScore: 0 | 1 | 2 | 3;
  readonly actualCostUsd: 0;
  readonly attempts: 1;
}

export interface OriginAnswerQualityBenchmarkSemanticJudge {
  (request: OriginAnswerQualityBenchmarkSemanticJudgeRequest): Promise<unknown>;
}

export type OriginAnswerQualityBenchmarkSemanticJudgeResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkSemanticJudgeRecord }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_NOT_AVAILABLE"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_FAILED"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_COST_UNVERIFIED";
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is OriginAnswerQualityBenchmarkSemanticJudgeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<OriginAnswerQualityBenchmarkSemanticJudgeRecord>;
  return typeof record.caseId === "string"
    && typeof record.category === "string"
    && typeof record.promptDigest === "string"
    && typeof record.finalAnswerRef === "string"
    && typeof record.evidenceLedgerRef === "string"
    && nonNegativeInteger(record.materialContradictionsPresent)
    && nonNegativeInteger(record.materialContradictionsSurfaced)
    && typeof record.deliverableCompleted === "boolean"
    && typeof record.verifierRejectedUnsupportedClaim === "boolean"
    && typeof record.verificationIntegrityAccurate === "boolean"
    && (
      record.failClosedCorrect === undefined
      || typeof record.failClosedCorrect === "boolean"
    )
    && (
      record.userActionabilityScore === 0
      || record.userActionabilityScore === 1
      || record.userActionabilityScore === 2
      || record.userActionabilityScore === 3
    )
    && typeof record.actualCostUsd === "number"
    && record.attempts === 1;
}

export async function judgeOriginAnswerQualityBenchmarkSemantics(
  item: OriginAnswerQualityBenchmarkExecutableCase,
  execution: OriginAnswerQualityBenchmarkExecutionEvidence,
  answerText: string,
  evidenceLedgerRef: string,
  deterministicEvidence: OriginAnswerQualityBenchmarkSemanticJudgeRequest["deterministicEvidence"],
  judge?: OriginAnswerQualityBenchmarkSemanticJudge,
): Promise<OriginAnswerQualityBenchmarkSemanticJudgeResult> {
  if (!judge) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_NOT_AVAILABLE" };
  }
  if (!execution.finalAnswerRef || execution.evidenceLedgerRef !== evidenceLedgerRef) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH" };
  }

  const promptDigest = sha256(item.prompt);
  const request: OriginAnswerQualityBenchmarkSemanticJudgeRequest = {
    caseId: item.caseId,
    category: item.category,
    prompt: item.prompt,
    promptDigest,
    finalAnswerRef: execution.finalAnswerRef,
    evidenceLedgerRef,
    answerText,
    execution: {
      verifierResult: execution.verifierResult,
      providerRequests: execution.providerRequests,
      toolCalls: execution.toolCalls,
      failureCode: execution.failureCode,
    },
    deterministicEvidence,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
    },
  };

  let raw: unknown;
  try {
    raw = await judge(request);
  } catch {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_FAILED" };
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH" };
  }

  if (
    raw.caseId !== request.caseId
    || raw.category !== request.category
    || raw.promptDigest !== request.promptDigest
    || raw.finalAnswerRef !== request.finalAnswerRef
    || raw.evidenceLedgerRef !== request.evidenceLedgerRef
    || raw.attempts !== 1
    || raw.materialContradictionsSurfaced > raw.materialContradictionsPresent
    || (
      item.category === "fail-closed"
        ? raw.failClosedCorrect === undefined
        : raw.failClosedCorrect !== undefined
    )
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_COST_UNVERIFIED" };
  }

  return {
    ok: true,
    value: Object.freeze({ ...raw, actualCostUsd: 0, attempts: 1 }),
  };
}
