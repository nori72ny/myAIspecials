import { createHash } from "node:crypto";
import {
  classifyOriginAnswerQualityEvaluatorFailure,
  type OriginAnswerQualitySafeEvaluatorFailureCode,
} from "./OriginAnswerQualityEvaluatorFailure.js";

import type {
  OriginAnswerQualityBenchmarkCategory,
} from "./OriginAnswerQualityBenchmark.js";

export interface OriginAnswerQualityBenchmarkSemanticJudgeRequest {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly rubricVersion: "origin.aq-semantic-rubric.v1";
  readonly promptDigest: string;
  readonly answerDigest: string;
  readonly prompt: string;
  readonly answerText: string;
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginAnswerQualityBenchmarkSemanticJudgeRecord {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly rubricVersion: "origin.aq-semantic-rubric.v1";
  readonly promptDigest: string;
  readonly answerDigest: string;
  readonly deliverableCompleted: boolean;
  readonly materialContradictionsPresent: number;
  readonly materialContradictionsSurfaced: number;
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
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_INVALID_INPUT"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_NOT_AVAILABLE"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_FAILED"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_COST_UNVERIFIED"
        | "AQ_BENCHMARK_SEMANTIC_JUDGE_INVALID_SCORE"
        | OriginAnswerQualitySafeEvaluatorFailureCode;
    };

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const MAX_PROMPT_CHARS = 4_000;
const MAX_ANSWER_CHARS = 50_000;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function isRecord(value: unknown): value is OriginAnswerQualityBenchmarkSemanticJudgeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<OriginAnswerQualityBenchmarkSemanticJudgeRecord>;
  return typeof item.caseId === "string"
    && typeof item.category === "string"
    && item.rubricVersion === "origin.aq-semantic-rubric.v1"
    && typeof item.promptDigest === "string"
    && typeof item.answerDigest === "string"
    && typeof item.deliverableCompleted === "boolean"
    && typeof item.materialContradictionsPresent === "number"
    && typeof item.materialContradictionsSurfaced === "number"
    && typeof item.verificationIntegrityAccurate === "boolean"
    && (item.failClosedCorrect === undefined || typeof item.failClosedCorrect === "boolean")
    && typeof item.userActionabilityScore === "number"
    && typeof item.actualCostUsd === "number"
    && item.attempts === 1;
}

export async function judgeOriginAnswerQualityBenchmarkSemantics(
  input: {
    readonly caseId: string;
    readonly category: OriginAnswerQualityBenchmarkCategory;
    readonly prompt: string;
    readonly answerText: string;
  },
  judge?: OriginAnswerQualityBenchmarkSemanticJudge,
): Promise<OriginAnswerQualityBenchmarkSemanticJudgeResult> {
  const prompt = normalize(input.prompt);
  const answerText = normalize(input.answerText);
  if (
    !CASE_ID.test(input.caseId)
    || prompt.length === 0
    || prompt.length > MAX_PROMPT_CHARS
    || answerText.length === 0
    || answerText.length > MAX_ANSWER_CHARS
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_INVALID_INPUT" };
  }
  if (!judge) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_NOT_AVAILABLE" };
  }

  const promptDigest = sha256(prompt);
  const answerDigest = sha256(answerText);
  const request: OriginAnswerQualityBenchmarkSemanticJudgeRequest = Object.freeze({
    caseId: input.caseId,
    category: input.category,
    rubricVersion: "origin.aq-semantic-rubric.v1",
    promptDigest,
    answerDigest,
    prompt,
    answerText,
    executionPolicy: Object.freeze({
      maxCostUsd: 0,
      maxAttempts: 1,
    }),
  });

  let raw: unknown;
  try {
    raw = await judge(request);
  } catch (error) {
    return {
      ok: false,
      code: classifyOriginAnswerQualityEvaluatorFailure(error)
        ?? "AQ_BENCHMARK_SEMANTIC_JUDGE_FAILED",
    };
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH" };
  }
  if (
    raw.caseId !== request.caseId
    || raw.category !== request.category
    || raw.rubricVersion !== request.rubricVersion
    || raw.promptDigest !== request.promptDigest
    || raw.answerDigest !== request.answerDigest
    || raw.attempts !== 1
    || !SHA256.test(raw.promptDigest)
    || !SHA256.test(raw.answerDigest)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH" };
  }
  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_COST_UNVERIFIED" };
  }
  if (
    !Number.isInteger(raw.materialContradictionsPresent)
    || raw.materialContradictionsPresent < 0
    || !Number.isInteger(raw.materialContradictionsSurfaced)
    || raw.materialContradictionsSurfaced < 0
    || raw.materialContradictionsSurfaced > raw.materialContradictionsPresent
    || !Number.isInteger(raw.userActionabilityScore)
    || raw.userActionabilityScore < 0
    || raw.userActionabilityScore > 3
    || (input.category === "fail-closed") !== (raw.failClosedCorrect !== undefined)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SEMANTIC_JUDGE_INVALID_SCORE" };
  }

  return {
    ok: true,
    value: Object.freeze({ ...raw }),
  };
}
