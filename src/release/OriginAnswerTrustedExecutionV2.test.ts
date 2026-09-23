// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  qualifyOriginAnswerTrustedExecutionV2,
  type OriginAnswerTrustedExecutionEvidenceV2,
} from "./OriginAnswerTrustedExecutionV2.js";

function evidence(): OriginAnswerTrustedExecutionEvidenceV2 {
  return {
    schemaVersion: "origin.answer-trusted-execution.v2",
    candidateSha: "a".repeat(40),
    corpusDigest: "b".repeat(64),
    executionId: "gh-run:12345678:aq-v2",
    exactCandidateBound: true,
    sameRepoOpenPrHead: true,
    trustedHostControlled: true,
    sealedCorpusNotExposedBeforeRequest: true,
    providerCredentialWithheldFromCandidate: true,
    providerProxyEnforced: true,
    freeOnlyEnforced: true,
    zeroCostVerified: true,
    candidateExternalNetworkBlocked: true,
    candidateArtifactsSanitized: true,
    candidateLogsSanitized: true,
    promptLeakDetected: false,
    secretLeakDetected: false,
    providerRequestCount: 48,
    maxProviderRequests: 48,
    resultDigest: "c".repeat(64),
  };
}

describe("AQ V2 trusted execution evidence", () => {
  it("passes only when the sealed run is exact, isolated, sanitized and $0", () => {
    expect(qualifyOriginAnswerTrustedExecutionV2(
      evidence(),
      "a".repeat(40),
      "b".repeat(64),
    )).toEqual({
      schemaVersion: "origin.answer-trusted-execution-qualification.v2",
      passed: true,
      blockers: [],
    });
  });

  it("fails closed on corpus or credential leakage", () => {
    const row = evidence();
    const report = qualifyOriginAnswerTrustedExecutionV2({
      ...row,
      sealedCorpusNotExposedBeforeRequest: false,
      providerCredentialWithheldFromCandidate: false,
      promptLeakDetected: true,
      secretLeakDetected: true,
    }, row.candidateSha, row.corpusDigest);
    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      "AQ_V2_TRUSTED_EXECUTION_CORPUS_EXPOSURE",
      "AQ_V2_TRUSTED_EXECUTION_SECRET_EXPOSURE",
      "AQ_V2_TRUSTED_EXECUTION_PROMPT_LEAK",
      "AQ_V2_TRUSTED_EXECUTION_SECRET_LEAK",
    ]));
  });

  it("fails closed when provider budget accounting is inconsistent", () => {
    const row = evidence();
    expect(qualifyOriginAnswerTrustedExecutionV2({
      ...row,
      providerRequestCount: 49,
      maxProviderRequests: 48,
    }, row.candidateSha, row.corpusDigest).blockers)
      .toContain("AQ_V2_TRUSTED_EXECUTION_REQUEST_BUDGET_INVALID");
  });
});
