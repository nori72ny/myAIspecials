import { createHash } from "node:crypto";

import {
  createOriginClaimSet,
  type OriginClaimSet,
  type OriginMaterialClaimInput,
} from "./OriginClaimModel.js";

export interface OriginMaterialClaimExtractionRequest {
  readonly answerText: string;
  readonly answerDigest: string;
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginMaterialClaimExtractionRecord {
  readonly answerDigest: string;
  readonly claims: readonly OriginMaterialClaimInput[];
  readonly actualCostUsd: 0;
  readonly attempts: 1;
}

export interface OriginMaterialClaimExtractor {
  (request: OriginMaterialClaimExtractionRequest): Promise<unknown>;
}

export type OriginMaterialClaimExtractionResult =
  | { ok: true; claimSet: OriginClaimSet }
  | {
      ok: false;
      code:
        | "CLAIM_EXTRACTOR_NOT_AVAILABLE"
        | "CLAIM_EXTRACTION_FAILED"
        | "CLAIM_EXTRACTION_RECORD_MISMATCH"
        | "CLAIM_EXTRACTION_COST_UNVERIFIED"
        | "CLAIM_EXTRACTION_INVALID";
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalizeAnswer(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function isRecord(value: unknown): value is OriginMaterialClaimExtractionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OriginMaterialClaimExtractionRecord>;
  return typeof record.answerDigest === "string"
    && Array.isArray(record.claims)
    && typeof record.actualCostUsd === "number"
    && record.attempts === 1;
}

export async function extractOriginMaterialClaims(
  answerText: string,
  extractor?: OriginMaterialClaimExtractor,
): Promise<OriginMaterialClaimExtractionResult> {
  const normalizedAnswer = normalizeAnswer(answerText);
  if (!normalizedAnswer) {
    return { ok: false, code: "CLAIM_EXTRACTION_INVALID" };
  }

  const answerDigest = sha256(normalizedAnswer);
  if (!extractor) {
    return { ok: false, code: "CLAIM_EXTRACTOR_NOT_AVAILABLE" };
  }

  const request: OriginMaterialClaimExtractionRequest = {
    answerText: normalizedAnswer,
    answerDigest,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
    },
  };

  let raw: unknown;
  try {
    raw = await extractor(request);
  } catch {
    return { ok: false, code: "CLAIM_EXTRACTION_FAILED" };
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" };
  }

  if (
    raw.answerDigest !== answerDigest
    || raw.attempts !== 1
  ) {
    return { ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "CLAIM_EXTRACTION_COST_UNVERIFIED" };
  }

  for (const claim of raw.claims) {
    if (!normalizedAnswer.includes(claim.text.trim())) {
      return { ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" };
    }
  }

  const claimSet = createOriginClaimSet(raw.claims);
  if (!claimSet.ok) {
    return { ok: false, code: "CLAIM_EXTRACTION_INVALID" };
  }

  return { ok: true, claimSet: claimSet.value };
}
