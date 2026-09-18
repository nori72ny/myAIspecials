import { describe, expect, it } from "vitest";

import { runOriginAnswerQualityIntegrationHarness } from "./OriginAnswerQualityIntegrationHarness";

const digest = (char: string) => `sha256:${char.repeat(64)}`;

describe("OriginAnswerQualityIntegrationHarness", () => {
  it("releases a basic fast-path answer only when admission and sanitized audit agree", () => {
    const result = runOriginAnswerQualityIntegrationHarness({
      requestId: "origin-int-1",
      answerDigest: digest("a"),
      policy: {
        answerMode: "direct",
        verificationLevel: "basic",
        creativeSpecRequired: false,
        executiveReasoningRequired: false,
      },
      usage: {
        providerExecutions: 1,
        sourceFetches: 0,
        repairActions: 0,
        elapsedMs: 500,
        costUsd: 0,
      },
      claimExtractionCompleted: false,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: false,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: false,
      stages: [
        { stage: "verifier", status: "passed" },
        { stage: "presenter", status: "passed" },
      ],
      createdAt: "2026-09-18T14:10:00.000Z",
    });

    expect(result.admission.admitted).toBe(true);
    expect(result.audit?.blockers).toEqual([]);
    expect(result.release.ok).toBe(true);
  });

  it("blocks research release when source verification or trace is incomplete", () => {
    const result = runOriginAnswerQualityIntegrationHarness({
      requestId: "origin-int-2",
      answerDigest: digest("a"),
      claimSetDigest: digest("b"),
      evidenceLedgerDigest: digest("c"),
      policy: {
        answerMode: "research",
        verificationLevel: "evidence-required",
        creativeSpecRequired: false,
        executiveReasoningRequired: true,
      },
      usage: {
        providerExecutions: 2,
        sourceFetches: 2,
        repairActions: 0,
        elapsedMs: 2_000,
        costUsd: 0,
      },
      claimExtractionCompleted: true,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: false,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: false,
      stages: [
        { stage: "claim-extraction", status: "passed" },
        { stage: "source-verification", status: "blocked" },
        { stage: "trace", status: "blocked" },
      ],
      createdAt: "2026-09-18T14:11:00.000Z",
    });

    expect(result.admission.admitted).toBe(false);
    expect(result.audit?.blockers).toContain("SOURCE_VERIFICATION_INCOMPLETE");
    expect(result.audit?.blockers).toContain("TRACE_PERSISTENCE_INCOMPLETE");
    expect(result.release).toEqual({ ok: false, code: "AQ_RELEASE_NOT_ADMITTED" });
  });

  it("blocks independent-review answers until both coverage and independent review complete", () => {
    const result = runOriginAnswerQualityIntegrationHarness({
      requestId: "origin-int-3",
      answerDigest: digest("a"),
      claimSetDigest: digest("b"),
      evidenceLedgerDigest: digest("c"),
      policy: {
        answerMode: "research",
        verificationLevel: "independent-review-required",
        creativeSpecRequired: false,
        executiveReasoningRequired: true,
      },
      usage: {
        providerExecutions: 3,
        sourceFetches: 2,
        repairActions: 0,
        elapsedMs: 3_000,
        costUsd: 0,
      },
      claimExtractionCompleted: true,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: true,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: true,
      stages: [
        { stage: "claim-extraction", status: "passed" },
        { stage: "claim-coverage-review", status: "blocked" },
        { stage: "source-verification", status: "passed" },
        { stage: "independent-review", status: "blocked" },
        { stage: "trace", status: "passed" },
      ],
      createdAt: "2026-09-18T14:12:00.000Z",
    });

    expect(result.admission.admitted).toBe(false);
    expect(result.release.ok).toBe(false);
  });

  it("fails closed on any non-zero measured cost", () => {
    const result = runOriginAnswerQualityIntegrationHarness({
      requestId: "origin-int-4",
      answerDigest: digest("a"),
      policy: {
        answerMode: "direct",
        verificationLevel: "basic",
        creativeSpecRequired: false,
        executiveReasoningRequired: false,
      },
      usage: {
        providerExecutions: 1,
        sourceFetches: 0,
        repairActions: 0,
        elapsedMs: 500,
        costUsd: 0.01,
      },
      claimExtractionCompleted: false,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: false,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: false,
      stages: [{ stage: "verifier", status: "passed" }],
      createdAt: "2026-09-18T14:13:00.000Z",
    });

    expect(result.admission.admitted).toBe(false);
    expect(result.audit).toBeNull();
    expect(result.release).toEqual({ ok: false, code: "AQ_RELEASE_AUDIT_MISMATCH" });
  });
});
