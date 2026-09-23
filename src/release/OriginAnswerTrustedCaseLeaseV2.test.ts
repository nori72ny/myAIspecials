// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ORIGIN_AQ_V2_FAMILIES } from "./OriginAnswerExperienceV2.js";
import {
  ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
  prepareOriginAnswerExperienceSealedCorpusV2,
} from "./OriginAnswerExperienceSealedCorpusV2.js";
import {
  assertOriginAnswerCaseLeaseIsolationV2,
  buildOriginAnswerCaseResultTrustedV2,
  leaseOriginAnswerExperienceCaseV2,
} from "./OriginAnswerTrustedCaseLeaseV2.js";

function prepared() {
  return prepareOriginAnswerExperienceSealedCorpusV2({
    schemaVersion: ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
    corpusId: "aq-v2-lease-test",
    cases: ORIGIN_AQ_V2_FAMILIES.flatMap((family, familyIndex) =>
      Array.from({ length: 3 }, (_, index) => ({
        caseId: `aq2-${String(familyIndex + 1).padStart(2, "0")}-${index + 1}`,
        family,
        prompt: `PRIVATE PROMPT ${familyIndex + 1}-${index + 1}`,
        evaluatorNotes: `PRIVATE NOTES ${familyIndex + 1}-${index + 1}`,
      })),
    ),
  });
}

describe("AQ V2 trusted one-case leasing", () => {
  it("exposes only opaque lease id + one prompt to candidate", () => {
    const corpus = prepared();
    const leased = leaseOriginAnswerExperienceCaseV2(corpus, {
      candidateSha: "a".repeat(40),
      roundId: "round-1",
      ordinal: 7,
    });

    expect(leased.candidateLease.prompt).toBe("PRIVATE PROMPT 3-2");
    expect(Object.keys(leased.candidateLease).sort()).toEqual(["leaseId", "prompt", "schemaVersion"]);
    const candidateJson = JSON.stringify(leased.candidateLease);
    expect(candidateJson).not.toContain("PRIVATE NOTES");
    expect(candidateJson).not.toContain(corpus.corpusDigest);
    expect(candidateJson).not.toContain(leased.trustedLease.caseId);
    expect(candidateJson).not.toContain(leased.trustedLease.family);
    expect(candidateJson).not.toContain(leased.trustedLease.candidateSha);
    expect(candidateJson).not.toContain('"ordinal"');
    expect(candidateJson).not.toContain('"totalCases"');
    expect(candidateJson).not.toContain('"evaluatorNotes"');
    expect(leased.trustedLease.evaluatorNotes).toBe("PRIVATE NOTES 3-2");
    expect(() => assertOriginAnswerCaseLeaseIsolationV2({
      ...leased,
      fullCorpusSerialized: JSON.stringify(corpus.privateCorpus),
    })).not.toThrow();
  });

  it("binds a result to the exact trusted lease and enforces zero cost", () => {
    const leased = leaseOriginAnswerExperienceCaseV2(prepared(), {
      candidateSha: "a".repeat(40),
      roundId: "round-1",
      ordinal: 0,
    });
    const result = buildOriginAnswerCaseResultTrustedV2({
      ...leased,
      answer: "A grounded answer.",
      providerRequests: 1,
      costUsd: 0,
    });
    expect(result.caseId).toBe(leased.trustedLease.caseId);
    expect(result.family).toBe(leased.trustedLease.family);
    expect(result.candidateSha).toBe("a".repeat(40));
    expect(result.answerDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.costUsd).toBe(0);
  });

  it("rejects mismatched lease ids, paid use or excessive provider use", () => {
    const leased = leaseOriginAnswerExperienceCaseV2(prepared(), {
      candidateSha: "a".repeat(40),
      roundId: "round-1",
      ordinal: 0,
    });
    expect(() => buildOriginAnswerCaseResultTrustedV2({
      candidateLease: leased.candidateLease,
      trustedLease: { ...leased.trustedLease, leaseId: "f".repeat(32) },
      answer: "Answer",
      providerRequests: 1,
      costUsd: 0,
    })).toThrow("AQ_V2_CASE_RESULT_INVALID");
    expect(() => buildOriginAnswerCaseResultTrustedV2({
      ...leased,
      answer: "Answer",
      providerRequests: 5,
      costUsd: 0,
    })).toThrow("AQ_V2_CASE_RESULT_INVALID");
    expect(() => buildOriginAnswerCaseResultTrustedV2({
      ...leased,
      answer: "Answer",
      providerRequests: 1,
      costUsd: 0.01,
    })).toThrow("AQ_V2_CASE_RESULT_INVALID");
  });
});
