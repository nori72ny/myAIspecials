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
  it("exposes only one prompt and keeps evaluator notes/full corpus trusted", () => {
    const corpus = prepared();
    const leased = leaseOriginAnswerExperienceCaseV2(corpus, {
      candidateSha: "a".repeat(40),
      roundId: "round-1",
      ordinal: 7,
    });

    expect(leased.publicLease.prompt).toBe("PRIVATE PROMPT 3-2");
    expect(JSON.stringify(leased.publicLease)).not.toContain("PRIVATE NOTES");
    expect(JSON.stringify(leased.publicLease)).not.toContain(corpus.corpusDigest);
    expect(leased.trustedLease.evaluatorNotes).toBe("PRIVATE NOTES 3-2");
    expect(() => assertOriginAnswerCaseLeaseIsolationV2({
      ...leased,
      fullCorpusSerialized: JSON.stringify(corpus.privateCorpus),
    })).not.toThrow();
  });

  it("binds a result to the exact lease and enforces zero cost", () => {
    const leased = leaseOriginAnswerExperienceCaseV2(prepared(), {
      candidateSha: "a".repeat(40),
      roundId: "round-1",
      ordinal: 0,
    });
    const result = buildOriginAnswerCaseResultTrustedV2({
      publicLease: leased.publicLease,
      answer: "A grounded answer.",
      providerRequests: 1,
      costUsd: 0,
    });
    expect(result.caseId).toBe(leased.publicLease.caseId);
    expect(result.answerDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.costUsd).toBe(0);
  });

  it("rejects paid or excessive provider use", () => {
    const leased = leaseOriginAnswerExperienceCaseV2(prepared(), {
      candidateSha: "a".repeat(40),
      roundId: "round-1",
      ordinal: 0,
    });
    expect(() => buildOriginAnswerCaseResultTrustedV2({
      publicLease: leased.publicLease,
      answer: "Answer",
      providerRequests: 5,
      costUsd: 0,
    })).toThrow("AQ_V2_CASE_RESULT_INVALID");
    expect(() => buildOriginAnswerCaseResultTrustedV2({
      publicLease: leased.publicLease,
      answer: "Answer",
      providerRequests: 1,
      costUsd: 0.01,
    })).toThrow("AQ_V2_CASE_RESULT_INVALID");
  });
});
