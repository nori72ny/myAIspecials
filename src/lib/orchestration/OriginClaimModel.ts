import { containsSensitiveInput } from "./SensitiveInputDetector.js";

export type OriginMaterialClaimKind =
  | "factual"
  | "inference"
  | "assumption"
  | "recommendation"
  | "execution-claim";

export type OriginClaimFreshness =
  | "not-applicable"
  | "stable"
  | "current"
  | "real-time";

export type OriginClaimEvidenceRequirement =
  | "none"
  | "user-provided"
  | "supporting-evidence"
  | "deterministic-execution";

export type OriginClaimRisk = "low" | "medium" | "high";

export interface OriginMaterialClaimInput {
  id: string;
  text: string;
  kind: OriginMaterialClaimKind;
  freshness: OriginClaimFreshness;
  evidenceRequirement: OriginClaimEvidenceRequirement;
  risk: OriginClaimRisk;
}

export interface OriginMaterialClaim extends OriginMaterialClaimInput {
  readonly id: string;
  readonly text: string;
}

export interface OriginClaimSet {
  readonly schemaVersion: "origin.claim-set.v1";
  readonly claims: readonly OriginMaterialClaim[];
}

export type OriginClaimSetResult =
  | { ok: true; value: OriginClaimSet }
  | { ok: false; code: "INVALID_CLAIM_SET"; message: string };

const CLAIM_ID = /^claim-[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const MAX_CLAIMS = 64;
const MAX_CLAIM_LENGTH = 2_000;

function validCombination(input: OriginMaterialClaimInput): boolean {
  if (input.kind === "execution-claim") {
    return input.evidenceRequirement === "deterministic-execution"
      && input.freshness !== "not-applicable";
  }

  if (input.kind === "assumption") {
    return input.evidenceRequirement === "none"
      && input.freshness === "not-applicable";
  }

  if (input.kind === "recommendation") {
    return input.evidenceRequirement !== "deterministic-execution";
  }

  if (input.freshness === "current" || input.freshness === "real-time") {
    return input.evidenceRequirement === "supporting-evidence";
  }

  return input.evidenceRequirement !== "deterministic-execution";
}

function normalizeClaim(input: OriginMaterialClaimInput): OriginMaterialClaim | null {
  const text = input.text.trim();
  if (
    !CLAIM_ID.test(input.id)
    || text.length === 0
    || text.length > MAX_CLAIM_LENGTH
    || containsSensitiveInput(text)
    || !validCombination(input)
  ) return null;

  return Object.freeze({ ...input, text });
}

export function createOriginClaimSet(
  inputs: readonly OriginMaterialClaimInput[],
): OriginClaimSetResult {
  if (inputs.length > MAX_CLAIMS) {
    return { ok: false, code: "INVALID_CLAIM_SET", message: "Claim set is invalid." };
  }

  const ids = new Set<string>();
  const claims: OriginMaterialClaim[] = [];

  for (const input of inputs) {
    if (ids.has(input.id)) {
      return { ok: false, code: "INVALID_CLAIM_SET", message: "Claim set is invalid." };
    }
    const claim = normalizeClaim(input);
    if (!claim) {
      return { ok: false, code: "INVALID_CLAIM_SET", message: "Claim set is invalid." };
    }
    ids.add(claim.id);
    claims.push(claim);
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.claim-set.v1",
      claims: Object.freeze([...claims]),
    }),
  };
}
