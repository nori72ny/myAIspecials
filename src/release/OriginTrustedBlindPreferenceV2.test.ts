// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ORIGIN_AQ_V2_BLIND_CRITERIA,
  type OriginBlindPreferenceVoteV2,
} from "./OriginAnswerBlindPreferenceV2.js";
import { ORIGIN_AQ_V2_FAMILIES } from "./OriginAnswerExperienceV2.js";
import { digestOriginAnswerExperienceRubricV2 } from "./OriginAnswerExperienceRubricV2.js";
import type { OriginTrustedAnswerRunAggregateV2 } from "./OriginTrustedAnswerRunV2.js";
import {
  digestOriginTrustedBlindPairV2,
  qualifyOriginTrustedBlindPreferenceV2,
  type OriginTrustedBlindPreferenceBundleV2,
  type OriginTrustedBlindReferenceV2,
  type OriginTrustedBlindVoteV2,
} from "./OriginTrustedBlindPreferenceV2.js";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const CANDIDATE_SHA = "a".repeat(40);
const CORPUS_DIGEST = "b".repeat(64);
const RESULT_DIGEST = "c".repeat(64);
const ROUND_ID = "aq-v2-round-2026-10-01";
const RUBRIC_DIGEST = digestOriginAnswerExperienceRubricV2();

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function caseRows() {
  return ORIGIN_AQ_V2_FAMILIES.flatMap((family, familyIndex) =>
    Array.from({ length: 3 }, (_, offset) => {
      const ordinal = familyIndex * 3 + offset;
      return {
        caseId: `aq2-${String(ordinal + 1).padStart(2, "0")}`,
        family,
        answerDigest: digest(`origin-answer-${ordinal}`),
      };
    }),
  );
}

function run(): OriginTrustedAnswerRunAggregateV2 {
  return {
    schemaVersion: "origin.trusted-answer-run-aggregate.v2",
    evidence: {
      candidateSha: CANDIDATE_SHA,
      corpusDigest: CORPUS_DIGEST,
      resultDigest: RESULT_DIGEST,
    },
    qualification: { passed: true },
    binding: {
      schemaVersion: "origin.answer-evaluation-binding.v2",
      candidateSha: CANDIDATE_SHA,
      corpusDigest: CORPUS_DIGEST,
      evaluatorSha: "d".repeat(40),
      rubricDigest: RUBRIC_DIGEST,
      roundId: ROUND_ID,
    },
    completedCases: 48,
    familyCounts: {},
    scoringBindings: caseRows(),
  } as unknown as OriginTrustedAnswerRunAggregateV2;
}

function reference(opponentId: string): OriginTrustedBlindReferenceV2 {
  return {
    source: "controlled-external",
    opponentId,
    independentFromCandidate: true,
    evidenceId: `evidence:${opponentId}:2026-10-01`,
    artifactDigest: `sha256:${digest(`artifact-${opponentId}`)}`,
    createdAt: "2026-09-30T00:00:00.000Z",
    expiresAt: "2026-10-15T00:00:00.000Z",
    answers: caseRows().map(row => ({
      caseId: row.caseId,
      answerDigest: digest(`${opponentId}:${row.caseId}`),
    })),
  };
}

function vote(
  row: ReturnType<typeof caseRows>[number],
  referenceRow: OriginTrustedBlindReferenceV2,
  judgeId: string,
): OriginTrustedBlindVoteV2 {
  const referenceAnswerDigest = referenceRow.answers.find(answer => answer.caseId === row.caseId)!.answerDigest;
  const criteria = Object.fromEntries(
    ORIGIN_AQ_V2_BLIND_CRITERIA.map(key => [key, 1]),
  ) as OriginBlindPreferenceVoteV2["criteria"];
  const base = {
    caseId: row.caseId,
    family: row.family,
    opponentId: referenceRow.opponentId,
    judgeId,
    overall: 1 as const,
    criteria,
    candidateAnswerDigest: row.answerDigest,
    referenceAnswerDigest,
  };
  return {
    ...base,
    pairDigest: digestOriginTrustedBlindPairV2(base),
  };
}

