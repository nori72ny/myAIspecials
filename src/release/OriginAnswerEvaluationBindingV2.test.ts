// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  qualifyOriginAnswerEvaluationBindingsV2,
  type OriginAnswerEvaluationBindingV2,
} from "./OriginAnswerEvaluationBindingV2.js";

function binding(): OriginAnswerEvaluationBindingV2 {
  return {
    schemaVersion: "origin.answer-evaluation-binding.v2",
    candidateSha: "a".repeat(40),
    corpusDigest: "b".repeat(64),
    evaluatorSha: "c".repeat(40),
    rubricDigest: "d".repeat(64),
    roundId: "round-2026-09-23-a",
  };
}

describe("AQ V2 evidence bindings", () => {
  it("requires every evidence family to bind to the same candidate/corpus/evaluator/rubric/round", () => {
    const row = binding();
    const report = qualifyOriginAnswerEvaluationBindingsV2({
      candidateSha: row.candidateSha,
      corpusDigest: row.corpusDigest,
      evaluatorSha: row.evaluatorSha,
      rubricDigest: row.rubricDigest,
      roundId: row.roundId,
    }, {
      answerExperience: row,
      blindPreference: row,
      visual: row,
      trustedExecution: row,
      liveProvider: row,
    });
    expect(report).toEqual({
      schemaVersion: "origin.answer-evaluation-binding-qualification.v2",
      passed: true,
      blockers: [],
    });
  });

  it("fails closed when blind evidence belongs to a different candidate", () => {
    const row = binding();
    const report = qualifyOriginAnswerEvaluationBindingsV2({
      candidateSha: row.candidateSha,
      corpusDigest: row.corpusDigest,
      evaluatorSha: row.evaluatorSha,
      rubricDigest: row.rubricDigest,
      roundId: row.roundId,
    }, {
      answerExperience: row,
      blindPreference: { ...row, candidateSha: "e".repeat(40) },
      visual: row,
      trustedExecution: row,
      liveProvider: row,
    });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_BINDING_CANDIDATE_MISMATCH:blindPreference");
  });

  it("fails closed on missing evidence binding", () => {
    const row = binding();
    const report = qualifyOriginAnswerEvaluationBindingsV2({
      candidateSha: row.candidateSha,
      corpusDigest: row.corpusDigest,
      evaluatorSha: row.evaluatorSha,
      rubricDigest: row.rubricDigest,
      roundId: row.roundId,
    }, {
      answerExperience: row,
      blindPreference: row,
      visual: row,
      trustedExecution: null,
      liveProvider: row,
    });
    expect(report.blockers).toContain("AQ_V2_BINDING_MISSING_OR_INVALID:trustedExecution");
  });
});
