import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityReleaseDecision } from "./OriginAnswerQualityReleaseDecision";
import type { OriginAnswerQualityAdmissionDecision } from "./OriginAnswerQualityAdmissionController";
import type { OriginAnswerQualityAuditRecord } from "./OriginAnswerQualityAuditRecord";

const admission: OriginAnswerQualityAdmissionDecision = {
  schemaVersion: "origin.aq-admission.v1",
  admitted: true,
  requirements: {
    claimExtractionRequired: true,
    claimCoverageReviewRequired: false,
    sourceVerificationRequired: true,
    independentReviewRequired: false,
    tracePersistenceRequired: true,
  },
  readiness: {
    schemaVersion: "origin.aq-readiness.v1",
    ready: true,
    blockers: [],
  },
  budget: { ok: true },
};

const audit: OriginAnswerQualityAuditRecord = {
  schemaVersion: "origin.aq-audit.v1",
  requestId: "origin-request-1",
  answerDigest: `sha256:${"a".repeat(64)}`,
  claimSetDigest: `sha256:${"b".repeat(64)}`,
  evidenceLedgerDigest: `sha256:${"c".repeat(64)}`,
  stages: [
    { stage: "claim-extraction", status: "passed" },
    { stage: "source-verification", status: "passed" },
    { stage: "verifier", status: "passed" },
    { stage: "trace", status: "passed" },
  ],
  blockers: [],
  providerExecutions: 2,
  sourceFetches: 3,
  repairActions: 0,
  elapsedMs: 2_500,
  costUsd: 0,
  createdAt: "2026-09-18T13:00:00.000Z",
};

describe("OriginAnswerQualityReleaseDecision", () => {
  it("creates a verified release record only after admission and clean audit", () => {
    const result = createOriginAnswerQualityReleaseDecision(admission, audit);

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: "origin.aq-release-decision.v1",
        requestId: "origin-request-1",
        answerDigest: `sha256:${"a".repeat(64)}`,
        admitted: true,
        verifiedRelease: true,
        costUsd: 0,
        createdAt: "2026-09-18T13:00:00.000Z",
      },
    });
  });

  it("refuses release when admission failed", () => {
    expect(createOriginAnswerQualityReleaseDecision(
      { ...admission, admitted: false },
      audit,
    )).toEqual({ ok: false, code: "AQ_RELEASE_NOT_ADMITTED" });
  });

  it("refuses release when the audit contains blockers", () => {
    expect(createOriginAnswerQualityReleaseDecision(
      admission,
      { ...audit, blockers: ["SOURCE_VERIFICATION_INCOMPLETE"] },
    )).toEqual({ ok: false, code: "AQ_RELEASE_AUDIT_BLOCKED" });
  });

  it("refuses release without a valid answer digest or zero-cost proof", () => {
    expect(createOriginAnswerQualityReleaseDecision(
      admission,
      { ...audit, answerDigest: "bad-digest" },
    )).toEqual({ ok: false, code: "AQ_RELEASE_AUDIT_MISMATCH" });

    expect(createOriginAnswerQualityReleaseDecision(
      admission,
      { ...audit, costUsd: 0.01 as 0 },
    )).toEqual({ ok: false, code: "AQ_RELEASE_COST_UNVERIFIED" });
  });
});
