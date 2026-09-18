import { createHash } from "node:crypto";

import type { OriginClaimSet } from "./OriginClaimModel.js";
import type { OriginEvidenceLedger } from "./OriginEvidenceLedger.js";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);

  return `{${entries.join(",")}}`;
}

export interface OriginAnswerReviewDigests {
  readonly answerDigest: string;
  readonly claimSetDigest: string;
  readonly evidenceLedgerDigest: string;
}

export function createOriginAnswerReviewDigests(
  answerText: string,
  claimSet: OriginClaimSet,
  evidenceLedger: OriginEvidenceLedger,
): OriginAnswerReviewDigests {
  const normalizedAnswer = answerText.replace(/\r\n/g, "\n").trim();

  return Object.freeze({
    answerDigest: sha256(normalizedAnswer),
    claimSetDigest: sha256(canonicalJson(claimSet)),
    evidenceLedgerDigest: sha256(canonicalJson(evidenceLedger)),
  });
}
