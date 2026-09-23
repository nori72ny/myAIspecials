// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  qualifyOriginAnswerVisualEvidenceV2,
  type OriginAnswerVisualEvidenceV2,
} from "./OriginAnswerVisualEvidenceV2.js";

function evidence(): OriginAnswerVisualEvidenceV2 {
  return {
    schemaVersion: "origin.answer-visual-evidence.v2",
    candidateSha: "a".repeat(40),
    evidenceId: "gh-run:12345678:answer-visual",
    artifactDigest: "sha256:" + "b".repeat(64),
    accessibilityAutomationPassed: true,
    longAnswerNavigationPassed: true,
    trustMetadataDoesNotDominate: true,
    viewports: [
      {
        viewport: 390,
        screenshotName: "answer-mobile-390.png",
        horizontalOverflowDetected: false,
        clippedCriticalContent: false,
        responsiveTablePassed: true,
        codeBlockReadable: true,
        headingHierarchyPassed: true,
      },
      {
        viewport: 1440,
        screenshotName: "answer-desktop-1440.png",
        horizontalOverflowDetected: false,
        clippedCriticalContent: false,
        responsiveTablePassed: true,
        codeBlockReadable: true,
        headingHierarchyPassed: true,
      },
    ],
  };
}

describe("AQ V2 answer visual evidence", () => {
  it("requires clean exact-SHA mobile and desktop evidence", () => {
    expect(qualifyOriginAnswerVisualEvidenceV2(evidence(), "a".repeat(40))).toEqual({
      schemaVersion: "origin.answer-visual-qualification.v2",
      passed: true,
      blockers: [],
    });
  });

  it("fails closed on long-answer navigation or trust-metadata dominance", () => {
    const base = evidence();
    expect(qualifyOriginAnswerVisualEvidenceV2({
      ...base,
      longAnswerNavigationPassed: false,
      trustMetadataDoesNotDominate: false,
    }, "a".repeat(40))).toMatchObject({
      passed: false,
      blockers: [
        "AQ_V2_VISUAL_LONG_ANSWER_NAVIGATION_FAILED",
        "AQ_V2_VISUAL_TRUST_METADATA_DOMINATES",
      ],
    });
  });

  it("fails on mobile overflow even when desktop is clean", () => {
    const base = evidence();
    expect(qualifyOriginAnswerVisualEvidenceV2({
      ...base,
      viewports: base.viewports.map(row => row.viewport === 390
        ? { ...row, horizontalOverflowDetected: true }
        : row),
    }, "a".repeat(40)).blockers).toContain("AQ_V2_VISUAL_OVERFLOW:390");
  });
});
