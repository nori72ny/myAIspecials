import { createHash } from "node:crypto";

import {
  createOriginClaimSet,
  type OriginClaimSet,
  type OriginClaimEvidenceRequirement,
  type OriginClaimFreshness,
  type OriginClaimRisk,
  type OriginMaterialClaimInput,
  type OriginMaterialClaimKind,
} from "./OriginClaimModel.js";
import { containsSensitiveInput } from "./SensitiveInputDetector.js";

export interface OriginMaterialClaimCandidate {
  readonly id: string;
  readonly text: string;
}

export interface OriginMaterialClaimExtractionRequest {
  readonly answerDigest: string;
  readonly candidates: readonly OriginMaterialClaimCandidate[];
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
    readonly maxClaims: 64;
  };
}

export interface OriginMaterialClaimSelection {
  readonly id: string;
  readonly kind: OriginMaterialClaimKind;
  readonly freshness: OriginClaimFreshness;
  readonly evidenceRequirement: OriginClaimEvidenceRequirement;
  readonly risk: OriginClaimRisk;
}

export interface OriginMaterialClaimExtractionRecord {
  readonly answerDigest: string;
  readonly claims: readonly OriginMaterialClaimSelection[];
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
        | "CLAIM_EXTRACTION_CANDIDATE_LIMIT"
        | "CLAIM_EXTRACTOR_NOT_AVAILABLE"
        | "CLAIM_EXTRACTION_FAILED"
        | "CLAIM_EXTRACTION_RECORD_MISMATCH"
        | "CLAIM_EXTRACTION_COST_UNVERIFIED"
        | "INVALID_EXTRACTED_CLAIMS";
    };

const MAX_ANSWER_CHARS = 32_000;
const MAX_CLAIMS = 64;
const MAX_CLAIM_CHARS = 2_000;
const CLAIM_ID = /^claim-[1-9][0-9]{0,2}$/;

function answerDigest(answerText: string): string {
  return `sha256:${createHash("sha256").update(answerText, "utf8").digest("hex")}`;
}

function splitExactCandidates(answerText: string): readonly OriginMaterialClaimCandidate[] | null {
  const segments: string[] = [];

  for (const rawLine of answerText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const sentences = line.split(/(?<=[.!?。！？])\s+/u);
    for (const sentence of sentences) {
      const text = sentence.trim();
      if (!text) continue;

      if (text.length <= MAX_CLAIM_CHARS) {
        segments.push(text);
      } else {
        for (let offset = 0; offset < text.length; offset += MAX_CLAIM_CHARS) {
          const chunk = text.slice(offset, offset + MAX_CLAIM_CHARS).trim();
          if (chunk) segments.push(chunk);
        }
      }

      if (segments.length > MAX_CLAIMS) return null;
    }
  }

  if (segments.length === 0) return null;
  return Object.freeze(
    segments.map((text, index) =>
      Object.freeze({ id: `claim-${index + 1}`, text })
    ),
  );
}

function isRecord(value: unknown): value is OriginMaterialClaimExtractionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<OriginMaterialClaimExtractionRecord>;
  return typeof r.answerDigest === "string"
    && Array.isArray(r.claims)
    && typeof r.actualCostUsd === "number"
    && r.attempts === 1;
}

function selectedClaimInput(
  selection: unknown,
  candidates: ReadonlyMap<string, OriginMaterialClaimCandidate>,
): OriginMaterialClaimInput | null {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return null;
  }

  const value = selection as Partial<OriginMaterialClaimSelection>;
  if (typeof value.id !== "string" || !CLAIM_ID.test(value.id)) return null;
  const candidate = candidates.get(value.id);
  if (!candidate) return null;

  if (
    typeof value.kind !== "string"
    || typeof value.freshness !== "string"
    || typeof value.evidenceRequirement !== "string"
    || typeof value.risk !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    text: candidate.text,
    kind: value.kind as OriginMaterialClaimKind,
    freshness: value.freshness as OriginClaimFreshness,
    evidenceRequirement: value.evidenceRequirement as OriginClaimEvidenceRequirement,
    risk: value.risk as OriginClaimRisk,
  };
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

  const candidates = splitExactCandidates(normalized);
  if (!candidates) {
    return { ok: false, code: "CLAIM_EXTRACTION_CANDIDATE_LIMIT" };
  }

  if (!extractor) {
    return { ok: false, code: "CLAIM_EXTRACTOR_NOT_AVAILABLE" };
  }

  const digest = answerDigest(normalized);
  const request: OriginMaterialClaimExtractionRequest = {
    answerDigest: digest,
    candidates,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
      maxClaims: MAX_CLAIMS,
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

  const candidatesById = new Map(candidates.map((item) => [item.id, item] as const));
  const seen = new Set<string>();
  const claims: OriginMaterialClaimInput[] = [];

  for (const selection of raw.claims) {
    const claim = selectedClaimInput(selection, candidatesById);
    if (!claim || seen.has(claim.id)) {
      return { ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" };
    }
    seen.add(claim.id);
    claims.push(claim);
  }

  const claimSet = createOriginClaimSet(claims);
  if (!claimSet.ok) {
    return { ok: false, code: "INVALID_EXTRACTED_CLAIMS" };
  }

  return {
    ok: true,
    claimSet: claimSet.value,
  };
}
