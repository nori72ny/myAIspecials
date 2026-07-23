import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { normalizeOriginPublicHttpsUrl } from "./OriginPublicSourceUrl";
import { containsSensitiveInput } from "./SensitiveInputDetector";

const MAX_CLAIM_LENGTH = 1_000;
const MAX_ID_LENGTH = 200;
const DEFAULT_MAX_RECORD_AGE_MS = 15 * 60 * 1_000;
const MAX_ALLOWED_RECORD_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 30_000;
const SAFE_VERIFICATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export interface OriginSourceVerificationRequest {
  verificationId: string;
  evidence: OriginAnswerEvidenceItem;
}

export interface OriginSourceVerificationExecutionRequest {
  verificationId: string;
  claim: string;
  sourceUrl: string;
  executionPolicy: {
    maxCostUsd: 0;
    maxAttempts: 1;
    allowRedirects: false;
    publicNetworkOnly: true;
  };
}

export interface OriginSourceVerificationRecord {
  verificationId: string;
  sourceUrl: string;
  finalUrl: string;
  claim: string;
  fetchedAt: string;
  httpStatus: 200;
  contentDigest: string;
  externalFetchPerformed: true;
  actualCostUsd: 0;
  networkPolicy: {
    publicAddressOnly: true;
    redirectsFollowed: false;
  };
  checks: {
    content: "passed" | "failed";
    freshness: "passed" | "not-applicable" | "failed";
    claimSupport: "passed" | "failed";
  };
}

export interface OriginSourceVerificationExecutor {
  (request: OriginSourceVerificationExecutionRequest): Promise<unknown>;
}

export type OriginSourceVerificationFailureCode =
  | "INVALID_VERIFICATION_REQUEST"
  | "VERIFIER_NOT_AVAILABLE"
  | "VERIFICATION_EXECUTION_FAILED"
  | "VERIFICATION_RECORD_MISMATCH"
  | "VERIFICATION_RECORD_STALE"
  | "VERIFICATION_COST_UNVERIFIED"
  | "SOURCE_NOT_VERIFIED";

export type OriginSourceVerificationResult =
  | { ok: true; evidence: OriginAnswerEvidenceItem }
  | { ok: false; code: OriginSourceVerificationFailureCode; message: string };

function cleanBounded(value: string, maxLength: number): string | null {
  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

function validateRequest(
  request: OriginSourceVerificationRequest,
): OriginSourceVerificationExecutionRequest | null {
  const verificationId = cleanBounded(request.verificationId, MAX_ID_LENGTH);
  const claim = request.evidence.claim
    ? cleanBounded(request.evidence.claim, MAX_CLAIM_LENGTH)
    : null;
  const sourceUrl = request.evidence.sourceUrl
    ? normalizeOriginPublicHttpsUrl(request.evidence.sourceUrl)
    : null;
  const checks = request.evidence.checks;

  if (
    !verificationId
    || !claim
    || !SAFE_VERIFICATION_ID.test(verificationId)
    || containsSensitiveInput(claim)
    || !sourceUrl
    || request.evidence.evidenceLevel !== "provided"
    || request.evidence.claimBinding !== "explicit-inline-citation"
    || checks.safeUrl !== "passed"
    || checks.content !== "not-run"
    || checks.freshness !== "not-run"
    || checks.claimSupport !== "not-run"
  ) return null;

  return {
    verificationId,
    claim,
    sourceUrl,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
      allowRedirects: false,
      publicNetworkOnly: true,
    },
  };
}

function isVerificationRecord(value: unknown): value is OriginSourceVerificationRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OriginSourceVerificationRecord>;
  const networkPolicy = candidate.networkPolicy;
  const checks = candidate.checks;

  return typeof candidate.verificationId === "string"
    && typeof candidate.sourceUrl === "string"
    && typeof candidate.finalUrl === "string"
    && typeof candidate.claim === "string"
    && typeof candidate.fetchedAt === "string"
    && candidate.httpStatus === 200
    && typeof candidate.contentDigest === "string"
    && candidate.externalFetchPerformed === true
    && typeof candidate.actualCostUsd === "number"
    && Boolean(networkPolicy)
    && networkPolicy?.publicAddressOnly === true
    && networkPolicy?.redirectsFollowed === false
    && Boolean(checks)
    && (checks?.content === "passed" || checks?.content === "failed")
    && (
      checks?.freshness === "passed"
      || checks?.freshness === "not-applicable"
      || checks?.freshness === "failed"
    )
    && (checks?.claimSupport === "passed" || checks?.claimSupport === "failed");
}

