import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope.js";
import { bindOriginAnswerEvidenceToClaims } from "./OriginClaimEvidenceBinder.js";
import {
  extractOriginMaterialClaims,
  type OriginMaterialClaimExtractor,
} from "./OriginMaterialClaimExtractor.js";
import {
  verifyOriginAnswerEvidence,
  type OriginVerificationResult,
  type OriginVerifierPolicy,
} from "./OriginVerifier.js";

export type OriginAnswerVerificationPreparationResult =
  | {
      ok: true;
      claimCount: number;
      evidenceCount: number;
      verification: OriginVerificationResult;
    }
  | {
      ok: false;
      code:
        | "CLAIM_EXTRACTION_FAILED"
        | "CLAIM_EVIDENCE_BINDING_FAILED";
    };

export async function prepareAndVerifyOriginAnswer(
  answerText: string,
  evidence: readonly OriginAnswerEvidenceItem[],
  observedAt: string,
  extractor: OriginMaterialClaimExtractor | undefined,
  policy: OriginVerifierPolicy,
): Promise<OriginAnswerVerificationPreparationResult> {
  const extracted = await extractOriginMaterialClaims(answerText, extractor);
  if (!extracted.ok) {
    return { ok: false, code: "CLAIM_EXTRACTION_FAILED" };
  }

  const bound = bindOriginAnswerEvidenceToClaims(
    extracted.claimSet,
    evidence,
    observedAt,
  );
  if (!bound.ok) {
    return { ok: false, code: "CLAIM_EVIDENCE_BINDING_FAILED" };
  }

  const verification = verifyOriginAnswerEvidence(
    extracted.claimSet,
    bound.ledger,
    policy,
  );

  return Object.freeze({
    ok: true,
    claimCount: extracted.claimSet.claims.length,
    evidenceCount: bound.ledger.entries.length,
    verification,
  });
}
