import type { OriginClaimSet } from "./OriginClaimModel.js";
import type { OriginEvidenceLedger, OriginEvidenceLedgerEntry } from "./OriginEvidenceLedger.js";

export type OriginClaimSupportViewState =
  | "supported"
  | "partial"
  | "unverified"
  | "conflicting";

export interface OriginClaimEvidenceView {
  readonly claimId: string;
  readonly claimText: string;
  readonly state: OriginClaimSupportViewState;
  readonly evidenceIds: readonly string[];
  readonly sourceLabels: readonly string[];
}

function classify(entries: readonly OriginEvidenceLedgerEntry[]): OriginClaimSupportViewState {
  if (entries.length === 0) return "unverified";
  const states = new Set(entries.map((entry) => entry.verificationState));
  if (states.has("unverified") && (states.has("claim-supported") || states.has("verified"))) {
    return "partial";
  }
  if (states.has("verified") || states.has("claim-supported")) return "supported";
  if (states.has("source-checked")) return "partial";
  return "unverified";
}

export function createOriginClaimEvidenceMapView(
  claimSet: OriginClaimSet,
  ledger: OriginEvidenceLedger,
  conflictingClaimIds: readonly string[] = [],
): readonly OriginClaimEvidenceView[] {
  const conflicts = new Set(conflictingClaimIds);

  return Object.freeze(claimSet.claims.map((claim) => {
    const entries = ledger.entries.filter((entry) => entry.claimIds.includes(claim.id));
    const state = conflicts.has(claim.id) ? "conflicting" : classify(entries);

    return Object.freeze({
      claimId: claim.id,
      claimText: claim.text,
      state,
      evidenceIds: Object.freeze(entries.map((entry) => entry.id)),
      sourceLabels: Object.freeze(entries.map((entry) => entry.label)),
    });
  }));
}