export async function executeOriginSourceVerification(
  request: OriginSourceVerificationRequest,
  execute?: OriginSourceVerificationExecutor,
  nowMs = Date.now(),
  maxRecordAgeMs = DEFAULT_MAX_RECORD_AGE_MS,
): Promise<OriginSourceVerificationResult> {
  const executionRequest = validateRequest(request);
  if (
    !executionRequest
    || !Number.isFinite(nowMs)
    || !Number.isFinite(maxRecordAgeMs)
    || maxRecordAgeMs <= 0
    || maxRecordAgeMs > MAX_ALLOWED_RECORD_AGE_MS
  ) {
    return {
      ok: false,
      code: "INVALID_VERIFICATION_REQUEST",
      message: "出典確認の対象、主張、または実行条件が正しくありません。",
    };
  }

  if (!execute) {
    return {
      ok: false,
      code: "VERIFIER_NOT_AVAILABLE",
      message: "出典内容を確認する安全な実行経路が接続されていません。",
    };
  }

  let rawRecord: unknown;
  try {
    rawRecord = await execute(executionRequest);
  } catch {
    return {
      ok: false,
      code: "VERIFICATION_EXECUTION_FAILED",
      message: "出典確認に失敗したため、未確認のまま扱います。",
    };
  }

  if (!isVerificationRecord(rawRecord)) {
    return {
      ok: false,
      code: "VERIFICATION_RECORD_MISMATCH",
      message: "出典確認の実行記録が依頼内容または安全条件と一致しません。",
    };
  }

  const record = rawRecord;
  const recordSourceUrl = normalizeOriginPublicHttpsUrl(record.sourceUrl);
  const finalUrl = normalizeOriginPublicHttpsUrl(record.finalUrl);
  const fetchedAtMs = Date.parse(record.fetchedAt);
  const digestIsValid = /^sha256:[a-f0-9]{64}$/.test(record.contentDigest);
  const identityMatches = record.verificationId === executionRequest.verificationId
    && record.claim === executionRequest.claim
    && recordSourceUrl === executionRequest.sourceUrl
    && finalUrl === executionRequest.sourceUrl;
  const networkMatches = record.externalFetchPerformed === true
    && record.httpStatus === 200
    && record.networkPolicy.publicAddressOnly === true
    && record.networkPolicy.redirectsFollowed === false
    && digestIsValid;

  if (!identityMatches || !networkMatches) {
    return {
      ok: false,
      code: "VERIFICATION_RECORD_MISMATCH",
      message: "出典確認の実行記録が依頼内容または安全条件と一致しません。",
    };
  }

  if (
    !Number.isFinite(fetchedAtMs)
    || fetchedAtMs > nowMs + MAX_FUTURE_CLOCK_SKEW_MS
    || nowMs - fetchedAtMs > maxRecordAgeMs
  ) {
    return {
      ok: false,
      code: "VERIFICATION_RECORD_STALE",
      message: "出典確認の実行記録が古い、または時刻を確認できません。",
    };
  }

  if (record.actualCostUsd !== 0) {
    return {
      ok: false,
      code: "VERIFICATION_COST_UNVERIFIED",
      message: "出典確認の費用が0ドルであることを確認できません。",
    };
  }

  if (
    record.checks.content !== "passed"
    || record.checks.claimSupport !== "passed"
    || (record.checks.freshness !== "passed" && record.checks.freshness !== "not-applicable")
  ) {
    return {
      ok: false,
      code: "SOURCE_NOT_VERIFIED",
      message: "出典本文、更新時点、または回答との一致を確認できませんでした。",
    };
  }

  return {
    ok: true,
    evidence: {
      ...request.evidence,
      sourceUrl: executionRequest.sourceUrl,
      evidenceLevel: "source-checked",
      checks: {
        safeUrl: "passed",
        content: "passed",
        freshness: record.checks.freshness,
        claimSupport: "passed",
      },
    },
  };
}
