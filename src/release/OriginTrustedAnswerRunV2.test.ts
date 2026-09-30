// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ORIGIN_AQ_V2_FAMILIES } from "./OriginAnswerExperienceV2.js";
import type { OriginTrustedAnswerCaseEvidenceV2 } from "./OriginTrustedAnswerRunV2.js";
import { aggregateOriginTrustedAnswerRunV2 } from "./OriginTrustedAnswerRunV2.js";

const candidateSha = "a".repeat(40);
const corpusDigest = "b".repeat(64);
const roundId = "round-2026-09-23-a";

function cases(): OriginTrustedAnswerCaseEvidenceV2[] {
  return ORIGIN_AQ_V2_FAMILIES.flatMap((family, familyIndex) =>
    Array.from({ length: 3 }, (_, index) => {
      const ordinal = familyIndex * 3 + index;
      const caseId = `aq2-${String(familyIndex + 1).padStart(2, "0")}-${index + 1}`;
      const leaseId = (ordinal.toString(16).padStart(2, "0") + "c".repeat(30)).slice(0, 32);
      const promptDigest = (ordinal.toString(16).padStart(2, "0") + "d".repeat(62)).slice(0, 64);
      const answer = `Answer ${ordinal}`;
      const answerDigest = (ordinal.toString(16).padStart(2, "0") + "e".repeat(62)).slice(0, 64);
      return {
        schemaVersion: "origin.trusted-answer-case-evidence.v2" as const,
        candidateSha,
        corpusDigest,
        roundId,
        ordinal,
        caseId,
        family,
        promptDigest,
        leaseId,
        providerRequests: ordinal % 2,
        costUsd: 0 as const,
        networkBlocked: true as const,
        fullCorpusWithheldFromCandidate: true as const,
        providerCredentialWithheldFromCandidate: true as const,
        gitMetadataWithheldFromCandidate: true as const,
        trustedProxyEnforced: true as const,
        leakDetected: false as const,
        result: {
          schemaVersion: "origin.answer-case-result-trusted.v2" as const,
          leaseId,
          candidateSha,
          roundId,
          caseId,
          family,
          promptDigest,
          answer,
          answerDigest,
          answerLength: answer.length,
          providerRequests: ordinal % 2,
          costUsd: 0 as const,
        },
      };
    }),
  );
}

describe("AQ V2 trusted run aggregation", () => {
  it("requires the complete 48-case exact-bound zero-cost run", () => {
    const report = aggregateOriginTrustedAnswerRunV2(cases(), {
      candidateSha,
      corpusDigest,
      roundId,
      executionId: "gh-run:12345678:aq-v2",
      evaluatorSha: "c".repeat(40),
      sameRepoOpenPrHead: true,
      trustedHostControlled: true,
    });
    expect(report.completedCases).toBe(48);
    expect(report.qualification.passed).toBe(true);
    expect(report.evidence.providerRequestCount).toBe(24);
    expect(report.evidence.maxProviderRequests).toBe(48);
    expect(report.evidence.resultDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.binding.candidateSha).toBe(candidateSha);
    expect(report.binding.corpusDigest).toBe(corpusDigest);
    expect(report.binding.evaluatorSha).toBe("c".repeat(40));
    expect(report.binding.rubricDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.binding.roundId).toBe(roundId);
    expect(Object.values(report.familyCounts).every(count => count === 3)).toBe(true);
    expect(report.scoringBindings).toHaveLength(48);
    expect(report.scoringBindings[0]).toEqual({
      caseId: "aq2-01-1",
      family: ORIGIN_AQ_V2_FAMILIES[0],
      answerDigest: cases()[0].result.answerDigest,
    });
    expect(report.scoringBindings.every(item => /^[a-f0-9]{64}$/.test(item.answerDigest))).toBe(true);
  });

  it("fails closed on missing cases, mixed SHA or duplicated ordinals", () => {
    expect(() => aggregateOriginTrustedAnswerRunV2(cases().slice(0, 47), {
      candidateSha,
      corpusDigest,
      roundId,
      executionId: "gh-run:12345678:aq-v2",
      evaluatorSha: "c".repeat(40),
      sameRepoOpenPrHead: true,
      trustedHostControlled: true,
    })).toThrow("AQ_V2_TRUSTED_RUN_CASE_COUNT_INVALID");

    const mixed = cases();
    mixed[1] = { ...mixed[1], candidateSha: "f".repeat(40) };
    expect(() => aggregateOriginTrustedAnswerRunV2(mixed, {
      candidateSha,
      corpusDigest,
      roundId,
      executionId: "gh-run:12345678:aq-v2",
      evaluatorSha: "c".repeat(40),
      sameRepoOpenPrHead: true,
      trustedHostControlled: true,
    })).toThrow("AQ_V2_TRUSTED_RUN_CASE_INVALID");

    const duplicated = cases();
    duplicated[1] = { ...duplicated[1], ordinal: duplicated[0].ordinal };
    expect(() => aggregateOriginTrustedAnswerRunV2(duplicated, {
      candidateSha,
      corpusDigest,
      roundId,
      executionId: "gh-run:12345678:aq-v2",
      evaluatorSha: "c".repeat(40),
      sameRepoOpenPrHead: true,
      trustedHostControlled: true,
    })).toThrow("AQ_V2_TRUSTED_RUN_CASE_INVALID");
  });

  it("keeps host/PR trust claims fail-closed when the workflow cannot prove them", () => {
    const report = aggregateOriginTrustedAnswerRunV2(cases(), {
      candidateSha,
      corpusDigest,
      roundId,
      executionId: "gh-run:12345678:aq-v2",
      evaluatorSha: "c".repeat(40),
      sameRepoOpenPrHead: false,
      trustedHostControlled: false,
    });
    expect(report.qualification.passed).toBe(false);
    expect(report.qualification.blockers).toEqual(expect.arrayContaining([
      "AQ_V2_TRUSTED_EXECUTION_PR_BINDING_INVALID",
      "AQ_V2_TRUSTED_EXECUTION_HOST_NOT_TRUSTED",
    ]));
  });
});
