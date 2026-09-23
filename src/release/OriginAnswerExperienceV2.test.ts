// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ORIGIN_AQ_V2_AXES,
  ORIGIN_AQ_V2_FAMILIES,
  ORIGIN_AQ_V2_THRESHOLDS,
  aggregateOriginAnswerExperienceV2,
  qualifyOriginAnswerExperienceV2,
  validateOriginAnswerExperienceManifestV2,
  type OriginAnswerExperienceManifestV2,
  type OriginAnswerExperienceObservationV2,
  type OriginAnswerExperienceScoreV2,
} from "./OriginAnswerExperienceV2.js";
import {
  evaluateOriginBlindPreferenceV2,
  type OriginBlindPreferenceVoteV2,
} from "./OriginAnswerBlindPreferenceV2.js";
import { evaluateOriginAnswerWorldClassGateV2 } from "./OriginAnswerWorldClassGateV2.js";

function manifest(): OriginAnswerExperienceManifestV2 {
  return {
    schemaVersion: "origin.answer-experience-manifest.v2",
    cases: ORIGIN_AQ_V2_FAMILIES.flatMap((family, index) =>
      Array.from({ length: 3 }, (_, offset) => ({
        caseId: `aq2-${String(index + 1).padStart(2, "0")}-${offset + 1}`,
        family,
      })),
    ),
  };
}

function observation(
  caseId: string,
  family: OriginAnswerExperienceObservationV2["family"],
  score: OriginAnswerExperienceScoreV2 = 4,
): OriginAnswerExperienceObservationV2 {
  return {
    caseId,
    family,
    scores: Object.fromEntries(ORIGIN_AQ_V2_AXES.map(axis => [axis, score])) as OriginAnswerExperienceObservationV2["scores"],
    p0DefectCount: 0,
    p1DefectCount: 0,
    unsupportedMaterialClaimCount: 0,
    mobile390Checked: true,
    desktop1440Checked: true,
    horizontalOverflowDetected: false,
    clippedCriticalContent: false,
    headingHierarchyViolation: false,
    mobileTableFailure: false,
  };
}