function bundle(): OriginTrustedBlindPreferenceBundleV2 {
  const references = [reference("reference-a"), reference("reference-b"), reference("reference-c")];
  const judges = ["judge-a", "judge-b"].map(judgeId => ({
    source: "controlled-external" as const,
    judgeId,
    independentFromCandidate: true as const,
    blindToSourceIdentity: true as const,
    evidenceId: `evidence:${judgeId}:2026-10-01`,
    artifactDigest: `sha256:${digest(`artifact-${judgeId}`)}`,
    createdAt: "2026-09-30T00:00:00.000Z",
    expiresAt: "2026-10-15T00:00:00.000Z",
  }));
  const votes = caseRows().flatMap(row =>
    references.flatMap(ref => judges.map(judge => vote(row, ref, judge.judgeId))),
  );
  return {
    schemaVersion: "origin.trusted-answer-blind-preference-bundle.v2",
    candidateSha: CANDIDATE_SHA,
    corpusDigest: CORPUS_DIGEST,
    roundId: ROUND_ID,
    resultDigest: RESULT_DIGEST,
    rubricDigest: RUBRIC_DIGEST,
    references,
    judges,
    votes,
  };
}

describe("trusted AQ V2 blind preference evidence", () => {
  it("passes only when 48 exact candidate answers, 3 references and 2 blind judges form a complete matrix", () => {
    const report = qualifyOriginTrustedBlindPreferenceV2(run(), bundle(), NOW);
    expect(report.passed).toBe(true);
    expect(report.identityBound).toBe(true);
    expect(report.referenceEvidenceBound).toBe(true);
    expect(report.judgeEvidenceBound).toBe(true);
    expect(report.answerBindingsBound).toBe(true);
    expect(report.competitiveEvidencePassed).toBe(true);
    expect(report.blindReport?.voteCount).toBe(48 * 3 * 2);
    expect(report.blockers).toEqual([]);
  });

  it("fails when a vote is rebound to a different ORIGIN answer digest", () => {
    const value = bundle();
    const votes = [...value.votes];
    votes[0] = {
      ...votes[0],
      candidateAnswerDigest: digest("substituted-origin-answer"),
    };
    const report = qualifyOriginTrustedBlindPreferenceV2(run(), { ...value, votes }, NOW);
    expect(report.passed).toBe(false);
    expect(report.answerBindingsBound).toBe(false);
    expect(report.blockers).toContain("AQ_V2_TRUSTED_BLIND_ANSWER_BINDING_MISMATCH");
  });

  it("fails when a reference omits one exact case answer", () => {
    const value = bundle();
    const references = [...value.references];
    references[0] = { ...references[0], answers: references[0].answers.slice(1) };
    const report = qualifyOriginTrustedBlindPreferenceV2(run(), { ...value, references }, NOW);
    expect(report.passed).toBe(false);
    expect(report.referenceEvidenceBound).toBe(false);
    expect(report.blockers).toContain("AQ_V2_TRUSTED_BLIND_REFERENCE_ANSWERS_INVALID");
  });

  it("fails when a judge is expired or was not blind to source identity", () => {
    const value = bundle();
    const judges = [...value.judges];
    judges[0] = {
      ...judges[0],
      blindToSourceIdentity: false as true,
      expiresAt: "2026-09-30T12:00:00.000Z",
    };
    const report = qualifyOriginTrustedBlindPreferenceV2(run(), { ...value, judges }, NOW);
    expect(report.passed).toBe(false);
    expect(report.judgeEvidenceBound).toBe(false);
    expect(report.blockers).toContain("AQ_V2_TRUSTED_BLIND_JUDGE_EVIDENCE_INVALID");
  });

  it("fails when the bundle belongs to another exact candidate SHA", () => {
    const value = bundle();
    const report = qualifyOriginTrustedBlindPreferenceV2(
      run(),
      { ...value, candidateSha: "f".repeat(40) },
      NOW,
    );
    expect(report.passed).toBe(false);
    expect(report.identityBound).toBe(false);
    expect(report.blockers).toContain("AQ_V2_TRUSTED_BLIND_IDENTITY_MISMATCH");
  });
});
