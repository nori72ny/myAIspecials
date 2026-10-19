import type { OriginAnswerQualityAdmissionDecision } from "./OriginAnswerQualityAdmissionController.js";
import type { OriginAnswerQualityAuditRecord } from "./OriginAnswerQualityAuditRecord.js";

export interface OriginAnswerQualityReleaseDecisionRecord {
  readonly schemaVersion: "origin.aq-release-decision.v1";
  readonly requestId: string;
  readonly answerDigest: string;
  readonly admitted: true;
  readonly verifiedRelease: true;
  readonly costUsd: 0;
  readonly createdAt: string;
}

export type OriginAnswerQualityReleaseDecisionResult =
  | { ok: true; value: OriginAnswerQualityReleaseDecisionRecord }
  | {
      ok: false;
      code:
        | "AQ_RELEASE_NOT_ADMITTED"
        | "AQ_RELEASE_AUDIT_MISMATCH"
        | "AQ_RELEASE_AUDIT_BLOCKED"
        | "AQ_RELEASE_COST_UNVERIFIED";
    };

const DIGEST = /^sha256:[a-f0-9]{64}$/;

export function createOriginAnswerQualityReleaseDecision(
  admission: OriginAnswerQualityAdmissionDecision,
  audit: OriginAnswerQualityAuditRecord,
): OriginAnswerQualityReleaseDecisionResult {
  if (!admission.admitted) {
    return { ok: false, code: "AQ_RELEASE_NOT_ADMITTED" };
  }

  if (
    !audit.answerDigest
    || !DIGEST.test(audit.answerDigest)
    || audit.requestId.length === 0
  ) {
    return { ok: false, code: "AQ_RELEASE_AUDIT_MISMATCH" };
  }

  if (audit.blockers.length > 0) {
    return { ok: false, code: "AQ_RELEASE_AUDIT_BLOCKED" };
  }

  if (
    audit.costUsd !== 0
    || !admission.budget.ok
    || admission.readiness.blockers.includes("NON_ZERO_COST")
  ) {
    return { ok: false, code: "AQ_RELEASE_COST_UNVERIFIED" };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-release-decision.v1",
      requestId: audit.requestId,
      answerDigest: audit.answerDigest,
      admitted: true,
      verifiedRelease: true,
      costUsd: 0,
      createdAt: audit.createdAt,
    }),
  };
}
