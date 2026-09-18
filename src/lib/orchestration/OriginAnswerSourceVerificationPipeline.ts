import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope.js";
import {
  executeOriginSourceVerification,
  type OriginSourceVerificationExecutor,
} from "./OriginSourceVerification.js";

export interface OriginAnswerSourceVerificationSummary {
  readonly evidence: readonly OriginAnswerEvidenceItem[];
  readonly attempted: number;
  readonly verified: number;
  readonly failed: number;
}

export async function verifyOriginAnswerSources(
  evidence: readonly OriginAnswerEvidenceItem[],
  executor: OriginSourceVerificationExecutor | undefined,
  nowMs = Date.now(),
): Promise<OriginAnswerSourceVerificationSummary> {
  const next: OriginAnswerEvidenceItem[] = [];
  let attempted = 0;
  let verified = 0;
  let failed = 0;

  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];

    if (
      item.evidenceLevel !== "provided"
      || item.claimBinding !== "explicit-inline-citation"
      || !item.claim
      || !item.sourceUrl
    ) {
      next.push(item);
      continue;
    }

    attempted += 1;
    const result = await executeOriginSourceVerification(
      {
        verificationId: `answer-source-${index + 1}`,
        evidence: item,
      },
      executor,
      nowMs,
    );

    if (result.ok) {
      verified += 1;
      next.push(result.evidence);
    } else {
      failed += 1;
      next.push(item);
    }
  }

  return Object.freeze({
    evidence: Object.freeze([...next]),
    attempted,
    verified,
    failed,
  });
}
