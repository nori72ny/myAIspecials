import type { OriginClaimSet, OriginMaterialClaim } from "./OriginClaimModel.js";
import type { OriginEvidenceLedger, OriginEvidenceLedgerEntry } from "./OriginEvidenceLedger.js";

export type OriginVerificationDecision = "PASS" | "REPAIR_REQUIRED" | "BLOCKED_UNVERIFIED";

export type OriginVerificationIssueCode =
  | "MISSING_EVIDENCE"
  | "INSUFFICIENT_EVIDENCE_STATE"
  | "STALE_EVIDENCE"
  | "EXECUTION_EVIDENCE_REQUIRED"
  | "USER_EVIDENCE_REQUIRED"
  | "INDEPENDENT_REVIEW_REQUIRED";

export interface OriginVerificationIssue {
  readonly claimId?: string;
  readonly code: OriginVerificationIssueCode;
  readonly repairable: boolean;
}

export interface OriginVerifierPolicy {
  readonly independentReviewRequired: boolean;
  readonly independentReviewPerformed: boolean;
  readonly currentEvidenceCutoffMs?: number;
  readonly realTimeEvidenceCutoffMs?: number;
}

export interface OriginVerificationResult {
  readonly schemaVersion: "origin.verification.v1";
  readonly decision: OriginVerificationDecision;
  readonly issues: readonly OriginVerificationIssue[];
  readonly verifiedClaimIds: readonly string[];
}

const SUPPORT_STATES = new Set(["claim-supported", "verified"]);
const EXECUTION_KINDS = new Set(["deterministic-tool", "code-check"]);

function entriesForClaim(
  ledger: OriginEvidenceLedger,
  claimId: string,
): readonly OriginEvidenceLedgerEntry[] {
  return ledger.entries.filter((entry) => entry.claimIds.includes(claimId));
}

function isFreshEnough(
  claim: OriginMaterialClaim,
  entry: OriginEvidenceLedgerEntry,
  policy: OriginVerifierPolicy,
): boolean {
  if (claim.freshness === "not-applicable" || claim.freshness === "stable") return true;
  const observedMs = Date.parse(entry.observedAt);
  if (!Number.isFinite(observedMs)) return false;

  const cutoff = claim.freshness === "real-time"
    ? policy.realTimeEvidenceCutoffMs
    : policy.currentEvidenceCutoffMs;

  return cutoff !== undefined && observedMs >= cutoff;
}

function verifyClaim(
  claim: OriginMaterialClaim,
  entries: readonly OriginEvidenceLedgerEntry[],
  policy: OriginVerifierPolicy,
): OriginVerificationIssue | null {
  if (claim.evidenceRequirement === "none") return null;

  if (entries.length === 0) {
    return {
      claimId: claim.id,
      code: "MISSING_EVIDENCE",
      repairable: true,
    };
  }

  if (claim.evidenceRequirement === "user-provided") {
    return entries.some((entry) => entry.sourceKind === "user-provided")
      ? null
      : { claimId: claim.id, code: "USER_EVIDENCE_REQUIRED", repairable: true };
  }

  if (claim.evidenceRequirement === "deterministic-execution") {
    const verifiedExecution = entries.some((entry) =>
      EXECUTION_KINDS.has(entry.sourceKind)
      && entry.verificationState === "verified"
      && isFreshEnough(claim, entry, policy)
    );
    if (verifiedExecution) return null;

    const hasExecutionEvidence = entries.some((entry) => EXECUTION_KINDS.has(entry.sourceKind));
    return {
      claimId: claim.id,
      code: hasExecutionEvidence ? "INSUFFICIENT_EVIDENCE_STATE" : "EXECUTION_EVIDENCE_REQUIRED",
      repairable: true,
    };
  }

  const supported = entries.filter((entry) => SUPPORT_STATES.has(entry.verificationState));
  if (supported.length === 0) {
    return {
      claimId: claim.id,
      code: "INSUFFICIENT_EVIDENCE_STATE",
      repairable: true,
    };
  }

  if (!supported.some((entry) => isFreshEnough(claim, entry, policy))) {
    return {
      claimId: claim.id,
      code: "STALE_EVIDENCE",
      repairable: true,
    };
  }

  return null;
}

export function verifyOriginAnswerEvidence(
  claims: OriginClaimSet,
  ledger: OriginEvidenceLedger,
  policy: OriginVerifierPolicy,
): OriginVerificationResult {
  const issues: OriginVerificationIssue[] = [];
  const verifiedClaimIds: string[] = [];

  for (const claim of claims.claims) {
    const issue = verifyClaim(claim, entriesForClaim(ledger, claim.id), policy);
    if (issue) issues.push(issue);
    else verifiedClaimIds.push(claim.id);
  }

  if (policy.independentReviewRequired && !policy.independentReviewPerformed) {
    issues.push({
      code: "INDEPENDENT_REVIEW_REQUIRED",
      repairable: false,
    });
  }

  const hasBlockingIssue = issues.some((issue) => !issue.repairable);
  const decision: OriginVerificationDecision = hasBlockingIssue
    ? "BLOCKED_UNVERIFIED"
    : issues.length > 0
      ? "REPAIR_REQUIRED"
      : "PASS";

  return Object.freeze({
    schemaVersion: "origin.verification.v1",
    decision,
    issues: Object.freeze([...issues]),
    verifiedClaimIds: Object.freeze([...verifiedClaimIds]),
  });
}
