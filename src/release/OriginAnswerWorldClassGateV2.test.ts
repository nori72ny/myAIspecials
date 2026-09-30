// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { OriginAnswerEvaluationBindingQualificationV2 } from "./OriginAnswerEvaluationBindingV2.js";
import type { OriginAnswerExperienceQualificationV2 } from "./OriginAnswerExperienceV2.js";
import type { OriginBlindPreferenceReportV2 } from "./OriginAnswerBlindPreferenceV2.js";
import type { OriginAnswerTrustedExecutionQualificationV2 } from "./OriginAnswerTrustedExecutionV2.js";
import type { OriginAnswerVisualQualificationV2 } from "./OriginAnswerVisualEvidenceV2.js";
import type { OriginTrustedAnswerQualityQualificationV2 } from "./OriginTrustedAnswerQualityV2.js";
import type { OriginTrustedBlindPreferenceQualificationV2 } from "./OriginTrustedBlindPreferenceV2.js";
import {
  evaluateOriginAnswerWorldClassGateV2,
  type OriginAnswerWorldClassGateInputV2,
} from "./OriginAnswerWorldClassGateV2.js";

const candidateSha = "a".repeat(40);

function input(): OriginAnswerWorldClassGateInputV2 {
  return {
    candidateSha,
    answerExperience: { absoluteQualityPassed: true } as unknown as OriginAnswerExperienceQualificationV2,
    blindPreference: { competitiveEvidencePassed: true } as unknown as OriginBlindPreferenceReportV2,
    trustedAnswerQuality: { passed: true } as unknown as OriginTrustedAnswerQualityQualificationV2,
    trustedBlindPreference: { passed: true, competitiveEvidencePassed: true } as unknown as OriginTrustedBlindPreferenceQualificationV2,
    visual: { passed: true } as unknown as OriginAnswerVisualQualificationV2,
    trustedExecution: { passed: true } as unknown as OriginAnswerTrustedExecutionQualificationV2,
    binding: { passed: true } as unknown as OriginAnswerEvaluationBindingQualificationV2,
    liveProviderRunCompleted: true,
    zeroCost: true,
  };
}

describe("AQ V2 world-class gate exact-answer binding", () => {
  it("requires exact-answer scoring in addition to absolute and blind quality evidence", () => {
    const report = evaluateOriginAnswerWorldClassGateV2(input());
    expect(report.worldClassCandidate).toBe(true);
    expect(report.exactAnswerScoringPassed).toBe(true);
    expect(report.trustedCompetitiveEvidencePassed).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it("fails closed when generic absolute quality is present but exact executed answers were not independently scored", () => {
    const value = input();
    const report = evaluateOriginAnswerWorldClassGateV2({
      ...value,
      trustedAnswerQuality: null,
    });
    expect(report.worldClassCandidate).toBe(false);
    expect(report.answerExperiencePassed).toBe(true);
    expect(report.exactAnswerScoringPassed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_EXACT_ANSWER_SCORING_NOT_PROVEN");
  });

  it("fails closed when blind win/loss statistics are not bound to exact answers and independent judges", () => {
    const value = input();
    const report = evaluateOriginAnswerWorldClassGateV2({
      ...value,
      trustedBlindPreference: null,
    });
    expect(report.worldClassCandidate).toBe(false);
    expect(report.competitiveEvidencePassed).toBe(true);
    expect(report.trustedCompetitiveEvidencePassed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_TRUSTED_COMPETITIVE_EVIDENCE_NOT_PROVEN");
  });
});
