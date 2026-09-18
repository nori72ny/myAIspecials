import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope.js";
import { createOriginClaimSet, type OriginClaimFreshness, type OriginClaimSet } from "./OriginClaimModel.js";
import { createOriginEvidenceLedger, type OriginEvidenceLedger } from "./OriginEvidenceLedger.js";

export interface OriginAnswerEvidenceProjection {
  readonly claims: OriginClaimSet;
  readonly ledger: OriginEvidenceLedger;
}

export type OriginAnswerEvidenceProjectionResult =
  | { ok: true; value: OriginAnswerEvidenceProjection }
  | { ok: false; code: "INVALID_ANSWER_EVIDENCE_PROJECTION"; message: string };

export function projectOriginAnswerEvidence(
  evidence: readonly OriginAnswerEvidenceItem[],
  observedAt: string,
  freshness: OriginClaimFreshness,
): OriginAnswerEvidenceProjectionResult {
  const claims = evidence.flatMap((item, index) => {
    if (!item.claim) return [];
    return [{
      id: `claim-evidence-${index + 1}`,
      text: item.claim,
      kind: "factual" as const,
      freshness,
      evidenceRequirement: "supporting-evidence" as const,
      risk: "medium" as const,
    }];
  });

  const claimSet = createOriginClaimSet(claims);
  if (!claimSet.ok) {
    return {
      ok: false,
      code: "INVALID_ANSWER_EVIDENCE_PROJECTION",
      message: claimSet.message,
    };
  }

  const ledgerEntries = evidence.map((item, index) => {
    const claimId = item.claim ? `claim-evidence-${index + 1}` : undefined;
    const independentlyChecked = item.evidenceLevel === "source-checked"
      && item.checks.content === "passed"
      && item.checks.claimSupport === "passed";

    return {
      id: `ev-answer-${index + 1}`,
      sourceKind: independentlyChecked ? "retrieved-public" as const : "provider-output" as const,
      observedAt,
      label: item.label,
      sourceUrl: item.sourceUrl,
      sourceRef: independentlyChecked ? `answer-source-${index + 1}` : `provider-citation-${index + 1}`,
      claimIds: claimId ? [claimId] : [],
      verificationState: independentlyChecked ? "claim-supported" as const : "unverified" as const,
      costUsd: 0,
      detail: independentlyChecked
        ? "Source content and claim support were checked."
        : "Citation was present in provider output but was not independently verified.",
    };
  });

  const ledger = createOriginEvidenceLedger(ledgerEntries);
  if (!ledger.ok) {
    return {
      ok: false,
      code: "INVALID_ANSWER_EVIDENCE_PROJECTION",
      message: ledger.message,
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      claims: claimSet.value,
      ledger: ledger.value,
    }),
  };
}
