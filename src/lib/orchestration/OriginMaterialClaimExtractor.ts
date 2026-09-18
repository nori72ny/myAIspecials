import { createHash } from "node:crypto";

import {
  createOriginClaimSet,
  type OriginClaimSet,
  type OriginMaterialClaimInput,
} from "./OriginClaimModel.js";
import { containsSensitiveInput } from "./SensitiveInputDetector.js";

export interface OriginMaterialClaimExtractionRequest {
  readonly answerDigest: string;
  readonly answerText: string;
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
    readonly maxClaims: 64;
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
        | "INVALID_CLAIM_EXTRACTION_INPUT"
        | "CLAIM_EXTRACTOR_NOT_AVAILABLE"
        | "CLAIM_EXTRACTION_FAILED"
        | "CLAIM_EXTRACTION_RECORD_MISMATCH"
        | "CLAIM_EXTRACTION_COST_UNVERIFIED"
        | "INVALID_EXTRACTED_CLAIMS";
    };

const MAX_ANSWER_CHARS = 32_000;

function answerDigest(answerText: string): string {
  return `sha256:${createHash("sha256").update(answerText, "utf8").digest("hex")}`;
}

function isRecord(value: unknown): value is OriginMaterialClaimExtractionRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<OriginMaterialClaimExtractionRecord>;
  return typeof r.answerDigest === "string"
    && Array.isArray(r.claims)
    && typeof r.actualCostUsd === "number"
    && r.attempts === 1;
}

export async function extractOriginMaterialClaims(
  answerText: string,
  extractor?: OriginMaterialClaimExtractor,
): Promise<OriginMaterialClaimExtractionResult> {
  const normalized = answerText.replace(/\r\n/g, "\n").trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_ANSWER_CHARS
    || containsSensitiveInput(normalized)
  ) {
    return { ok: false, code: "INVALID_CLAIM_EXTRACTION_INPUT" };
  }

  if (!extractor) {
    return { ok: false, code: "CLAIM_EXTRACTOR_NOT_AVAILABLE" };
  }

  const digest = answerDigest(normalized);
  const request: OriginMaterialClaimExtractionRequest = {
    answerDigest: digest,
    answerText: normalized,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
      maxClaims: 64,
    },
  };

  let raw: unknown;
  try {
    raw = await extractor(request);
  } catch {
    return { ok: false, code: "CLAIM_EXTRACTION_FAILED" };
  }

  if (!isRecord(raw) || raw.answerDigest !== digest || raw.attempts !== 1) {
    return { ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "CLAIM_EXTRACTION_COST_UNVERIFIED" };
  }

  if (raw.claims.length > request.executionPolicy.maxClaims) {
    return { ok: false, code: "INVALID_EXTRACTED_CLAIMS" };
  }

  const claimSet = createOriginClaimSet(raw.claims);
  if (!claimSet.ok) {
    return { ok: false, code: "INVALID_EXTRACTED_CLAIMS" };
  }

  return {
    ok: true,
    claimSet: claimSet.value,
  };
}
