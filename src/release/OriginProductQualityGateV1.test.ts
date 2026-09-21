import { describe, expect, it } from "vitest";
import { evaluateOriginProductQualityGate } from "./OriginProductQualityGateV1.js";

const sha = "38b89d0ea42eabb4526aa42bd57017593a1991e5";

function passingInput() {
  return {
    candidateSha: sha,
    ui: {
      candidateSha: sha,
      exactHeadValidated: true,
      viewportScreenshots: ["mobile", "tablet", "desktop"] as const,
      horizontalOverflowDetected: false,
      accessibilityAutomationPassed: true,
    },
    answer: {
      candidateSha: sha,
      liveRunCompleted: true,
      promotionEligible: true,
      caseCount: 40,
      familyCount: 10,
      zeroCost: true,
    },
    coding: {
      candidateSha: sha,
      heldOutRunCompleted: true,
      qualificationPassed: true,
      attempted: 6,
      solved: 6,
      regressionCount: 0,
      zeroCost: true,
    },
    claudeCode: {
      candidateSha: sha,
      sameCorpusDigest: true,
      sameBaseSha: true,
      sameTimeBudget: true,
      sameEvaluatorVersion: true,
      originAttempted: 6,
      originSolved: 6,
      originRegressionCount: 0,
      claudeCodeAttempted: 6,
      claudeCodeSolved: 6,
      claudeCodeRegressionCount: 0,
    },
  };
}

describe("OriginProductQualityGateV1", () => {
  it("passes only when UI, live AQ, held-out Coding and controlled Claude Code comparison all pass", () => {
    const report = evaluateOriginProductQualityGate(passingInput());
    expect(report.passed).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.claudeCodeParityEstablished).toBe(true);
  });

  it("does not treat automated UI CI as rendered cross-device evidence without tablet coverage", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({
      ...input,
      ui: { ...input.ui, viewportScreenshots: ["mobile", "desktop"] },
    });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain("UI_VIEWPORT_COVERAGE_INCOMPLETE");
  });

  it("does not treat AQ implementation or skipped live evaluation as answer-quality acceptance", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({
      ...input,
      answer: { ...input.answer, liveRunCompleted: false },
    });
    expect(report.answerPassed).toBe(false);
    expect(report.blockers).toContain("AQ_LIVE_EVIDENCE_MISSING");
  });

  it("does not claim Claude Code parity when comparison evidence is absent", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({ ...input, claudeCode: null });
    expect(report.codingPassed).toBe(true);
    expect(report.claudeCodeParityEstablished).toBe(false);
    expect(report.blockers).toContain("CLAUDE_CODE_COMPARISON_MISSING");
    expect(report.passed).toBe(false);
  });

  it("fails closed when comparison identity is not controlled", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({
      ...input,
      claudeCode: { ...input.claudeCode, sameTimeBudget: false },
    });
    expect(report.claudeCodeParityEstablished).toBe(false);
    expect(report.blockers).toContain("CLAUDE_CODE_IDENTITY_MISMATCH");
  });

  it("requires ORIGIN to meet or exceed solved count without more regressions before parity is established", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({
      ...input,
      claudeCode: {
        ...input.claudeCode,
        originSolved: 5,
        claudeCodeSolved: 6,
      },
    });
    expect(report.claudeCodeParityEstablished).toBe(false);
    expect(report.blockers).toContain("CLAUDE_CODE_PARITY_NOT_ESTABLISHED");
  });
});