describe("AQ V2 absolute answer-experience gate", () => {
  it("requires the frozen 16-family x 3-case corpus shape", () => {
    const m = manifest();
    expect(m.cases).toHaveLength(48);
    expect(validateOriginAnswerExperienceManifestV2(m)).toBe(true);
    expect(ORIGIN_AQ_V2_THRESHOLDS.requiredCaseCount).toBe(48);
    expect(validateOriginAnswerExperienceManifestV2({
      ...m,
      cases: m.cases.slice(0, 47),
    })).toBe(false);
  });

  it("passes only strong absolute quality with zero material/visual defects", () => {
    const m = manifest();
    const rows = m.cases.map(item => observation(item.caseId, item.family));
    const aggregate = aggregateOriginAnswerExperienceV2(m, rows);
    expect(aggregate.overallMean).toBe(4);
    expect(qualifyOriginAnswerExperienceV2(m, rows)).toMatchObject({
      absoluteQualityPassed: true,
      blockers: [],
    });
  });

  it("does not let a merely non-regressed mediocre answer set pass", () => {
    const m = manifest();
    const rows = m.cases.map(item => observation(item.caseId, item.family, 3));
    const report = qualifyOriginAnswerExperienceV2(m, rows);
    expect(report.absoluteQualityPassed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_OVERALL_BELOW_MINIMUM");
  });

  it("fails closed on one P1, one unsupported material claim or one viewport defect", () => {
    const m = manifest();
    const rows = m.cases.map(item => observation(item.caseId, item.family));
    const p1 = [...rows];
    p1[0] = { ...p1[0], p1DefectCount: 1 };
    expect(qualifyOriginAnswerExperienceV2(m, p1).blockers).toContain("AQ_V2_P1_DEFECT");

    const unsupported = [...rows];
    unsupported[0] = { ...unsupported[0], unsupportedMaterialClaimCount: 1 };
    expect(qualifyOriginAnswerExperienceV2(m, unsupported).blockers).toContain("AQ_V2_UNSUPPORTED_MATERIAL_CLAIM");

    const viewport = [...rows];
    viewport[0] = { ...viewport[0], mobile390Checked: false };
    expect(qualifyOriginAnswerExperienceV2(m, viewport).blockers).toContain("AQ_V2_VIEWPORT_COVERAGE_INCOMPLETE");
  });
});

describe("AQ V2 blind competitive gate", () => {
  it("requires broad anonymous comparison evidence", () => {
    const m = manifest();
    const votes: OriginBlindPreferenceVoteV2[] = [];
    for (const item of m.cases) {
      for (const opponentId of ["reference-a", "reference-b", "reference-c"]) {
        for (const judgeId of ["judge-1", "judge-2"]) {
          votes.push({
            caseId: item.caseId,
            family: item.family,
            opponentId,
            judgeId,
            overall: 1,
            criteria: {
              correctness: 1,
              clarity: 1,
              structure: 1,
              conciseness: 1,
              usefulness: 1,
              evidenceUse: 1,
            },
          });
        }
      }
    }
    const report = evaluateOriginBlindPreferenceV2(votes);
    expect(report.caseCount).toBe(48);
    expect(report.opponentCount).toBe(3);
    expect(report.judgeCount).toBe(2);
    expect(report.completeMatrixCoverage).toBe(true);
    expect(report.competitiveEvidencePassed).toBe(true);
  });

  it("fails closed when the global counts exist but per-case judge/opponent coverage is incomplete", () => {
    const m = manifest();
    const votes: OriginBlindPreferenceVoteV2[] = [];
    for (const [index, item] of m.cases.entries()) {
      const opponents = index === 0 ? ["reference-a", "reference-b", "reference-c"] : ["reference-a"];
      for (const opponentId of opponents) {
        votes.push({
          caseId: item.caseId,
          family: item.family,
          opponentId,
          judgeId: "judge-1",
          overall: 1,
          criteria: {
            correctness: 1,
            clarity: 1,
            structure: 1,
            conciseness: 1,
            usefulness: 1,
            evidenceUse: 1,
          },
        });
      }
    }
    votes.push({
      caseId: m.cases[0].caseId,
      family: m.cases[0].family,
      opponentId: "reference-a",
      judgeId: "judge-2",
      overall: 1,
      criteria: {
        correctness: 1,
        clarity: 1,
        structure: 1,
        conciseness: 1,
        usefulness: 1,
        evidenceUse: 1,
      },
    });
    const report = evaluateOriginBlindPreferenceV2(votes);
    expect(report.completeMatrixCoverage).toBe(false);
    expect(report.blockers).toContain("AQ_V2_BLIND_MATRIX_COVERAGE_INCOMPLETE");
    expect(report.competitiveEvidencePassed).toBe(false);
  });

  it("rejects duplicate votes for the same case/opponent/judge", () => {
    const item = manifest().cases[0];
    const vote: OriginBlindPreferenceVoteV2 = {
      caseId: item.caseId,
      family: item.family,
      opponentId: "reference-a",
      judgeId: "judge-1",
      overall: 1,
      criteria: {
        correctness: 1,
        clarity: 1,
        structure: 1,
        conciseness: 1,
        usefulness: 1,
        evidenceUse: 1,
      },
    };
    expect(() => evaluateOriginBlindPreferenceV2([vote, vote])).toThrow("AQ_V2_BLIND_DUPLICATE_VOTE");
  });
});

describe("AQ V2 world-class candidate gate", () => {
  it("never claims readiness without absolute, competitive and live $0 evidence", () => {
    const candidateSha = "a".repeat(40);
    expect(evaluateOriginAnswerWorldClassGateV2({
      candidateSha,
      answerExperience: null,
      blindPreference: null,
      visual: null,
      trustedExecution: null,
      liveProviderRunCompleted: false,
      zeroCost: true,
    })).toMatchObject({
      worldClassCandidate: false,
      blockers: [
        "AQ_V2_ABSOLUTE_QUALITY_NOT_PROVEN",
        "AQ_V2_COMPETITIVE_EVIDENCE_NOT_PROVEN",
        "AQ_V2_VISUAL_EVIDENCE_NOT_PROVEN",
        "AQ_V2_TRUSTED_EXECUTION_NOT_PROVEN",
        "AQ_V2_LIVE_PROVIDER_RUN_MISSING",
      ],
    });
  });
});
