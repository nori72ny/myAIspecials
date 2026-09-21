import { describe, expect, it } from "vitest";
import { evaluateOriginProductQualityGate } from "./OriginProductQualityGateV1.js";

const sha = "38b89d0ea42eabb4526aa42bd57017593a1991e5";
const nowMs = Date.parse("2026-09-21T00:00:00.000Z");

function provenance(
  evidenceId: string,
  source: "github-actions" | "controlled-external" = "github-actions",
) {
  return {
    source,
    evidenceId,
    headSha: sha,
    artifactDigest: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-09-20T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
  } as const;
}

function passingInput() {
  return {
    candidateSha: sha,
    ui: {
      candidateSha: sha,
      provenance: provenance("gh-run:ui-123"),
      exactHeadValidated: true,
      viewportScreenshots: ["mobile", "tablet", "desktop"] as const,
      horizontalOverflowDetected: false,
      accessibilityAutomationPassed: true,
    },
    answer: {
      candidateSha: sha,
      provenance: provenance("gh-run:aq-123"),
      liveRunCompleted: true,
      promotionEligible: true,
      caseCount: 40,
      familyCount: 10,
      zeroCost: true,
    },
    coding: {
      candidateSha: sha,
      provenance: provenance("gh-run:coding-123"),
      heldOutRunCompleted: true,
      qualificationPassed: true,
      attempted: 6,
      solved: 6,
      regressionCount: 0,
      zeroCost: true,
    },
    claudeCode: {
      candidateSha: sha,
      provenance: provenance("external:claude-code-123", "controlled-external"),
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
  const booleanFields = [
    ["ui", "exactHeadValidated"], ["ui", "horizontalOverflowDetected"],
    ["ui", "accessibilityAutomationPassed"], ["answer", "liveRunCompleted"],
    ["answer", "promotionEligible"], ["answer", "zeroCost"],
    ["coding", "heldOutRunCompleted"], ["coding", "qualificationPassed"],
    ["coding", "zeroCost"], ["claudeCode", "sameCorpusDigest"],
    ["claudeCode", "sameBaseSha"], ["claudeCode", "sameTimeBudget"],
    ["claudeCode", "sameEvaluatorVersion"],
  ] as const;

  it.each(booleanFields)("rejects malformed runtime boolean %s.%s", (section, field) => {
    for (const malformed of ["false", "true", 0, 1, null, undefined, [], {}]) {
      const input = passingInput();
      Object.assign(input[section], { [field]: malformed });
      const report = evaluateOriginProductQualityGate(input, nowMs);
      expect(report.passed).toBe(false);
      expect(report.blockers.length).toBeGreaterThan(0);
      for (const key of ["uiPassed", "answerPassed", "codingPassed", "claudeCodeParityEstablished", "passed"] as const) {
        expect(typeof report[key]).toBe("boolean");
      }
    }
  });

  it.each([null, undefined, 1, {}, "mobile,tablet,desktop"])("rejects malformed viewport coverage without throwing (%j)", value => {
    const input = passingInput();
    Object.assign(input.ui, { viewportScreenshots: value });
    const report = evaluateOriginProductQualityGate(input, nowMs);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain("UI_VIEWPORT_COVERAGE_INCOMPLETE");
  });

  it("passes only when UI, live AQ, held-out Coding and controlled Claude Code comparison all pass", () => {
    const report = evaluateOriginProductQualityGate(passingInput(), nowMs);
    expect(report.passed).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.claudeCodeParityEstablished).toBe(true);
  });

  it("does not treat automated UI CI as rendered cross-device evidence without tablet coverage", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({
      ...input,
      ui: { ...input.ui, viewportScreenshots: ["mobile", "desktop"] },
    }, nowMs);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain("UI_VIEWPORT_COVERAGE_INCOMPLETE");
  });

  it("does not treat AQ implementation or skipped live evaluation as answer-quality acceptance", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({
      ...input,
      answer: { ...input.answer, liveRunCompleted: false },
    }, nowMs);
    expect(report.answerPassed).toBe(false);
    expect(report.blockers).toContain("AQ_LIVE_EVIDENCE_MISSING");
  });

  it("does not claim Claude Code parity when comparison evidence is absent", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({ ...input, claudeCode: null }, nowMs);
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
    }, nowMs);
    expect(report.claudeCodeParityEstablished).toBe(false);
    expect(report.blockers).toContain("CLAUDE_CODE_IDENTITY_MISMATCH");
  });

  it("fails closed instead of throwing when runtime evidence omits provenance", () => {
    const input = passingInput();
    const answerWithoutProvenance = { ...input.answer } as Partial<typeof input.answer>;
    delete answerWithoutProvenance.provenance;
    const report = evaluateOriginProductQualityGate({
      ...input,
      answer: answerWithoutProvenance as typeof input.answer,
    }, nowMs);
    expect(report.answerPassed).toBe(false);
    expect(report.blockers).toContain("AQ_LIVE_EVIDENCE_MISSING");
  });

  it("fails closed when evidence provenance is stale or bound to another head", () => {
    const input = passingInput();
    const report = evaluateOriginProductQualityGate({
      ...input,
      ui: {
        ...input.ui,
        provenance: {
          ...input.ui.provenance,
          headSha: "0000000000000000000000000000000000000000",
          expiresAt: "2026-09-20T23:59:59.000Z",
        },
      },
    }, nowMs);
    expect(report.uiPassed).toBe(false);
    expect(report.blockers).toContain("UI_EXACT_HEAD_EVIDENCE_MISSING");
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
    }, nowMs);
    expect(report.claudeCodeParityEstablished).toBe(false);
    expect(report.blockers).toContain("CLAUDE_CODE_PARITY_NOT_ESTABLISHED");
  });
});
