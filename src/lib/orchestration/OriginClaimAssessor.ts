import { containsSensitiveInput } from "./SensitiveInputDetector.js";
import type { OriginFetchedPublicSource } from "./OriginPublicSourceFetch.js";
import {
  classifyOriginAnswerQualityEvaluatorFailure,
  type OriginAnswerQualitySafeEvaluatorFailureCode,
} from "./OriginAnswerQualityEvaluatorFailure.js";

export interface OriginClaimAssessmentRequest {
  claim: string;
  sourceUrl: string;
  sourceDigest: string;
  sourceText: string;
  executionPolicy: {
    maxCostUsd: 0;
    maxAttempts: 1;
  };
}

export interface OriginClaimAssessmentRecord {
  claim: string;
  sourceUrl: string;
  sourceDigest: string;
  support: "supported" | "not-supported" | "conflicting";
  supportingExcerpt?: string;
  actualCostUsd: 0;
  attempts: 1;
}

export interface OriginClaimAssessor {
  (request: OriginClaimAssessmentRequest): Promise<unknown>;
}

export type OriginClaimAssessmentResult =
  | { ok: true; record: OriginClaimAssessmentRecord }
  | {
      ok: false;
      code:
        | "INVALID_CLAIM_ASSESSMENT_REQUEST"
        | "CLAIM_ASSESSOR_NOT_AVAILABLE"
        | "CLAIM_ASSESSMENT_FAILED"
        | "CLAIM_ASSESSMENT_RECORD_MISMATCH"
        | "CLAIM_ASSESSMENT_COST_UNVERIFIED"
        | "CLAIM_NOT_SUPPORTED"
        | OriginAnswerQualitySafeEvaluatorFailureCode;
    };

const MAX_CLAIM = 1_000;
const MAX_SOURCE = 64_000;
const MAX_EXCERPT = 1_000;

function clean(value: string, max: number): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function isRecord(value: unknown): value is OriginClaimAssessmentRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<OriginClaimAssessmentRecord>;
  return typeof r.claim === "string"
    && typeof r.sourceUrl === "string"
    && typeof r.sourceDigest === "string"
    && (r.support === "supported" || r.support === "not-supported" || r.support === "conflicting")
    && typeof r.actualCostUsd === "number"
    && r.attempts === 1
    && (r.supportingExcerpt === undefined || typeof r.supportingExcerpt === "string");
}

export async function assessOriginClaimAgainstSource(
  claim: string,
  source: OriginFetchedPublicSource,
  assess?: OriginClaimAssessor,
): Promise<OriginClaimAssessmentResult> {
  const cleanClaim = clean(claim, MAX_CLAIM);
  const sourceText = clean(source.body, MAX_SOURCE);
  if (
    !cleanClaim
    || containsSensitiveInput(cleanClaim)
    || !sourceText
    || !/^sha256:[a-f0-9]{64}$/.test(source.contentDigest)
  ) {
    return { ok: false, code: "INVALID_CLAIM_ASSESSMENT_REQUEST" };
  }

  if (!assess) return { ok: false, code: "CLAIM_ASSESSOR_NOT_AVAILABLE" };

  const request: OriginClaimAssessmentRequest = {
    claim: cleanClaim,
    sourceUrl: source.finalUrl,
    sourceDigest: source.contentDigest,
    sourceText,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
    },
  };

  let raw: unknown;
  try {
    raw = await assess(request);
  } catch (error) {
    return {
      ok: false,
      code: classifyOriginAnswerQualityEvaluatorFailure(error)
        ?? "CLAIM_ASSESSMENT_FAILED",
    };
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "CLAIM_ASSESSMENT_RECORD_MISMATCH" };
  }

  if (
    raw.claim !== request.claim
    || raw.sourceUrl !== request.sourceUrl
    || raw.sourceDigest !== request.sourceDigest
    || raw.attempts !== 1
  ) {
    return { ok: false, code: "CLAIM_ASSESSMENT_RECORD_MISMATCH" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "CLAIM_ASSESSMENT_COST_UNVERIFIED" };
  }

  if (raw.support !== "supported") {
    return { ok: false, code: "CLAIM_NOT_SUPPORTED" };
  }

  const excerpt = raw.supportingExcerpt ? clean(raw.supportingExcerpt, MAX_EXCERPT) : null;
  if (!excerpt || !sourceText.includes(excerpt)) {
    return { ok: false, code: "CLAIM_ASSESSMENT_RECORD_MISMATCH" };
  }

  return {
    ok: true,
    record: Object.freeze({
      ...raw,
      supportingExcerpt: excerpt,
    }),
  };
}
