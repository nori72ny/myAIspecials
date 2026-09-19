import { createHash } from "node:crypto";
import {
  classifyOriginAnswerQualityEvaluatorFailure,
  type OriginAnswerQualitySafeEvaluatorFailureCode,
} from "./OriginAnswerQualityEvaluatorFailure.js";

import type { OriginClaimSet } from "./OriginClaimModel.js";

export interface OriginAnswerQualityBenchmarkPromptClaimJudgeRequest {
  readonly caseId: string;
  readonly rubricVersion: "origin.aq-prompt-claim-support.v1";
  readonly promptDigest: string;
  readonly claimSetDigest: string;
  readonly prompt: string;
  readonly claims: readonly {
    readonly id: string;
    readonly text: string;
  }[];
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginAnswerQualityBenchmarkPromptClaimJudgeRecord {
  readonly caseId: string;
  readonly rubricVersion: "origin.aq-prompt-claim-support.v1";
  readonly promptDigest: string;
  readonly claimSetDigest: string;
  readonly supportedClaimIds: readonly string[];
  readonly actualCostUsd: 0;
  readonly attempts: 1;
}

export interface OriginAnswerQualityBenchmarkPromptClaimJudge {
  (request: OriginAnswerQualityBenchmarkPromptClaimJudgeRequest): Promise<unknown>;
}

export type OriginAnswerQualityBenchmarkPromptClaimJudgeResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkPromptClaimJudgeRecord }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_INVALID_INPUT"
        | "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_NOT_AVAILABLE"
        | "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_FAILED"
        | "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_RECORD_MISMATCH"
        | "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_COST_UNVERIFIED"
        | OriginAnswerQualitySafeEvaluatorFailureCode;
    };

const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const CLAIM_ID = /^claim-[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const MAX_PROMPT_CHARS = 4_000;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function claimSetDigest(claims: OriginClaimSet["claims"]): string {
  const canonical = [...claims]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((claim) => [claim.id, claim.text, claim.kind, claim.freshness, claim.evidenceRequirement, claim.risk].join("\t"))
    .join("\n");
  return sha256(canonical);
}

function isRecord(value: unknown): value is OriginAnswerQualityBenchmarkPromptClaimJudgeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<OriginAnswerQualityBenchmarkPromptClaimJudgeRecord>;
  return typeof item.caseId === "string"
    && item.rubricVersion === "origin.aq-prompt-claim-support.v1"
    && typeof item.promptDigest === "string"
    && typeof item.claimSetDigest === "string"
    && Array.isArray(item.supportedClaimIds)
    && typeof item.actualCostUsd === "number"
    && item.attempts === 1;
}

export async function judgeOriginAnswerQualityClaimsAgainstPrompt(
  input: {
    readonly caseId: string;
    readonly prompt: string;
    readonly claimSet: OriginClaimSet;
  },
  judge?: OriginAnswerQualityBenchmarkPromptClaimJudge,
): Promise<OriginAnswerQualityBenchmarkPromptClaimJudgeResult> {
  const prompt = normalize(input.prompt);
  const factualClaims = input.claimSet.claims.filter((claim) => claim.kind === "factual");
  if (
    !CASE_ID.test(input.caseId)
    || prompt.length === 0
    || prompt.length > MAX_PROMPT_CHARS
    || factualClaims.some((claim) => !CLAIM_ID.test(claim.id))
  ) {
    return { ok: false, code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_INVALID_INPUT" };
  }

  if (!judge) {
    return { ok: false, code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_NOT_AVAILABLE" };
  }

  const promptDigest = sha256(prompt);
  const setDigest = claimSetDigest(factualClaims);
  const request: OriginAnswerQualityBenchmarkPromptClaimJudgeRequest = Object.freeze({
    caseId: input.caseId,
    rubricVersion: "origin.aq-prompt-claim-support.v1",
    promptDigest,
    claimSetDigest: setDigest,
    prompt,
    claims: Object.freeze(factualClaims.map((claim) => Object.freeze({
      id: claim.id,
      text: claim.text,
    }))),
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
        ?? "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_FAILED",
    };
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_RECORD_MISMATCH" };
  }
  if (
    raw.caseId !== request.caseId
    || raw.rubricVersion !== request.rubricVersion
    || raw.promptDigest !== request.promptDigest
    || raw.claimSetDigest !== request.claimSetDigest
    || raw.attempts !== 1
  ) {
    return { ok: false, code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_RECORD_MISMATCH" };
  }
  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_COST_UNVERIFIED" };
  }

  const validIds = new Set(factualClaims.map((claim) => claim.id));
  const seen = new Set<string>();
  for (const id of raw.supportedClaimIds) {
    if (typeof id !== "string" || !validIds.has(id) || seen.has(id)) {
      return { ok: false, code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_RECORD_MISMATCH" };
    }
    seen.add(id);
  }

  return {
    ok: true,
    value: Object.freeze({
      ...raw,
      supportedClaimIds: Object.freeze([...raw.supportedClaimIds]),
    }),
  };
}
