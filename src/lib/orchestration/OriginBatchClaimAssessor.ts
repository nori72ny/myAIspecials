import { containsSensitiveInput } from "./SensitiveInputDetector.js";
import type { OriginFetchedPublicSource } from "./OriginPublicSourceFetch.js";

export interface OriginBatchClaimAssessmentItem {
  readonly id: string;
  readonly claim: string;
  readonly source: OriginFetchedPublicSource;
}

export interface OriginBatchClaimAssessmentRequestItem {
  readonly id: string;
  readonly claim: string;
  readonly sourceUrl: string;
  readonly sourceDigest: string;
  readonly sourceText: string;
}

export interface OriginBatchClaimAssessmentRequest {
  readonly items: readonly OriginBatchClaimAssessmentRequestItem[];
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginBatchClaimAssessmentRecordItem {
  readonly id: string;
  readonly claim: string;
  readonly sourceUrl: string;
  readonly sourceDigest: string;
  readonly support: "supported" | "not-supported" | "conflicting";
  readonly supportingExcerpt?: string;
}

export interface OriginBatchClaimAssessmentRecord {
  readonly items: readonly OriginBatchClaimAssessmentRecordItem[];
  readonly actualCostUsd: 0;
  readonly attempts: 1;
}

export interface OriginBatchClaimAssessor {
  (request: OriginBatchClaimAssessmentRequest): Promise<unknown>;
}

export type OriginBatchClaimAssessmentResult =
  | { readonly ok: true; readonly record: OriginBatchClaimAssessmentRecord }
  | {
      readonly ok: false;
      readonly code:
        | "INVALID_BATCH_CLAIM_ASSESSMENT_REQUEST"
        | "BATCH_CLAIM_ASSESSOR_NOT_AVAILABLE"
        | "BATCH_CLAIM_ASSESSMENT_FAILED"
        | "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH"
        | "BATCH_CLAIM_ASSESSMENT_COST_UNVERIFIED"
        | "BATCH_CLAIM_NOT_SUPPORTED";
    };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_ITEMS = 8;
const MAX_CLAIM = 1_000;
const MAX_SOURCE = 64_000;
const MAX_EXCERPT = 1_000;

function clean(value: string, max: number): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function isRecord(value: unknown): value is OriginBatchClaimAssessmentRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OriginBatchClaimAssessmentRecord>;
  return Array.isArray(record.items)
    && typeof record.actualCostUsd === "number"
    && record.attempts === 1;
}

function isItem(value: unknown): value is OriginBatchClaimAssessmentRecordItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OriginBatchClaimAssessmentRecordItem>;
  return typeof item.id === "string"
    && typeof item.claim === "string"
    && typeof item.sourceUrl === "string"
    && typeof item.sourceDigest === "string"
    && (item.support === "supported" || item.support === "not-supported" || item.support === "conflicting")
    && (item.supportingExcerpt === undefined || typeof item.supportingExcerpt === "string");
}

export async function assessOriginClaimsAgainstSourcesBatch(
  items: readonly OriginBatchClaimAssessmentItem[],
  assessor?: OriginBatchClaimAssessor,
): Promise<OriginBatchClaimAssessmentResult> {
  if (items.length === 0 || items.length > MAX_ITEMS) {
    return { ok: false, code: "INVALID_BATCH_CLAIM_ASSESSMENT_REQUEST" };
  }

  const seen = new Set<string>();
  const requestItems: OriginBatchClaimAssessmentRequestItem[] = [];

  for (const item of items) {
    const claim = clean(item.claim, MAX_CLAIM);
    const sourceText = clean(item.source.body, MAX_SOURCE);

    if (
      !ID.test(item.id)
      || seen.has(item.id)
      || !claim
      || containsSensitiveInput(claim)
      || !sourceText
      || !DIGEST.test(item.source.contentDigest)
    ) {
      return { ok: false, code: "INVALID_BATCH_CLAIM_ASSESSMENT_REQUEST" };
    }

    seen.add(item.id);
    requestItems.push(Object.freeze({
      id: item.id,
      claim,
      sourceUrl: item.source.finalUrl,
      sourceDigest: item.source.contentDigest,
      sourceText,
    }));
  }

  if (!assessor) {
    return { ok: false, code: "BATCH_CLAIM_ASSESSOR_NOT_AVAILABLE" };
  }

  const request: OriginBatchClaimAssessmentRequest = {
    items: Object.freeze(requestItems),
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
    },
  };

  let raw: unknown;
  try {
    raw = await assessor(request);
  } catch {
    return { ok: false, code: "BATCH_CLAIM_ASSESSMENT_FAILED" };
  }

  if (!isRecord(raw) || raw.items.length !== request.items.length) {
    return { ok: false, code: "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "BATCH_CLAIM_ASSESSMENT_COST_UNVERIFIED" };
  }

  const byId = new Map(request.items.map((item) => [item.id, item]));
  for (const output of raw.items) {
    if (!isItem(output)) {
      return { ok: false, code: "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH" };
    }

    const input = byId.get(output.id);
    if (
      !input
      || output.claim !== input.claim
      || output.sourceUrl !== input.sourceUrl
      || output.sourceDigest !== input.sourceDigest
    ) {
      return { ok: false, code: "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH" };
    }

    if (output.support !== "supported") {
      return { ok: false, code: "BATCH_CLAIM_NOT_SUPPORTED" };
    }

    const excerpt = output.supportingExcerpt
      ? clean(output.supportingExcerpt, MAX_EXCERPT)
      : null;

    if (!excerpt || !input.sourceText.includes(excerpt)) {
      return { ok: false, code: "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH" };
    }
  }

  return {
    ok: true,
    record: Object.freeze({
      items: Object.freeze(raw.items.map((item) => Object.freeze({ ...item }))),
      actualCostUsd: 0,
      attempts: 1,
    }),
  };
}
