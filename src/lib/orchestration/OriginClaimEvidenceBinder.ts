import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope.js";
import type { OriginClaimSet } from "./OriginClaimModel.js";
import {
  createOriginEvidenceLedger,
  type OriginEvidenceLedger,
} from "./OriginEvidenceLedger.js";

export type OriginClaimEvidenceBindingResult =
  | { ok: true; ledger: OriginEvidenceLedger }
  | { ok: false; code: "INVALID_CLAIM_EVIDENCE_BINDING" };

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function bindOriginAnswerEvidenceToClaims(
  claimSet: OriginClaimSet,
  evidence: readonly OriginAnswerEvidenceItem[],
  observedAt: string,
): OriginClaimEvidenceBindingResult {
  const claimsByText = new Map<string, string[]>();

  for (const claim of claimSet.claims) {
    const key = normalizeText(claim.text);
    const ids = claimsByText.get(key) ?? [];
    ids.push(claim.id);
    claimsByText.set(key, ids);
  }

  const entries = evidence.map((item, index) => {
    const normalizedClaim = item.claim ? normalizeText(item.claim) : undefined;
    const matchingIds = normalizedClaim ? claimsByText.get(normalizedClaim) ?? [] : [];
    const uniquelyBoundClaimId = matchingIds.length === 1 ? matchingIds[0] : undefined;

    const independentlyChecked =
      item.evidenceLevel === "source-checked"
      && item.checks.content === "passed"
      && item.checks.claimSupport === "passed";

    return {
      id: `ev-bound-${index + 1}`,
      sourceKind: independentlyChecked ? "retrieved-public" as const : "provider-output" as const,
      observedAt,
      label: item.label,
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      sourceRef: independentlyChecked
        ? `bound-source-${index + 1}`
        : `provider-citation-${index + 1}`,
      claimIds: uniquelyBoundClaimId ? [uniquelyBoundClaimId] : [],
      verificationState:
        independentlyChecked && uniquelyBoundClaimId
          ? "claim-supported" as const
          : independentlyChecked
            ? "source-checked" as const
            : "unverified" as const,
      costUsd: 0,
      detail:
        independentlyChecked && uniquelyBoundClaimId
          ? "Source and claim support were checked and bound to one material claim."
          : independentlyChecked
            ? "Source was checked but could not be uniquely bound to one material claim."
            : "Provider-presented citation remains unverified.",
    };
  });

  const ledger = createOriginEvidenceLedger(entries);
  if (!ledger.ok) {
    return { ok: false, code: "INVALID_CLAIM_EVIDENCE_BINDING" };
  }

  return {
    ok: true,
    ledger: ledger.value,
  };
}
