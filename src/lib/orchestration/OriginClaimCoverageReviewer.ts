import { createHash } from "node:crypto";

import type { OriginClaimSet } from "./OriginClaimModel.js";

export interface OriginClaimCoverageReviewRequest {
  readonly answerText: string;
  readonly answerDigest: string;
  readonly claimSetDigest: string;
  readonly extractorExecution: {
    readonly executionId: string;
    readonly modelId: string;
  };
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginClaimCoverageReviewRecord {
  readonly answerDigest: string;
  readonly claimSetDigest: string;
  readonly coverage: "complete" | "incomplete";
  readonly missingClaimSpans: readonly string[];
  readonly reviewerExecution: {
    readonly executionId: string;
    readonly modelId: string;
  };
  readonly actualCostUsd: 0;
  readonly attempts: 1;
}

export interface OriginClaimCoverageReviewer {
  (request: OriginClaimCoverageReviewRequest): Promise<unknown>;
}

export type OriginClaimCoverageReviewResult =
  | { ok: true; record: OriginClaimCoverageReviewRecord }
  | {
      ok: false;
      code:
        | "CLAIM_COVERAGE_REVIEWER_NOT_AVAILABLE"
        | "CLAIM_COVERAGE_REVIEW_FAILED"
        | "CLAIM_COVERAGE_RECORD_MISMATCH"
        | "CLAIM_COVERAGE_COST_UNVERIFIED"
        | "CLAIM_COVERAGE_IDENTITY_UNVERIFIED"
        | "CLAIM_COVERAGE_INCOMPLETE";
      missingClaimSpans?: readonly string[];
    };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

function isRecord(value: unknown): value is OriginClaimCoverageReviewRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<OriginClaimCoverageReviewRecord>;
  return typeof r.answerDigest === "string"
    && typeof r.claimSetDigest === "string"
    && (r.coverage === "complete" || r.coverage === "incomplete")
    && Array.isArray(r.missingClaimSpans)
    && !!r.reviewerExecution
    && typeof r.reviewerExecution.executionId === "string"
    && typeof r.reviewerExecution.modelId === "string"
    && typeof r.actualCostUsd === "number"
    && r.attempts === 1;
}

export async function reviewOriginMaterialClaimCoverage(
  answerText: string,
  claimSet: OriginClaimSet,
  extractorExecution: { executionId: string; modelId: string },
  reviewer?: OriginClaimCoverageReviewer,
): Promise<OriginClaimCoverageReviewResult> {
  const normalizedAnswer = answerText.replace(/\r\n/g, "\n").trim();
  const answerDigest = sha256(normalizedAnswer);
  const claimSetDigest = sha256(canonicalJson(claimSet));

  if (
    !normalizedAnswer
    || !ID.test(extractorExecution.executionId)
    || !ID.test(extractorExecution.modelId)
    || !DIGEST.test(answerDigest)
    || !DIGEST.test(claimSetDigest)
  ) {
    return { ok: false, code: "CLAIM_COVERAGE_RECORD_MISMATCH" };
  }

  if (!reviewer) {
    return { ok: false, code: "CLAIM_COVERAGE_REVIEWER_NOT_AVAILABLE" };
  }

  const request: OriginClaimCoverageReviewRequest = {
    answerText: normalizedAnswer,
    answerDigest,
    claimSetDigest,
    extractorExecution,
    executionPolicy: { maxCostUsd: 0, maxAttempts: 1 },
  };

  let raw: unknown;
  try {
    raw = await reviewer(request);
  } catch {
    return { ok: false, code: "CLAIM_COVERAGE_REVIEW_FAILED" };
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "CLAIM_COVERAGE_RECORD_MISMATCH" };
  }

  if (
    raw.answerDigest !== answerDigest
    || raw.claimSetDigest !== claimSetDigest
    || raw.attempts !== 1
    || !ID.test(raw.reviewerExecution.executionId)
    || !ID.test(raw.reviewerExecution.modelId)
  ) {
    return { ok: false, code: "CLAIM_COVERAGE_RECORD_MISMATCH" };
  }

  if (
    raw.reviewerExecution.executionId === extractorExecution.executionId
    || raw.reviewerExecution.modelId === extractorExecution.modelId
  ) {
    return { ok: false, code: "CLAIM_COVERAGE_IDENTITY_UNVERIFIED" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "CLAIM_COVERAGE_COST_UNVERIFIED" };
  }

  const missing = raw.missingClaimSpans
    .map((span) => span.trim())
    .filter((span) => span.length > 0);

  if (
    missing.length !== raw.missingClaimSpans.length
    || missing.some((span) => span.length > 2_000 || !normalizedAnswer.includes(span))
  ) {
    return { ok: false, code: "CLAIM_COVERAGE_RECORD_MISMATCH" };
  }

  if (raw.coverage === "complete") {
    if (missing.length > 0) {
      return { ok: false, code: "CLAIM_COVERAGE_RECORD_MISMATCH" };
    }
    return { ok: true, record: Object.freeze({ ...raw, missingClaimSpans: Object.freeze([]) }) };
  }

  if (missing.length === 0) {
    return { ok: false, code: "CLAIM_COVERAGE_RECORD_MISMATCH" };
  }

  return {
    ok: false,
    code: "CLAIM_COVERAGE_INCOMPLETE",
    missingClaimSpans: Object.freeze([...missing]),
  };
}
